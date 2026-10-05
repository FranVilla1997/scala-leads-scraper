import math
import time
import httpx
from config import GOOGLE_PLACES_API_KEY, PLACES_RATE_RPS

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

_NOMINATIM_UA = "ScalaLeadsScraper/1.0 (contact: francovillayoma@gmail.com)"
_geocode_cache: dict[str, tuple[float, float, float] | None] = {}


def _nominatim_geocode(zone: str) -> tuple[float, float, float] | None:
    """OpenStreetMap Nominatim — gratis, sin API key. Devuelve (lat, lng, radius_m)."""
    try:
        resp = httpx.get(
            "https://nominatim.openstreetmap.org/search",
            params={
                "q": zone,
                "format": "json",
                "limit": 1,
                "addressdetails": 0,
            },
            headers={"User-Agent": _NOMINATIM_UA, "Accept-Language": "es"},
            timeout=10,
        )
        if resp.status_code >= 400:
            print(f"[geocode] nominatim '{zone}' → HTTP {resp.status_code}")
            return None
        data = resp.json()
        if not data:
            return None
        item = data[0]
        lat = float(item["lat"])
        lng = float(item["lon"])
        bb = item.get("boundingbox")  # [south, north, west, east]
        if bb and len(bb) == 4:
            south, north, west, east = (float(x) for x in bb)
            lat_span = (north - south) * 111_000
            lng_span = (east - west) * 111_000 * math.cos(math.radians(lat))
            radius = max(lat_span, lng_span) / 2
        else:
            radius = 8_000
        return lat, lng, min(max(radius, 2_000), 50_000)
    except Exception as e:
        print(f"[geocode] nominatim '{zone}' exception: {e}")
        return None


def _places_geocode(zone: str) -> tuple[float, float, float] | None:
    """Fallback: pedir la ubicación a Places API con hint de Argentina."""
    try:
        with httpx.Client(timeout=10) as client:
            resp = client.post(
                f"{BASE}/places:searchText",
                headers={
                    "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
                    "X-Goog-FieldMask": "places.location,places.viewport",
                },
                json={"textQuery": f"{zone}, Argentina", "languageCode": "es", "maxResultCount": 1},
            )
            if resp.status_code >= 400:
                return None
            places = resp.json().get("places", [])
            if not places:
                return None
            p = places[0]
            loc = p.get("location") or {}
            lat, lng = loc.get("latitude"), loc.get("longitude")
            if lat is None or lng is None:
                return None
            vp = p.get("viewport") or {}
            low, high = vp.get("low") or {}, vp.get("high") or {}
            if low and high:
                lat_span = (high.get("latitude", lat) - low.get("latitude", lat)) * 111_000
                lng_span = (high.get("longitude", lng) - low.get("longitude", lng)) * 111_000 * math.cos(math.radians(lat))
                radius = max(lat_span, lng_span) / 2
            else:
                radius = 8_000
            return lat, lng, min(max(radius, 2_000), 50_000)
    except Exception:
        return None


def geocode_zone(zone: str) -> tuple[float, float, float] | None:
    """Devuelve (lat, lng, radius_m) para la zona. Nominatim → Places fallback."""
    if zone in _geocode_cache:
        return _geocode_cache[zone]
    geo = _nominatim_geocode(zone) or _places_geocode(zone)
    if geo:
        lat, lng, radius = geo
        print(f"[geocode] '{zone}' → ({lat:.4f}, {lng:.4f}) radio={int(radius)}m")
    else:
        print(f"[geocode] '{zone}' → falló (nominatim + places)")
    _geocode_cache[zone] = geo
    return geo


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

_last_call_ts = 0.0
_min_gap = 1.0 / max(PLACES_RATE_RPS, 0.1)


def _rate_limit() -> None:
    global _last_call_ts
    now = time.monotonic()
    wait = _min_gap - (now - _last_call_ts)
    if wait > 0:
        time.sleep(wait)
    _last_call_ts = time.monotonic()


def _post_with_retry(client: httpx.Client, payload: dict, max_retries: int = 3) -> dict:
    backoff = 1.0
    last_err: Exception | None = None
    for attempt in range(max_retries):
        _rate_limit()
        try:
            resp = client.post(
                f"{BASE}/places:searchText",
                headers={
                    "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
                    "X-Goog-FieldMask": FIELD_MASK + ",nextPageToken",
                },
                json=payload,
            )
            if resp.status_code == 429 or resp.status_code >= 500:
                raise httpx.HTTPStatusError("retryable", request=resp.request, response=resp)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            last_err = e
            if attempt < max_retries - 1:
                time.sleep(backoff)
                backoff *= 2
    raise last_err or RuntimeError("places request failed")


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

            try:
                data = _post_with_retry(client, payload)
            except Exception as e:
                print(f"[places] search failed: {e}")
                break

            for place in data.get("places", []):
                results.append(_normalize(place))

            page_token = data.get("nextPageToken")
            if not page_token:
                break

    return results


# Mapeo explícito UI → tamaño de grilla (matchea las labels del SearchPanel)
_GRID_SIDE = {120: 2, 200: 3, 300: 4}


def search_places(query: str, zone: str, max_results: int = 60) -> list[dict]:
    seen: dict[str, dict] = {}

    if max_results <= 60:
        places = _text_search(f"{query} en {zone}")
        for p in places:
            if p["place_id"] not in seen:
                seen[p["place_id"]] = p
        print(f"[places] '{query}' en {zone}: {len(seen)} (modo simple)")
    else:
        geo = geocode_zone(zone)
        if not geo:
            print(f"[places] '{query}' en {zone}: fallback simple (geocode falló)")
            places = _text_search(f"{query} en {zone}")
            for p in places:
                seen[p["place_id"]] = p
        else:
            center_lat, center_lng, radius_m = geo
            cells_per_side = _GRID_SIDE.get(max_results) or max(2, math.ceil(math.sqrt(max_results / 60)))
            cell_radius = radius_m / cells_per_side * 1.4  # overlap suave
            points = _grid_points(center_lat, center_lng, radius_m, cells_per_side)
            print(f"[places] '{query}' en {zone}: grilla {cells_per_side}×{cells_per_side}, "
                  f"centro=({center_lat:.4f},{center_lng:.4f}), radio={int(radius_m)}m, "
                  f"cell_radius={int(cell_radius)}m")

            for idx, (lat, lng) in enumerate(points):
                if len(seen) >= max_results:
                    break
                bias = {
                    "circle": {
                        "center": {"latitude": lat, "longitude": lng},
                        "radius": cell_radius,
                    }
                }
                # Mantenemos el zone en la query — sin él, locationBias es solo "preferencia" y trae ruido
                before = len(seen)
                places = _text_search(f"{query} en {zone}", location_bias=bias)
                for p in places:
                    if p["place_id"] not in seen:
                        seen[p["place_id"]] = p
                print(f"[places]   cell {idx + 1}/{len(points)}: +{len(seen) - before} nuevos (total {len(seen)})")

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
