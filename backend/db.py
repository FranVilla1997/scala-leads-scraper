from supabase import create_client, Client
from config import SUPABASE_URL, SUPABASE_SERVICE_KEY

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


def list_distinct_zones() -> list[str]:
    """All zones that appear in scraping_leads (for the admin to pick from)."""
    try:
        rows = _paginate(lambda a, b: get_client().table("scraping_leads")
                         .select("search_zone").range(a, b))
        return sorted({r["search_zone"] for r in rows if r.get("search_zone")})
    except Exception as e:
        print(f"[db] list_distinct_zones error: {e}")
        return []
