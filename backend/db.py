from datetime import datetime, timedelta, timezone

from supabase import create_client, Client
from config import SUPABASE_URL, SUPABASE_SERVICE_KEY, RECORDINGS_BUCKET

_client: Client | None = None


def get_client() -> Client:
    global _client
    if _client is None:
        _client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    return _client


# ── Leads ────────────────────────────────────────────────────────────────────

def upsert_lead(lead: dict) -> None:
    try:
        get_client().table("scraping_leads").upsert(lead, on_conflict="place_id").execute()
    except Exception as e:
        print(f"[db] upsert failed for {lead.get('name')}: {e}")


_PAGE = 1000  # PostgREST default max_rows


def _paginate(query_builder_fn) -> list[dict]:
    """Itera con range() hasta agotar resultados. `query_builder_fn(start, end)`
    devuelve un query Supabase ya configurado."""
    out: list[dict] = []
    start = 0
    while True:
        chunk = query_builder_fn(start, start + _PAGE - 1).execute().data or []
        out.extend(chunk)
        if len(chunk) < _PAGE:
            break
        start += _PAGE
    return out


def get_existing_emails() -> dict[str, str | None]:
    """Returns {place_id: email} for all leads already in DB."""
    try:
        rows = _paginate(lambda a, b: get_client().table("scraping_leads")
                         .select("place_id, email").range(a, b))
        return {row["place_id"]: row["email"] for row in rows}
    except Exception as e:
        print(f"[db] get_existing_emails error: {e}")
        return {}


def get_all_leads(zones: list[str] | None = None) -> list[dict]:
    try:
        if zones is not None and not zones:
            return []
        def build(a: int, b: int):
            q = get_client().table("scraping_leads").select("*").order("scraped_at", desc=True)
            if zones is not None:
                q = q.in_("search_zone", zones)
            return q.range(a, b)
        return _paginate(build)
    except Exception as e:
        print(f"[db] get_all_leads error: {e}")
        return []


def update_lead_status(place_id: str, status: str, user_id: str, notes: str | None = None) -> dict | None:
    try:
        patch: dict = {"status": status, "updated_by": user_id}
        if notes is not None:
            patch["notes"] = notes
        res = (
            get_client()
            .table("scraping_leads")
            .update(patch)
            .eq("place_id", place_id)
            .execute()
        )
        return (res.data or [None])[0]
    except Exception as e:
        print(f"[db] update_lead_status error: {e}")
        return None


# ── Users / profiles ─────────────────────────────────────────────────────────

def get_user_profile(user_id: str) -> dict | None:
    try:
        res = (
            get_client()
            .table("users_profile")
            .select("id, email, full_name, role, active")
            .eq("id", user_id)
            .single()
            .execute()
        )
        return res.data
    except Exception as e:
        print(f"[db] get_user_profile error: {e}")
        return None


def create_seller(email: str, password: str, full_name: str | None = None) -> dict:
    """Crea usuario en auth.users vía Supabase Admin API.
    El trigger on_auth_user_created arma el users_profile con rol vendedor."""
    client = get_client()
    res = client.auth.admin.create_user({
        "email": email,
        "password": password,
        "email_confirm": True,
        "user_metadata": {"full_name": full_name or email},
    })
    user = getattr(res, "user", None) or res
    user_id = getattr(user, "id", None) or (user.get("id") if isinstance(user, dict) else None)
    if not user_id:
        raise RuntimeError("Supabase no devolvió user.id")

    # Backfill por si el trigger no se disparó (defensivo)
    client.table("users_profile").upsert({
        "id": user_id, "email": email,
        "full_name": full_name or email, "role": "vendedor", "active": True,
    }, on_conflict="id").execute()

    return {"id": user_id, "email": email, "full_name": full_name or email, "role": "vendedor", "active": True, "zones": []}


def set_seller_active(user_id: str, active: bool) -> None:
    try:
        get_client().table("users_profile").update({"active": active}).eq("id", user_id).execute()
    except Exception as e:
        print(f"[db] set_seller_active error: {e}")


