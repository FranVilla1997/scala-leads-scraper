import asyncio
import json
import uuid
from datetime import datetime, timezone
from typing import AsyncIterator

from fastapi import FastAPI, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel

from db import upsert_lead, get_all_leads, get_existing_emails
from places import search_places
from scraper import extract_email_sync
from config import FRONTEND_URL

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

jobs: dict[str, asyncio.Queue] = {}


class SearchRequest(BaseModel):
    query: str
    zones: list[str]
    max_results: int = 60


async def run_search(job_id: str, query: str, zones: list[str], max_results: int = 60) -> None:
    q = jobs[job_id]
    loop = asyncio.get_event_loop()

    try:
        grid_note = " con grilla" if max_results > 60 else ""
        zones_label = ", ".join(zones)
        await q.put({"type": "status", "message": f"Buscando '{query}' en {zones_label}{grid_note}..."})

        # Collect all places across zones (deduplicated by place_id)
        all_places: dict[str, dict] = {}
        for zi, zone in enumerate(zones):
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

        for i, place in enumerate(places_list):
            place_id = place.get("place_id")
            if not place_id:
                continue

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
                await q.put({
                    "type": "scraping",
                    "message": f"({i + 1}/{total}) {lead['name']} — ya existe",
                    "index": i + 1,
                    "total": total,
                })
            elif lead["website"]:
                new_count += 1
                await q.put({
                    "type": "scraping",
                    "message": f"({i + 1}/{total}) Extrayendo email de {lead['name']}...",
                    "index": i + 1,
                    "total": total,
                })
                lead["email"] = await loop.run_in_executor(None, extract_email_sync, lead["website"])
            else:
                new_count += 1
                await q.put({
                    "type": "scraping",
                    "message": f"({i + 1}/{total}) {lead['name']} — sin sitio web",
                    "index": i + 1,
                    "total": total,
                })

            await loop.run_in_executor(None, upsert_lead, lead)
            await q.put({"type": "lead", "data": lead})

        await q.put({
            "type": "done",
            "total": total,
            "new": new_count,
            "skipped": skip_count,
        })

    except Exception as e:
        await q.put({"type": "error", "message": str(e)})

    finally:
        await q.put(None)


@app.post("/api/search")
async def start_search(req: SearchRequest, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())
    jobs[job_id] = asyncio.Queue()
    background_tasks.add_task(run_search, job_id, req.query, req.zones, req.max_results)
    return {"job_id": job_id}


async def event_generator(job_id: str) -> AsyncIterator[str]:
    q = jobs.get(job_id)
    if not q:
        yield f"data: {json.dumps({'type': 'error', 'message': 'Job no encontrado'})}\n\n"
        return

    while True:
        event = await q.get()
        if event is None:
            break
        yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    jobs.pop(job_id, None)


@app.get("/api/search/{job_id}/stream")
async def stream_search(job_id: str):
    return StreamingResponse(
        event_generator(job_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/leads")
async def get_leads():
    return get_all_leads()


@app.get("/api/leads/export")
async def export_leads():
    leads = get_all_leads()
    if not leads:
        return Response(content="Sin leads", media_type="text/plain")

    fields = ["name", "address", "phone", "website", "email", "rating",
              "reviews_count", "category", "search_query", "search_zone", "scraped_at"]
    lines = [",".join(fields)]
    for lead in leads:
        row = [str(lead.get(f) or "").replace(",", ";").replace("\n", " ") for f in fields]
        lines.append(",".join(row))

    return Response(
        content="\n".join(lines),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=leads_scala.csv"},
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=9001, reload=False)

