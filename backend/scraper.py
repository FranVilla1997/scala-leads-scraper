"""Site scraping — fast path with httpx, JS fallback with a shared Playwright browser.

Además del email, junta el HTML de las páginas "quiénes somos" y los links a
redes para que `enrich.py` pueda encontrar a los responsables del negocio.
"""
from __future__ import annotations

import asyncio
import re
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Iterable
from urllib.parse import urljoin, urlparse

import httpx

EMAIL_RE = re.compile(r"\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b")

# Obfuscation patterns we try to normalize before regex
OBFUSCATIONS = [
    (re.compile(r"\s*\[\s*at\s*\]\s*", re.I), "@"),
    (re.compile(r"\s*\(\s*at\s*\)\s*", re.I), "@"),
    (re.compile(r"\s+at\s+", re.I),           "@"),
    (re.compile(r"\s*\[\s*dot\s*\]\s*", re.I), "."),
    (re.compile(r"\s*\(\s*dot\s*\)\s*", re.I), "."),
    (re.compile(r"\s+dot\s+", re.I),           "."),
]

SKIP_PATTERNS = (
    "@sentry", "@example", "@wix.", "@wordpress.", "@cloudflare",
    "noreply@", "no-reply@", "@test.", "@email.",
    ".png@", ".jpg@", ".jpeg@", ".gif@", ".svg@", ".webp@",
)

SKIP_EXT = (".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".pdf", ".css", ".js")

CONTACT_PATHS = ["/contacto", "/contact", "/contactenos", "/contact-us"]
# Se prueban solo si la home no linkea a ninguna página "quiénes somos"
ABOUT_PATHS = ["/nosotros", "/quienes-somos", "/sobre-nosotros", "/about", "/equipo"]

_HREF_RE = re.compile(r'href=["\']([^"\'#]+)["\']', re.I)
_ABOUT_HINT_RE = re.compile(
    r"nosotros|quienes|quien-soy|sobre-mi|about|equipo|team|staff|historia|institucional|la-empresa|el-estudio",
    re.I,
)
MAX_ABOUT_PAGES = 4

_SOCIAL_RES = {
    "linkedin":  re.compile(r'https?://(?:[a-z]{2,3}\.)?linkedin\.com/(?:company|in|school)/[^"\'\s<>?#\\]+', re.I),
    "instagram": re.compile(r'https?://(?:www\.)?instagram\.com/[A-Za-z0-9_.]+', re.I),
    "facebook":  re.compile(r'https?://(?:www\.|m\.|es-la\.)?facebook\.com/[^"\'\s<>?#\\]+', re.I),
    "whatsapp":  re.compile(r'https?://(?:wa\.me/\d+|api\.whatsapp\.com/send/?\?phone=\d+)', re.I),
}
# Links de compartir / widgets, no el perfil del negocio
_SOCIAL_SKIP = {"", "sharer", "sharer.php", "share", "share.php", "plugins", "dialog", "tr",
                "p", "reel", "reels", "explore", "hashtag"}

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)

HTTP_TIMEOUT = httpx.Timeout(10.0, connect=5.0)


@dataclass
class SiteData:
    """Todo lo que se pudo sacar del sitio de un negocio."""
    email: str | None = None                      # el mejor email para el lead
    emails: list[str] = field(default_factory=list)
    socials: dict[str, str] = field(default_factory=dict)
    pages: list[tuple[str, str]] = field(default_factory=list)  # (url, html)


# ── Email utilities ──────────────────────────────────────────────────────────

def _clean_email(e: str) -> str:
    e = e.strip().lower().rstrip(".,;:)")
    return e


def _is_valid_email(e: str) -> bool:
    if not e or any(p in e for p in SKIP_PATTERNS):
        return False
    if any(e.endswith(ext) for ext in SKIP_EXT):
        return False
    if len(e) > 80 or e.count("@") != 1:
        return False
    return True


def _extract_from_text(text: str) -> set[str]:
    found: set[str] = set()
    for raw in EMAIL_RE.findall(text):
        e = _clean_email(raw)
        if _is_valid_email(e):
            found.add(e)

    # Try deobfuscated version
    deob = text
    for pat, rep in OBFUSCATIONS:
        deob = pat.sub(rep, deob)
    if deob != text:
        for raw in EMAIL_RE.findall(deob):
            e = _clean_email(raw)
            if _is_valid_email(e):
                found.add(e)
    return found


