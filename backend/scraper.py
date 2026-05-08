import re
from playwright.sync_api import sync_playwright

EMAIL_RE = re.compile(r"\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b")
SKIP_PATTERNS = ["@sentry", "@example", "@wix.", "@wordpress.", "noreply@", "no-reply@", "@test."]
CONTACT_PATHS = ["/contacto", "/contact", "/contactenos", "/about", "/nosotros"]


def _get_emails_from_page(page) -> set[str]:
    emails: set[str] = set()
    try:
        links = page.eval_on_selector_all(
            'a[href^="mailto:"]',
            'els => els.map(e => e.getAttribute("href") || "")',
        )
        for link in links:
            email = link.replace("mailto:", "").split("?")[0].strip().lower()
            if email and not any(p in email for p in SKIP_PATTERNS):
                emails.add(email)
    except Exception:
        pass

    if not emails:
        try:
            content = page.content()
            for email in EMAIL_RE.findall(content):
                if not any(p in email for p in SKIP_PATTERNS):
                    emails.add(email.lower())
        except Exception:
            pass

    return emails


def extract_email_sync(url: str) -> str | None:
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                )
            )
            page = context.new_page()
            emails: set[str] = set()

            try:
                page.goto(url, timeout=12000, wait_until="domcontentloaded")
                emails = _get_emails_from_page(page)

                if not emails:
                    base = url.rstrip("/")
                    for path in CONTACT_PATHS:
                        try:
                            page.goto(f"{base}{path}", timeout=8000, wait_until="domcontentloaded")
                            emails = _get_emails_from_page(page)
                            if emails:
                                break
                        except Exception:
                            continue
            except Exception:
                pass
            finally:
                context.close()
                browser.close()

            return sorted(emails)[0] if emails else None
    except Exception:
        return None
