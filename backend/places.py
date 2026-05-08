import math
import httpx
from config import GOOGLE_PLACES_API_KEY

BASE = "https://places.googleapis.com/v1"

FIELD_MASK = ",".join([
    "places.id",
    "places.displayName",
    "places.formattedAddress",
    "places.nationalPhoneNumber",
    "places.websiteUri",
    "places.rating",
    "places.userRatingCount",
    "places.types",
])


# ── Geocoding ────────────────────────────────────────────────────────────────

def geocode_zone(zone: str) -> tuple[float, float, float] | None:
    """Returns (lat, lng, radius_m) for the zone bounding box."""
    resp = httpx.get(
        "https://maps.googleapis.com/maps/api/geocode/json",
        params={"address": zone, "key": GOOGLE_PLACES_API_KEY},
        timeout=10,
    )
    results = resp.json().get("results", [])
    if not results:
        return None

    loc = results[0]["geometry"]["location"]
    vp = results[0]["geometry"]["viewport"]
    lat_span = (vp["northeast"]["lat"] - vp["southwest"]["lat"]) * 111_000
    lng_span = (vp["northeast"]["lng"] - vp["southwest"]["lng"]) * 111_000 * math.cos(math.radians(loc["lat"]))
    radius = max(lat_span, lng_span) / 2
    return loc["lat"], loc["lng"], min(radius, 50_000)


def _grid_points(center_lat: float, center_lng: float, radius_m: float, n: int) -> list[tuple[float, float]]:
    """Return n×n grid of (lat, lng) covering the zone."""
    lat_deg = radius_m / 111_000
    lng_deg = radius_m / (111_000 * math.cos(math.radians(center_lat)))
    step_lat = lat_deg * 2 / n
    step_lng = lng_deg * 2 / n
    points = []
    for i in range(n):
        for j in range(n):
            lat = center_lat - lat_deg + step_lat * (i + 0.5)
            lng = center_lng - lng_deg + step_lng * (j + 0.5)
            points.append((lat, lng))
    return points


# ── Places search ─────────────────────────────────────────────────────────────

def _text_search(query: str, location_bias: dict | None = None) -> list[dict]:
    """Single Places API text search (up to 60 results via pagination)."""
    results: list[dict] = []
    page_token = None

    with httpx.Client(timeout=30) as client:
        while len(results) < 60:
            payload: dict = {
                "textQuery": query,
                "languageCode": "es",
                "maxResultCount": 20,
            }
            if location_bias:
                payload["locationBias"] = location_bias
            if page_token:
                payload["pageToken"] = page_token

            resp = client.post(
                f"{BASE}/places:searchText",
                headers={
                    "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
                    "X-Goog-FieldMask": FIELD_MASK + ",nextPageToken",
                },
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()

            for place in data.get("places", []):
                results.append(_normalize(place))

            page_token = data.get("nextPageToken")
            if not page_token:
                break

    return results


def search_places(query: str, zone: str, max_results: int = 60) -> list[dict]:
    seen: dict[str, dict] = {}

    if max_results <= 60:
        places = _text_search(f"{query} en {zone}")
        for p in places:
            if p["place_id"] not in seen:
                seen[p["place_id"]] = p
    else:
        # Grid search: n×n cells covering the zone
        geo = geocode_zone(zone)
        if not geo:
            # Fallback to standard search
            places = _text_search(f"{query} en {zone}")
            for p in places:
                seen[p["place_id"]] = p
        else:
            center_lat, center_lng, radius_m = geo
            cells_per_side = math.ceil(math.sqrt(max_results / 60))
            cell_radius = radius_m / cells_per_side * 1.4  # slight overlap

            points = _grid_points(center_lat, center_lng, radius_m, cells_per_side)
            for lat, lng in points:
                if len(seen) >= max_results:
                    break
                bias = {
                    "circle": {
                        "center": {"latitude": lat, "longitude": lng},
                        "radius": cell_radius,
                    }
                }
                places = _text_search(query, location_bias=bias)
                for p in places:
                    if p["place_id"] not in seen:
                        seen[p["place_id"]] = p

    return list(seen.values())[:max_results]


def _normalize(place: dict) -> dict:
    return {
        "place_id": place.get("id", ""),
        "name": place.get("displayName", {}).get("text", ""),
        "formatted_address": place.get("formattedAddress", ""),
        "formatted_phone_number": place.get("nationalPhoneNumber", ""),
        "website": place.get("websiteUri", ""),
        "rating": place.get("rating"),
        "user_ratings_total": place.get("userRatingCount"),
        "types": place.get("types", []),
    }


def get_place_details(place_id: str) -> dict:
    return {}
