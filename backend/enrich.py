"""Búsqueda de responsables (tomadores de decisión) a partir del sitio del negocio.

Fuentes, todas sobre lo que el propio negocio publica en su web:
  1. JSON-LD (schema.org Person / founder / employee)      → confianza alta
  2. Texto de la home y "quiénes somos" leído por un LLM     → confianza media
  3. Emails no genéricos (juan@dominio, gerencia@dominio)   → confianza baja

Si no hay OPENAI_API_KEY (o no tiene crédito) el paso 2 se saltea y el resto
sigue funcionando.
"""
from __future__ import annotations

import asyncio
import json
import re
import unicodedata
from html import unescape

import httpx

from config import ANALYSIS_MODEL, OPENAI_API_KEY
from scraper import SiteData

OPENAI_BASE = "https://api.openai.com/v1"

# Casillas compartidas: sirven para el lead, no identifican a una persona
GENERIC_LOCALS = {
    "info", "informes", "contacto", "contact", "contactenos", "hola", "hello", "ventas",
    "comercial", "admin", "administracion", "consultas", "turnos", "recepcion", "soporte",
    "support", "rrhh", "prensa", "marketing", "office", "oficina", "mail", "email", "web",
    "webmaster", "reservas", "pedidos", "atencion", "clientes", "facturacion", "compras",
    "secretaria", "empleos", "cv", "newsletter", "sales", "help", "ayuda", "cobranzas",
    "proveedores", "tienda", "online", "ecommerce", "postmaster", "privacy", "legal",
}
# Casillas de rol que sí llegan a quien decide
ROLE_LOCALS = {
    "gerencia": "Gerencia", "gerente": "Gerencia", "direccion": "Dirección",
    "director": "Dirección", "directorio": "Dirección", "presidencia": "Presidencia",
    "ceo": "CEO", "owner": "Dueño",
}

_DECISION_RE = re.compile(
    r"due[ñn]|propietari|fundador|founder|\bceo\b|director|gerente general|gerencia|"
    r"soci[oa]|titular|presidente|owner|direcci[oó]n",
    re.I,
)
# Si el texto no menciona nada de esto, no vale la pena gastar una llamada al LLM
_PEOPLE_CUE_RE = re.compile(
    r"due[ñn]|fundador|founder|\bceo\b|director|gerente|soci[oa]s?\b|titular|presidente|"
    r"equipo|staff|\bdr\.|\bdra\.|\blic\.|\bing\.|\barq\.|\bcdor\.|responsable|a cargo de",
    re.I,
)

_JSONLD_RE = re.compile(
    r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', re.I | re.S
)
_SCRIPT_RE = re.compile(r"<(script|style|noscript|svg)\b.*?</\1>", re.I | re.S)
# mailto y perfiles de LinkedIn se conservan en el texto para que el LLM los asocie a la persona
_KEEP_LINK_RE = re.compile(
    r'<a\b[^>]*href=["\'](mailto:[^"\']+|https?://[^"\']*linkedin\.com/in/[^"\']+)["\'][^>]*>', re.I
)
_TAG_RE = re.compile(r"<[^>]+>")

MAX_TEXT_CHARS = 12000
MAX_CONTACTS = 8

_llm_sem = asyncio.Semaphore(4)


def html_to_text(html: str) -> str:
    html = _SCRIPT_RE.sub(" ", html)
    html = _KEEP_LINK_RE.sub(lambda m: f" [{m.group(1)}] ", html)
    return re.sub(r"\s+", " ", unescape(_TAG_RE.sub(" ", html))).strip()


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if not unicodedata.combining(c)).lower().strip()


def _contact(source: str, confidence: str, *, full_name: str | None = None, role: str | None = None,
             email: str | None = None, phone: str | None = None, linkedin_url: str | None = None,
             source_url: str | None = None, is_decision_maker: bool | None = None) -> dict:
    if is_decision_maker is None:
        is_decision_maker = bool(role and _DECISION_RE.search(role))
    return {
        "full_name": full_name, "role": role, "email": email, "phone": phone,
        "linkedin_url": linkedin_url, "is_decision_maker": is_decision_maker,
        "source": source, "source_url": source_url, "confidence": confidence,
    }


