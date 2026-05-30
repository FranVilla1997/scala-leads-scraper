import asyncio
import csv
import io
import json
import uuid
from datetime import datetime, timezone
from typing import AsyncIterator, Literal

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel

from auth import CurrentUser, require_admin, require_user
from config import FRONTEND_URL, SCRAPER_CONCURRENCY
from db import (
    get_all_leads, get_all_zone_assignments, get_existing_emails,
    get_seller_zones, list_distinct_zones, list_sellers,
    set_seller_zones, update_lead_status, upsert_lead,
)
from places import search_places
from scraper import EmailScraper

app = FastAPI(title="Scala Leads Scraper")

_origins = ["http://localhost:5173", "http://localhost:3000", "http://localhost:5174"]
if FRONTEND_URL:
    _origins.append(FRONTEND_URL)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Job manager ──────────────────────────────────────────────────────────────

class JobState:
    def __init__(self) -> None:
        self.queue: asyncio.Queue = asyncio.Queue()
        self.cancel_event = asyncio.Event()
        self.task: asyncio.Task | None = None


jobs: dict[str, JobState] = {}


# ── Models ───────────────────────────────────────────────────────────────────

VALID_STATUSES = {"nuevo", "contactado", "interesado", "cerrado_ganado", "cerrado_perdido"}


class SearchRequest(BaseModel):
    query: str
    zones: list[str]
    max_results: int = 60


class StatusUpdate(BaseModel):
    status: Literal["nuevo", "contactado", "interesado", "cerrado_ganado", "cerrado_perdido"]
    notes: str | None = None


class SellerZonesPayload(BaseModel):
    zones: list[str]


# ── Search job ───────────────────────────────────────────────────────────────

async def run_search(job_id: str, query: str, zones: list[str], max_results: int = 60) -> None:
    state = jobs[job_id]
    q = state.queue
    loop = asyncio.get_event_loop()
    scraper = EmailScraper(concurrency=SCRAPER_CONCURRENCY)

    try:
        grid_note = " con grilla" if max_results > 60 else ""
        zones_label = ", ".join(zones)
        await q.put({"type": "status", "message": f"Buscando '{query}' en {zones_label}{grid_note}..."})

        all_places: dict[str, dict] = {}
        for zi, zone in enumerate(zones):
            if state.cancel_event.is_set():
                await q.put({"type": "status", "message": "Cancelado por el usuario"})
                return
            await q.put({
                "type": "status",
                "message": f"Buscando en {zone} ({zi + 1}/{len(zones)})...",
            })
            places = await loop.run_in_executor(None, search_places, query, zone, max_results)
            for p in places:
                pid = p.get("place_id")
                if pid and pid not in all_places:
                    p["search_zone"] = zone
                    all_places[pid] = p

        places_list = list(all_places.values())
        total = len(places_list)

        existing = await loop.run_in_executor(None, get_existing_emails)

        await q.put({
            "type": "status",
            "message": f"Encontrados {total} negocios únicos en {len(zones)} zona(s). Extrayendo emails...",
            "total": total,
        })

        new_count = 0
        skip_count = 0
        progress = {"done": 0}

        async def process(idx: int, place: dict) -> None:
            nonlocal new_count, skip_count
            if state.cancel_event.is_set():
                return

            place_id = place.get("place_id")
            if not place_id:
                return

            types = place.get("types") or []
            lead = {
                "place_id": place_id,
                "name": place.get("name", ""),
                "address": place.get("formatted_address", ""),
                "phone": place.get("formatted_phone_number", ""),
                "website": place.get("website", ""),
                "rating": place.get("rating"),
                "reviews_count": place.get("user_ratings_total"),
                "category": ", ".join(types[:2]),
                "search_query": query,
                "search_zone": place.get("search_zone", zones[0]),
                "scraped_at": datetime.now(timezone.utc).isoformat(),
                "email": None,
            }

            cached_email = existing.get(place_id)

            if cached_email is not None:
                lead["email"] = cached_email
                skip_count += 1
            elif lead["website"]:
                new_count += 1
                lead["email"] = await scraper.extract(lead["website"])
            else:
                new_count += 1

            await loop.run_in_executor(None, upsert_lead, lead)

            progress["done"] += 1
            await q.put({
                "type": "scraping",
                "message": f"({progress['done']}/{total}) {lead['name']}{' — ' + lead['email'] if lead['email'] else ''}",
                "index": progress["done"],
                "total": total,
            })
            await q.put({"type": "lead", "data": lead})

        # Launch all concurrently — scraper's internal semaphore bounds parallelism
        await asyncio.gather(*(process(i, p) for i, p in enumerate(places_list)))

        await q.put({
            "type": "done",
            "total": total,
            "new": new_count,
            "skipped": skip_count,
        })

    except Exception as e:
        await q.put({"type": "error", "message": str(e)})

    finally:
        await scraper.close()
        await q.put(None)