def _extract_from_mailto(html: str) -> set[str]:
    found: set[str] = set()
    for m in re.finditer(r'mailto:([^"\'\s?>]+)', html, re.I):
        e = _clean_email(m.group(1))
        if _is_valid_email(e):
            found.add(e)
    return found


def _extract_emails(html: str) -> set[str]:
    return _extract_from_mailto(html) | _extract_from_text(html)


def _pick_best(emails: Iterable[str], domain: str | None) -> str | None:
    emails = list(emails)
    if not emails:
        return None
    # Prefer emails whose domain matches the site's domain (corporate, not gmail)
    if domain:
        for e in emails:
            try:
                if e.split("@", 1)[1] == domain:
                    return e
            except IndexError:
                continue
        for e in emails:
            try:
                if domain in e.split("@", 1)[1]:
                    return e
            except IndexError:
                continue
    # Prefer info@ / contacto@ / hola@ over personal-looking
    priority = ("contacto@", "contact@", "info@", "hola@", "ventas@", "comercial@", "hello@")
    for prefix in priority:
        for e in emails:
            if e.startswith(prefix):
                return e
    return sorted(emails)[0]


# ── Site utilities ───────────────────────────────────────────────────────────

def _site_parts(website: str) -> tuple[str, str] | None:
    """(base_url, dominio sin www) o None si la URL no se puede parsear."""
    try:
        parsed = urlparse(website if "://" in website else f"https://{website}")
        if not parsed.netloc:
            return None
        return f"{parsed.scheme}://{parsed.netloc}", parsed.netloc.lower().removeprefix("www.")
    except Exception:
        return None


def _about_links(html: str, base: str, domain: str) -> list[str]:
    """Links internos de la home que parecen 'quiénes somos' / 'equipo'."""
    out: list[str] = []
    for href in _HREF_RE.findall(html):
        if not _ABOUT_HINT_RE.search(href) or href.lower().endswith(SKIP_EXT):
            continue
        url = urljoin(base + "/", href)
        host = urlparse(url).netloc.lower().removeprefix("www.")
        if host != domain or url.rstrip("/") == base or url in out:
            continue
        out.append(url)
        if len(out) >= MAX_ABOUT_PAGES:
            break
    return out


def _extract_socials(html: str, into: dict[str, str]) -> None:
    for kind, pat in _SOCIAL_RES.items():
        if kind in into:
            continue
        for m in pat.finditer(html):
            url = m.group(0).rstrip("/")
            first_segment = urlparse(url).path.lower().strip("/").split("/")[0]
            if kind != "whatsapp" and first_segment in _SOCIAL_SKIP:
                continue
            into[kind] = url
            break


def _finish(site: SiteData, emails: set[str], domain: str) -> SiteData:
    site.emails = sorted(emails)
    site.email = _pick_best(site.emails, domain)
    for _, html in site.pages:
        _extract_socials(html, site.socials)
    return site


# ── Fast path: httpx ─────────────────────────────────────────────────────────

async def _try_httpx(client: httpx.AsyncClient, url: str) -> tuple[set[str], str | None]:
    """Returns (emails_found, raw_html_or_none). None html → totally failed (network/timeout)."""
    try:
        resp = await client.get(url, follow_redirects=True)
        if resp.status_code >= 400:
            return set(), None
        html = resp.text
        return _extract_emails(html), html
    except Exception:
        return set(), None