# ── 1) JSON-LD ───────────────────────────────────────────────────────────────

def _linkedin_from(same_as) -> str | None:
    urls = same_as if isinstance(same_as, list) else [same_as]
    for u in urls:
        if isinstance(u, str) and "linkedin.com/in/" in u:
            return u
    return None


def _person_from(node, url: str, default_role: str | None = None) -> dict | None:
    if isinstance(node, str):
        name, node = node, {}
    elif isinstance(node, dict):
        name = node.get("name")
    else:
        return None
    if not isinstance(name, str) or not name.strip() or len(name) > 80:
        return None
    role = node.get("jobTitle") or default_role
    email = node.get("email")
    if isinstance(email, str):
        email = email.lower().removeprefix("mailto:").strip() or None
    return _contact(
        "web_jsonld", "alta",
        full_name=name.strip(),
        role=role if isinstance(role, str) else default_role,
        email=email if isinstance(email, str) else None,
        phone=node.get("telephone") if isinstance(node.get("telephone"), str) else None,
        linkedin_url=_linkedin_from(node.get("sameAs")),
        source_url=url,
        is_decision_maker=True if default_role == "Fundador" else None,
    )


def _walk_jsonld(node, url: str, out: list[dict]) -> None:
    if isinstance(node, list):
        for item in node:
            _walk_jsonld(item, url, out)
        return
    if not isinstance(node, dict):
        return

    types = node.get("@type")
    types = types if isinstance(types, list) else [types]
    if "Person" in types:
        p = _person_from(node, url)
        if p:
            out.append(p)

    for key, role in (("founder", "Fundador"), ("founders", "Fundador"),
                      ("employee", None), ("employees", None)):
        value = node.get(key)
        for item in (value if isinstance(value, list) else [value]):
            p = _person_from(item, url, role)
            if p:
                out.append(p)

    for key, value in node.items():
        if key not in ("founder", "founders", "employee", "employees", "author", "review", "reviews"):
            _walk_jsonld(value, url, out)


def people_from_jsonld(site: SiteData) -> list[dict]:
    out: list[dict] = []
    for url, html in site.pages:
        for raw in _JSONLD_RE.findall(html):
            try:
                _walk_jsonld(json.loads(raw.strip()), url, out)
            except Exception:
                continue
    return out


# ── 2) LLM sobre el texto del sitio ──────────────────────────────────────────

_SYSTEM = (
    "Extraés de textos de sitios web de negocios argentinos a las personas que "
    "trabajan en el negocio o son sus dueños. Solo incluís personas nombradas "
    "explícitamente en el texto como parte del negocio. NO incluyas clientes, "
    "testimonios, autores de notas, proveedores ni quien diseñó el sitio. "
    "Nunca inventes nombres, cargos ni emails: si un dato no está en el texto, "
    "va null. Si no hay personas, devolvé la lista vacía."
)

_SCHEMA = {
    "personas": [{
        "nombre": "nombre y apellido tal como figura en el texto",
        "cargo": "cargo o rol tal como figura, o null",
        "email": "email de esa persona si figura, o null",
        "linkedin": "URL de su perfil de LinkedIn si figura, o null",
        "es_decisor": "true si es dueño, fundador, socio, director, gerente o titular",
    }]
}


