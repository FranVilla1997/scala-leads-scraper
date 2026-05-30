import os
from dotenv import load_dotenv

load_dotenv()

GOOGLE_PLACES_API_KEY = os.getenv("GOOGLE_PLACES_API_KEY", "")
SUPABASE_URL          = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY  = os.getenv("SUPABASE_SERVICE_KEY", "")
SUPABASE_JWT_SECRET   = os.getenv("SUPABASE_JWT_SECRET", "")
FRONTEND_URL          = os.getenv("FRONTEND_URL", "")

SCRAPER_CONCURRENCY = int(os.getenv("SCRAPER_CONCURRENCY", "8"))
PLACES_RATE_RPS     = float(os.getenv("PLACES_RATE_RPS", "8"))