# ── Search endpoints (admin only) ────────────────────────────────────────────

@app.post("/api/search")
async def start_search(req: SearchRequest, _: CurrentUser = Depends(require_admin)):
    job_id = str(uuid.uuid4())
    state = JobState()
    jobs[job_id] = state
    state.task = asyncio.create_task(run_search(job_id, req.query, req.zones, req.max_results))
    return {"job_id": job_id}


@app.post("/api/search/{job_id}/cancel")
async def cancel_search(job_id: str, _: CurrentUser = Depends(require_admin)):
    state = jobs.get(job_id)
    if not state:
        raise HTTPException(status_code=404, detail="Job no encontrado")
    state.cancel_event.set()
    return {"ok": True}


async def event_generator(job_id: str) -> AsyncIterator[str]:
    state = jobs.get(job_id)
    if not state:
        yield f"data: {json.dumps({'type': 'error', 'message': 'Job no encontrado'})}\n\n"
        return

    while True:
        event = await state.queue.get()
        if event is None:
            break
        yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    jobs.pop(job_id, None)


@app.get("/api/search/{job_id}/stream")
async def stream_search(job_id: str, _: CurrentUser = Depends(require_admin)):
    return StreamingResponse(
        event_generator(job_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Auth ─────────────────────────────────────────────────────────────────────

@app.get("/api/me")
async def me(user: CurrentUser = Depends(require_user)):
    return {"id": user.id, "email": user.email, "role": user.role, "zones": user.zones}


# ── Leads (role-aware) ───────────────────────────────────────────────────────

def _visible_zones(user: CurrentUser) -> list[str] | None:
    """None → all zones (admin); otherwise restrict to assigned zones."""
    if user.is_admin:
        return None
    return user.zones


@app.get("/api/leads")
async def get_leads(user: CurrentUser = Depends(require_user)):
    zones = _visible_zones(user)
    return get_all_leads(zones=zones)


@app.patch("/api/leads/{place_id}/status")
async def patch_status(place_id: str, body: StatusUpdate, user: CurrentUser = Depends(require_user)):
    if body.status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail="Status inválido")

    # Vendedor solo puede tocar leads de sus zonas
    if not user.is_admin:
        leads = get_all_leads(zones=user.zones)
        if not any(l["place_id"] == place_id for l in leads):
            raise HTTPException(status_code=403, detail="Lead fuera de tus zonas asignadas")

    updated = update_lead_status(place_id, body.status, user.id, body.notes)
    if not updated:
        raise HTTPException(status_code=404, detail="Lead no encontrado")
    return updated


@app.get("/api/leads/export")
async def export_leads(user: CurrentUser = Depends(require_user)):
    leads = get_all_leads(zones=_visible_zones(user))
    if not leads:
        return Response(content="Sin leads", media_type="text/plain")

    fields = ["name", "address", "phone", "website", "email", "status", "rating",
              "reviews_count", "category", "search_query", "search_zone", "notes", "scraped_at"]

    buf = io.StringIO()
    writer = csv.writer(buf, quoting=csv.QUOTE_MINIMAL, lineterminator="\n")
    writer.writerow(fields)
    for lead in leads:
        writer.writerow([lead.get(f) if lead.get(f) is not None else "" for f in fields])

    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=leads_scala.csv"},
    )


# ── Admin: sellers & zones ───────────────────────────────────────────────────

@app.get("/api/admin/sellers")
async def get_sellers(_: CurrentUser = Depends(require_admin)):
    sellers = list_sellers()
    assignments = get_all_zone_assignments()
    for s in sellers:
        s["zones"] = assignments.get(s["id"], [])
    return sellers


@app.put("/api/admin/sellers/{user_id}/zones")
async def put_seller_zones(user_id: str, body: SellerZonesPayload, _: CurrentUser = Depends(require_admin)):
    set_seller_zones(user_id, [z.strip() for z in body.zones if z.strip()])
    return {"ok": True, "zones": get_seller_zones(user_id)}


@app.get("/api/admin/zones")
async def get_zones(_: CurrentUser = Depends(require_admin)):
    """All distinct zones present in leads — useful for the zone picker."""
    return list_distinct_zones()


# ── Run ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=9001, reload=False)