async def people_from_llm(business_name: str, site: SiteData) -> list[dict]:
    if not OPENAI_API_KEY:
        return []

    chunks: list[str] = []
    seen: set[str] = set()
    for url, html in site.pages:
        text = html_to_text(html)
        if len(text) < 80 or text in seen:   # soft-404 que devuelve la home otra vez
            continue
        seen.add(text)
        chunks.append(f"### {url}\n{text}")
    full_text = "\n\n".join(chunks)[:MAX_TEXT_CHARS]
    if not _PEOPLE_CUE_RE.search(full_text):
        return []

    try:
        async with _llm_sem, httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{OPENAI_BASE}/chat/completions",
                headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
                json={
                    "model": ANALYSIS_MODEL,
                    "response_format": {"type": "json_object"},
                    "temperature": 0,
                    "messages": [
                        {"role": "system", "content": _SYSTEM},
                        {"role": "user", "content": (
                            f"Negocio: {business_name}\n\n"
                            f"Devolvé un JSON con exactamente esta forma:\n"
                            f"{json.dumps(_SCHEMA, ensure_ascii=False, indent=2)}\n\n"
                            f"Texto del sitio:\n\"\"\"\n{full_text}\n\"\"\""
                        )},
                    ],
                },
            )
            resp.raise_for_status()
            data = json.loads(resp.json()["choices"][0]["message"]["content"])
    except Exception as e:
        print(f"[enrich] LLM falló para '{business_name}': {e}")
        return []

    norm_text = _norm(full_text)
    known_emails = set(site.emails)
    out: list[dict] = []
    people = data.get("personas") if isinstance(data, dict) else None
    for p in people if isinstance(people, list) else []:
        if not isinstance(p, dict):
            continue
        name = p.get("nombre")
        # Anti-alucinación: el nombre tiene que estar literal en el texto
        if not isinstance(name, str) or len(name.split()) < 2 or _norm(name) not in norm_text:
            continue
        email = p.get("email")
        email = email.lower().strip() if isinstance(email, str) else None
        if email and email not in known_emails and email not in norm_text:
            email = None
        linkedin = p.get("linkedin")
        if not (isinstance(linkedin, str) and "linkedin.com/in/" in linkedin and linkedin in full_text):
            linkedin = None
        role = p.get("cargo")
        if not isinstance(role, str) or role.strip().lower() in ("", "null", "none"):
            role = None
        out.append(_contact(
            "web_llm", "media",
            full_name=name.strip(), role=role, email=email, linkedin_url=linkedin,
            source_url=site.pages[0][0] if site.pages else None,
            is_decision_maker=bool(p.get("es_decisor") is True or (role and _DECISION_RE.search(role))),
        ))
    return out


# ── 3) Emails no genéricos ───────────────────────────────────────────────────

def contacts_from_emails(site: SiteData, taken: set[str]) -> list[dict]:
    out: list[dict] = []
    for email in site.emails:
        if email in taken:
            continue
        local = email.split("@", 1)[0]
        base = re.split(r"[._\-+]", local)[0]
        if local in ROLE_LOCALS or base in ROLE_LOCALS:
            out.append(_contact("web_email", "baja", email=email,
                                role=ROLE_LOCALS.get(local) or ROLE_LOCALS[base],
                                is_decision_maker=True))
        elif local not in GENERIC_LOCALS and base not in GENERIC_LOCALS and not local.isdigit():
            out.append(_contact("web_email", "baja", email=email))
    return out


# ── API pública ──────────────────────────────────────────────────────────────

async def find_contacts(business_name: str, site: SiteData) -> list[dict]:
    """Responsables del negocio encontrados en su sitio, decisores primero."""
    if not site.pages:
        return []

    by_name: dict[str, dict] = {}
    for c in people_from_jsonld(site) + await people_from_llm(business_name, site):
        key = _norm(c["full_name"])
        prev = by_name.get(key)
        if prev is None:
            by_name[key] = c
            continue
        # Misma persona por dos fuentes: se queda la primera (JSON-LD) y se completa
        for f in ("role", "email", "phone", "linkedin_url"):
            prev[f] = prev[f] or c[f]
        prev["is_decision_maker"] = prev["is_decision_maker"] or c["is_decision_maker"]

    named = list(by_name.values())
    taken = {c["email"] for c in named if c["email"]}
    contacts = named + contacts_from_emails(site, taken)
    contacts.sort(key=lambda c: (not c["is_decision_maker"], not c["full_name"]))
    return contacts[:MAX_CONTACTS]
