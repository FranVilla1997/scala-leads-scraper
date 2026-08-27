"""Email scraping — fast path with httpx, JS fallback with a shared Playwright browser."""
from __future__ import annotations

import asyncio
import re
from contextlib import asynccontextmanager
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

CONTACT_PATHS = ["/contacto", "/contact", "/contactenos", "/contact-us", "/about", "/nosotros", "/quienes-somos"]

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)

HTTP_TIMEOUT = httpx.Timeout(10.0, connect=5.0)


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


# ── Fast path: httpx ─────────────────────────────────────────────────────────

async def _try_httpx(client: httpx.AsyncClient, url: str) -> tuple[set[str], str | None]:
    """Returns (emails_found, raw_html_or_none). None html → totally failed (network/timeout)."""
    try:
        resp = await client.get(url, follow_redirects=True)
        if resp.status_code >= 400:
            return set(), None
        html = resp.text
        emails = _extract_from_mailto(html) | _extract_from_text(html)
        return emails, html
    except Exception:
        return set(), None


async def _extract_with_httpx(website: str) -> tuple[str | None, bool]:
    """Returns (email, needs_js_fallback)."""
    try:
        parsed = urlparse(website if "://" in website else f"https://{website}")
        base = f"{parsed.scheme}://{parsed.netloc}"
        domain = parsed.netloc.lstrip("www.")
    except Exception:
        return None, False

    async with httpx.AsyncClient(
        timeout=HTTP_TIMEOUT,
        headers={"User-Agent": UA, "Accept-Language": "es,en;q=0.7"},
        http2=False,
    ) as client:
        emails, html = await _try_httpx(client, base)

        if not emails and html is None:
            # Total network failure — JS fallback unlikely to help, but try once
            return None, True

        # Heuristic: page seems mostly empty (JS-heavy SPA) → fallback to playwright
        likely_spa = bool(html) and len(html) < 1500 and "<script" in (html or "").lower()

        if not emails:
            for path in CONTACT_PATHS:
                sub_url = urljoin(base + "/", path.lstrip("/"))
                sub_emails, _ = await _try_httpx(client, sub_url)
                if sub_emails:
                    emails = sub_emails
                    break

    if emails:
        return _pick_best(emails, domain), False
    return None, likely_spa


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


async def _extract_with_playwright(pool: _PlaywrightPool, website: str) -> str | None:
    try:
        parsed = urlparse(website if "://" in website else f"https://{website}")
        base = f"{parsed.scheme}://{parsed.netloc}"
        domain = parsed.netloc.lstrip("www.")
    except Exception:
        return None

    emails: set[str] = set()
    try:
        async with pool.page() as page:
            try:
                await page.goto(base, timeout=12000, wait_until="domcontentloaded")
                html = await page.content()
                emails |= _extract_from_mailto(html) | _extract_from_text(html)
            except Exception:
                pass

            if not emails:
                for path in CONTACT_PATHS:
                    try:
                        await page.goto(urljoin(base + "/", path.lstrip("/")), timeout=8000, wait_until="domcontentloaded")
                        html = await page.content()
                        emails |= _extract_from_mailto(html) | _extract_from_text(html)
                        if emails:
                            break
                    except Exception:
                        continue
    except Exception:
        return None

    return _pick_best(emails, domain)


# ── Public API ───────────────────────────────────────────────────────────────

class EmailScraper:
    """Job-scoped scraper: bounded concurrency + lazy Playwright."""

    def __init__(self, concurrency: int = 8) -> None:
        self._sem = asyncio.Semaphore(concurrency)
        self._pool = _PlaywrightPool()
        self._pool_started = False

    async def extract(self, website: str) -> str | None:
        if not website:
            return None
        async with self._sem:
            email, needs_js = await _extract_with_httpx(website)
            if email:
                return email
            if needs_js:
                if not self._pool_started:
                    await self._pool.start()
                    self._pool_started = True
                return await _extract_with_playwright(self._pool, website)
        return None

    async def close(self) -> None:
        await self._pool.stop()