def list_sellers() -> list[dict]:
    try:
        res = (
            get_client()
            .table("users_profile")
            .select("id, email, full_name, role, active, created_at")
            .order("created_at", desc=False)
            .execute()
        )
        return res.data or []
    except Exception as e:
        print(f"[db] list_sellers error: {e}")
        return []


# ── Seller zones ─────────────────────────────────────────────────────────────

def get_seller_zones(user_id: str) -> list[str]:
    try:
        res = (
            get_client()
            .table("seller_zones")
            .select("zone")
            .eq("user_id", user_id)
            .execute()
        )
        return [r["zone"] for r in (res.data or [])]
    except Exception as e:
        print(f"[db] get_seller_zones error: {e}")
        return []


def get_all_zone_assignments() -> dict[str, list[str]]:
    """Returns {user_id: [zones]}."""
    try:
        res = get_client().table("seller_zones").select("user_id, zone").execute()
        out: dict[str, list[str]] = {}
        for row in res.data or []:
            out.setdefault(row["user_id"], []).append(row["zone"])
        return out
    except Exception as e:
        print(f"[db] get_all_zone_assignments error: {e}")
        return {}


def set_seller_zones(user_id: str, zones: list[str]) -> None:
    """Replace seller zones with the given list."""
    try:
        client = get_client()
        client.table("seller_zones").delete().eq("user_id", user_id).execute()
        if zones:
            payload = [{"user_id": user_id, "zone": z} for z in zones]
            client.table("seller_zones").insert(payload).execute()
    except Exception as e:
        print(f"[db] set_seller_zones error: {e}")


# ── Llamadas ─────────────────────────────────────────────────────────────────

# Disposiciones que cuentan como "hubo conversación real con una persona"
CONVERSATION_DISPOSITIONS = {
    "gatekeeper", "no_interesado", "interesado", "cita_agendada",
    "llamar_despues", "no_llamar",
}


def create_call(call: dict) -> dict | None:
    try:
        res = get_client().table("calls").insert(call).execute()
        return (res.data or [None])[0]
    except Exception as e:
        print(f"[db] create_call error: {e}")
        return None


def update_call(call_id: str, patch: dict) -> dict | None:
    try:
        res = get_client().table("calls").update(patch).eq("id", call_id).execute()
        return (res.data or [None])[0]
    except Exception as e:
        print(f"[db] update_call error: {e}")
        return None


def get_call(call_id: str) -> dict | None:
    try:
        res = get_client().table("calls").select("*").eq("id", call_id).single().execute()
        return res.data
    except Exception as e:
        print(f"[db] get_call error: {e}")
        return None


def list_calls(zones: list[str] | None = None, place_id: str | None = None,
               limit: int = 200) -> list[dict]:
    """Llamadas más recientes. Si `zones` viene, filtra por los leads de esas zonas."""
    try:
        q = get_client().table("calls").select("*").order("created_at", desc=True).limit(limit)
        if place_id:
            q = q.eq("place_id", place_id)
        rows = q.execute().data or []

        if zones is not None:
            if not zones:
                return []
            allowed = {l["place_id"] for l in get_all_leads(zones=zones)}
            rows = [r for r in rows if r["place_id"] in allowed]
        return rows
    except Exception as e:
        print(f"[db] list_calls error: {e}")
        return []


def upload_recording(path: str, audio: bytes, content_type: str = "audio/webm") -> str | None:
    """Sube el audio al bucket privado y devuelve una URL firmada (7 días)."""
    try:
        client = get_client()
        client.storage.from_(RECORDINGS_BUCKET).upload(
            path, audio, {"content-type": content_type, "upsert": "true"}
        )
        signed = client.storage.from_(RECORDINGS_BUCKET).create_signed_url(path, 60 * 60 * 24 * 7)
        return signed.get("signedURL") or signed.get("signedUrl")
    except Exception as e:
        print(f"[db] upload_recording error: {e}")
        return None


def set_do_not_call(place_id: str, value: bool = True) -> None:
    try:
        get_client().table("scraping_leads").update(
            {"do_not_call": value}
        ).eq("place_id", place_id).execute()
    except Exception as e:
        print(f"[db] set_do_not_call error: {e}")


