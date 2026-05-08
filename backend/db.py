from supabase import create_client, Client
from config import SUPABASE_URL, SUPABASE_SERVICE_KEY

_client: Client | None = None

def get_client() -> Client:
    global _client
    if _client is None:
        _client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    return _client

def upsert_lead(lead: dict) -> None:
    try:
        get_client().table("scraping_leads").upsert(lead, on_conflict="place_id").execute()
    except Exception as e:
        print(f"[db] upsert failed for {lead.get('name')}: {e}")

def get_existing_emails() -> dict[str, str | None]:
    """Returns {place_id: email} for all leads already in DB."""
    try:
        result = get_client().table("scraping_leads").select("place_id, email").execute()
        return {row["place_id"]: row["email"] for row in (result.data or [])}
    except Exception as e:
        print(f"[db] get_existing_emails error: {e}")
        return {}

def get_all_leads() -> list[dict]:
    try:
        result = get_client().table("scraping_leads").select("*").order("scraped_at", desc=True).execute()
        return result.data or []
    except Exception as e:
        print(f"[db] get_all_leads error: {e}")
        return []