async def _extract_with_httpx(website: str) -> tuple[SiteData, bool]:
    """Returns (site_data, needs_js_fallback)."""
    site = SiteData()
    parts = _site_parts(website)
    if not parts:
        return site, False
    base, domain = parts

    async with httpx.AsyncClient(
        timeout=HTTP_TIMEOUT,
        headers={"User-Agent": UA, "Accept-Language": "es,en;q=0.7"},
        http2=False,
    ) as client:
        emails, html = await _try_httpx(client, base)

        if html is None:
            # Total network failure — JS fallback unlikely to help, but try once
            return site, True

        site.pages.append((base, html))

        # Heuristic: page seems mostly empty (JS-heavy SPA) → fallback to playwright
        likely_spa = len(html) < 1500 and "<script" in html.lower()

        # "Quiénes somos" se visita siempre: ahí están los nombres de los responsables
        about_urls = _about_links(html, base, domain) or [
            urljoin(base + "/", p.lstrip("/")) for p in ABOUT_PATHS
        ]
        results = await asyncio.gather(*(_try_httpx(client, u) for u in about_urls))
        for url, (sub_emails, sub_html) in zip(about_urls, results):
            if sub_html:
                emails |= sub_emails
                site.pages.append((url, sub_html))

        if not emails:
            for path in CONTACT_PATHS:
                sub_url = urljoin(base + "/", path.lstrip("/"))
                sub_emails, sub_html = await _try_httpx(client, sub_url)
                if sub_emails:
                    emails = sub_emails
                    site.pages.append((sub_url, sub_html or ""))
                    break

    _finish(site, emails, domain)
    return site, (likely_spa and not site.email)


# ── Slow path: shared Playwright browser ─────────────────────────────────────

class _PlaywrightPool:
    """Single Chromium instance reused across all extractions in a job."""
    def __init__(self) -> None:
        self._pw = None
        self._browser = None
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        if self._browser is not None:
            return
        from playwright.async_api import async_playwright  # lazy
        self._pw = await async_playwright().start()
        self._browser = await self._pw.chromium.launch(headless=True)

    async def stop(self) -> None:
        if self._browser:
            try: await self._browser.close()
            except Exception: pass
            self._browser = None
        if self._pw:
            try: await self._pw.stop()
            except Exception: pass
            self._pw = None

    @asynccontextmanager
    async def page(self):
        if self._browser is None:
            await self.start()
        context = await self._browser.new_context(user_agent=UA, locale="es-AR")
        page = await context.new_page()
        try:
            yield page
        finally:
            try: await context.close()
            except Exception: pass


async def _extract_with_playwright(pool: _PlaywrightPool, website: str) -> SiteData:
    site = SiteData()
    parts = _site_parts(website)
    if not parts:
        return site
    base, domain = parts

    emails: set[str] = set()
    try:
        async with pool.page() as page:
            try:
                await page.goto(base, timeout=12000, wait_until="domcontentloaded")
                html = await page.content()
                emails |= _extract_emails(html)
                site.pages.append((base, html))
            except Exception:
                pass

            home_html = site.pages[0][1] if site.pages else ""
            for url in _about_links(home_html, base, domain):
                try:
                    await page.goto(url, timeout=8000, wait_until="domcontentloaded")
                    html = await page.content()
                    emails |= _extract_emails(html)
                    site.pages.append((url, html))
                except Exception:
                    continue

            if not emails:
                for path in CONTACT_PATHS + ABOUT_PATHS:
                    try:
                        url = urljoin(base + "/", path.lstrip("/"))
                        await page.goto(url, timeout=8000, wait_until="domcontentloaded")
                        html = await page.content()
                        emails |= _extract_emails(html)
                        if emails:
                            site.pages.append((url, html))
                            break
                    except Exception:
                        continue
    except Exception:
        return site

    return _finish(site, emails, domain)


# ── Public API ───────────────────────────────────────────────────────────────

class EmailScraper:
    """Job-scoped scraper: bounded concurrency + lazy Playwright."""

    def __init__(self, concurrency: int = 8) -> None:
        self._sem = asyncio.Semaphore(concurrency)
        self._pool = _PlaywrightPool()
        self._pool_started = False

    async def extract_site(self, website: str) -> SiteData:
        """Email + páginas y redes del sitio (insumo para buscar responsables)."""
        if not website:
            return SiteData()
        async with self._sem:
            site, needs_js = await _extract_with_httpx(website)
            if needs_js:
                try:
                    if not self._pool_started:
                        await self._pool.start()
                        self._pool_started = True
                    js_site = await _extract_with_playwright(self._pool, website)
                    if js_site.pages:
                        return js_site
                except Exception as e:
                    print(f"[scraper] fallback Playwright falló para {website}: {e}")
            return site

    async def extract(self, website: str) -> str | None:
        return (await self.extract_site(website)).email

    async def close(self) -> None:
        await self._pool.stop()