# ── Cola de trabajo y métricas ───────────────────────────────────────────────

def get_call_queue(zones: list[str] | None = None, limit: int = 100) -> dict:
    """Cola priorizada 'a quién llamo hoy', en el orden que recomienda el sistema:
    seguimientos vencidos → nunca llamados → llamados hace tiempo sin cerrar."""
    leads = [l for l in get_all_leads(zones=zones) if not l.get("do_not_call")]
    now = datetime.now(timezone.utc)

    def _parse(ts: str | None):
        if not ts:
            return None
        try:
            return datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except Exception:
            return None

    seguimiento, nuevos, reintentar = [], [], []
    for l in leads:
        if l.get("status") in ("cerrado_ganado", "cerrado_perdido"):
            continue
        if not l.get("phone"):
            continue

        next_at = _parse(l.get("next_action_at"))
        last_at = _parse(l.get("last_called_at"))

        if next_at and next_at <= now:
            seguimiento.append(l)
        elif not last_at:
            nuevos.append(l)
        elif not next_at and (now - last_at) > timedelta(days=7):
            reintentar.append(l)

    # Dentro de cada grupo, priorizar los de mejor calidad (más reseñas y rating)
    def _score(l: dict) -> float:
        return (l.get("rating") or 0) * min(l.get("reviews_count") or 0, 200)

    nuevos.sort(key=_score, reverse=True)
    reintentar.sort(key=_score, reverse=True)
    seguimiento.sort(key=lambda l: l.get("next_action_at") or "")

    return {
        "seguimiento": seguimiento[:limit],
        "nuevos": nuevos[:limit],
        "reintentar": reintentar[:limit],
        "totals": {
            "seguimiento": len(seguimiento),
            "nuevos": len(nuevos),
            "reintentar": len(reintentar),
        },
    }


def get_call_metrics(zones: list[str] | None = None) -> dict:
    """Los KPIs que importan: llamadas, conversaciones, citas, show rate y costo."""
    calls = list_calls(zones=zones, limit=5000)

    total = len(calls)
    by_disposition: dict[str, int] = {}
    for c in calls:
        d = c.get("disposition") or "desconocido"
        by_disposition[d] = by_disposition.get(d, 0) + 1

    conversations = sum(1 for c in calls if c.get("disposition") in CONVERSATION_DISPOSITIONS)
    appointments = by_disposition.get("cita_agendada", 0)
    total_seconds = sum(c.get("duration_seconds") or 0 for c in calls)
    total_cost = sum(float(c.get("cost_usd") or 0) for c in calls)

    now = datetime.now(timezone.utc)
    last7 = 0
    for c in calls:
        try:
            created = datetime.fromisoformat((c.get("created_at") or "").replace("Z", "+00:00"))
            if (now - created) <= timedelta(days=7):
                last7 += 1
        except Exception:
            continue

    def _pct(num: int, den: int) -> float:
        return round(num / den * 100, 1) if den else 0.0

    return {
        "total_calls": total,
        "calls_last_7d": last7,
        "conversations": conversations,
        "appointments": appointments,
        "by_disposition": by_disposition,
        "connect_rate": _pct(conversations, total),           # llamadas → conversaciones
        "conversation_to_appt": _pct(appointments, conversations),
        "calls_per_appointment": round(total / appointments, 1) if appointments else None,
        "total_minutes": round(total_seconds / 60, 1),
        "total_cost_usd": round(total_cost, 2),
        "cost_per_appointment": round(total_cost / appointments, 2) if appointments else None,
    }


def list_distinct_zones() -> list[str]:
    """All zones that appear in scraping_leads (for the admin to pick from)."""
    try:
        rows = _paginate(lambda a, b: get_client().table("scraping_leads")
                         .select("search_zone").range(a, b))
        return sorted({r["search_zone"] for r in rows if r.get("search_zone")})
    except Exception as e:
        print(f"[db] list_distinct_zones error: {e}")
        return []
