import asyncio
import csv
import io
import json
import uuid
from datetime import datetime, timezone
from typing import AsyncIterator, Literal

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel

from auth import CurrentUser, require_admin, require_user
from config import FRONTEND_URL, SCRAPER_CONCURRENCY
from db import (
    create_call, create_seller, get_all_leads, get_all_zone_assignments,
    get_call, get_call_metrics, get_call_queue, get_existing_emails,
    get_seller_zones, list_calls, list_distinct_zones, list_sellers,
    set_do_not_call, set_seller_active, set_seller_zones, update_call,
    update_lead_status, upload_recording, upsert_lead,
)
from places import search_places
from scraper import EmailScraper
from transcribe import TranscriptionUnavailable, process_recording

app = FastAPI(title="Scala Leads Scraper")

_origins = ["http://localhost:5173", "http://localhost:3000", "http://localhost:5174"]
if FRONTEND_URL:
    _origins.extend([u.strip() for u in FRONTEND_URL.split(",") if u.strip()])

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_origin_regex=r"https://.*\.vercel\.app",
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
    # Soporta tanto `query` (single, legacy) como `queries` (multi).
    query: str | None = None
    queries: list[str] | None = None
    zones: list[str]
    max_results: int = 60

    def normalized_queries(self) -> list[str]:
        out: list[str] = []
        if self.queries:
            out.extend(self.queries)
        if self.query:
            out.append(self.query)
        # dedupe preservando orden + strip
        seen: set[str] = set()
        result: list[str] = []
        for q in out:
            q = q.strip()
            if q and q.lower() not in seen:
                seen.add(q.lower())
                result.append(q)
        return result


class StatusUpdate(BaseModel):
    status: Literal["nuevo", "contactado", "interesado", "cerrado_ganado", "cerrado_perdido"]
    notes: str | None = None


class SellerZonesPayload(BaseModel):
    zones: list[str]


class CreateSellerPayload(BaseModel):
    email: str
    password: str
    full_name: str | None = None


class ActivePayload(BaseModel):
    active: bool


DISPOSITIONS = Literal[
    "no_atendio", "buzon", "gatekeeper", "no_interesado", "interesado",
    "cita_agendada", "llamar_despues", "numero_equivocado", "no_llamar",
]


class CallCreate(BaseModel):
    place_id: str
    disposition: DISPOSITIONS
    notes: str | None = None
    next_step: str | None = None
    next_action_at: datetime | None = None
    appointment_at: datetime | None = None
    contact_name: str | None = None
    contact_email: str | None = None
    duration_seconds: int | None = None
    caller_type: Literal["humano", "agente_ia"] = "humano"


class CallUpdate(BaseModel):
    disposition: DISPOSITIONS | None = None
    notes: str | None = None
    next_step: str | None = None
    next_action_at: datetime | None = None
    appointment_at: datetime | None = None
    contact_name: str | None = None
    contact_email: str | None = None


class DoNotCallPayload(BaseModel):
    do_not_call: bool = True


# ── Search job ───────────────────────────────────────────────────────────────

async def run_search(job_id: str, queries: list[str], zones: list[str], max_results: int = 60) -> None:
    state = jobs[job_id]
    q = state.queue
    loop = asyncio.get_event_loop()
    scraper = EmailScraper(concurrency=SCRAPER_CONCURRENCY)

    try:
        grid_note = " con grilla" if max_results > 60 else ""
        zones_label = ", ".join(zones)
        queries_label = ", ".join(f"'{x}'" for x in queries)
        await q.put({
            "type": "status",
            "message": f"Buscando {queries_label} en {zones_label}{grid_note}...",
        })

        all_places: dict[str, dict] = {}
        combos = [(qi, query, zi, zone) for qi, query in enumerate(queries) for zi, zone in enumerate(zones)]

        for idx, (qi, query, zi, zone) in enumerate(combos):
            if state.cancel_event.is_set():
                await q.put({"type": "status", "message": "Cancelado por el usuario"})
                return
            await q.put({
                "type": "status",
                "message": f"[{idx + 1}/{len(combos)}] '{query}' en {zone}...",
            })
            places = await loop.run_in_executor(None, search_places, query, zone, max_results)
            for p in places:
                pid = p.get("place_id")
                if pid and pid not in all_places:
                    p["search_zone"] = zone
                    p["search_query"] = query  # tag con la query que lo encontró primero
                    all_places[pid] = p

        places_list = list(all_places.values())
        total = len(places_list)

        existing = await loop.run_in_executor(None, get_existing_emails)

        await q.put({
            "type": "status",
            "message": f"Encontrados {total} negocios únicos ({len(queries)} keyword(s) × {len(zones)} zona(s)). Extrayendo emails...",
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
                "search_query": place.get("search_query", queries[0]),
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
    queries = req.normalized_queries()
    if not queries:
        raise HTTPException(status_code=400, detail="Necesitás al menos una keyword")
    if not req.zones:
        raise HTTPException(status_code=400, detail="Necesitás al menos una zona")
    job_id = str(uuid.uuid4())
    state = JobState()
    jobs[job_id] = state
    state.task = asyncio.create_task(run_search(job_id, queries, req.zones, req.max_results))
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


# ── Llamadas ─────────────────────────────────────────────────────────────────

def _assert_lead_visible(place_id: str, user: CurrentUser) -> None:
    """Un vendedor solo puede operar sobre leads de sus zonas."""
    if user.is_admin:
        return
    leads = get_all_leads(zones=user.zones)
    if not any(l["place_id"] == place_id for l in leads):
        raise HTTPException(status_code=403, detail="Lead fuera de tus zonas asignadas")


@app.post("/api/calls")
async def post_call(body: CallCreate, user: CurrentUser = Depends(require_user)):
    """Registra el resultado de una llamada (humana o del agente)."""
    _assert_lead_visible(body.place_id, user)

    payload = body.model_dump(exclude_none=True)
    for field in ("next_action_at", "appointment_at"):
        if payload.get(field):
            payload[field] = payload[field].isoformat()

    payload.update({
        "caller_id": user.id,
        "caller_email": user.email,
        "started_at": datetime.now(timezone.utc).isoformat(),
    })

    call = create_call(payload)
    if not call:
        raise HTTPException(status_code=500, detail="No se pudo registrar la llamada")
    return call


@app.patch("/api/calls/{call_id}")
async def patch_call(call_id: str, body: CallUpdate, user: CurrentUser = Depends(require_user)):
    existing = get_call(call_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Llamada no encontrada")
    _assert_lead_visible(existing["place_id"], user)

    patch = body.model_dump(exclude_none=True)
    for field in ("next_action_at", "appointment_at"):
        if patch.get(field):
            patch[field] = patch[field].isoformat()

    updated = update_call(call_id, patch)
    if not updated:
        raise HTTPException(status_code=500, detail="No se pudo actualizar")
    return updated


@app.post("/api/calls/{call_id}/audio")
async def post_call_audio(
    call_id: str,
    file: UploadFile = File(...),
    duration_seconds: int | None = Form(default=None),
    user: CurrentUser = Depends(require_user),
):
    """Sube la grabación, la transcribe y guarda el análisis post-llamada."""
    existing = get_call(call_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Llamada no encontrada")
    _assert_lead_visible(existing["place_id"], user)

    audio = await file.read()
    if not audio:
        raise HTTPException(status_code=400, detail="Audio vacío")

    ext = (file.filename or "audio.webm").rsplit(".", 1)[-1][:8] or "webm"
    path = f"{existing['place_id']}/{call_id}.{ext}"

    loop = asyncio.get_event_loop()
    url = await loop.run_in_executor(
        None, upload_recording, path, audio, file.content_type or "audio/webm"
    )

    patch: dict = {
        "recording_path": path,
        "recording_url": url,
        "transcript_source": "browser",
        "transcript_status": "pendiente",
    }
    if duration_seconds:
        patch["duration_seconds"] = duration_seconds
    update_call(call_id, patch)

    # Transcribir + analizar
    try:
        result = await loop.run_in_executor(
            None, process_recording, audio, file.filename or "call.webm", duration_seconds
        )
    except TranscriptionUnavailable as e:
        update_call(call_id, {"transcript_status": "error"})
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        update_call(call_id, {"transcript_status": "error"})
        raise HTTPException(status_code=500, detail=f"Error al transcribir: {e}")

    suggested_step = result.pop("_next_step", None)
    asked_no_contact = result.pop("_do_not_call", False)

    if suggested_step and not existing.get("next_step"):
        result["next_step"] = suggested_step

    updated = update_call(call_id, result)

    if asked_no_contact:
        set_do_not_call(existing["place_id"], True)

    return updated


@app.get("/api/calls")
async def get_calls(place_id: str | None = None, user: CurrentUser = Depends(require_user)):
    zones = None if user.is_admin else user.zones
    return list_calls(zones=zones, place_id=place_id)


@app.get("/api/calls/queue")
async def get_queue(user: CurrentUser = Depends(require_user)):
    zones = None if user.is_admin else user.zones
    return get_call_queue(zones=zones)


@app.get("/api/calls/metrics")
async def get_metrics(user: CurrentUser = Depends(require_user)):
    zones = None if user.is_admin else user.zones
    return get_call_metrics(zones=zones)


@app.patch("/api/leads/{place_id}/do-not-call")
async def patch_do_not_call(place_id: str, body: DoNotCallPayload,
                            user: CurrentUser = Depends(require_user)):
    _assert_lead_visible(place_id, user)
    set_do_not_call(place_id, body.do_not_call)
    return {"ok": True, "do_not_call": body.do_not_call}


# ── Admin: sellers & zones ───────────────────────────────────────────────────

@app.get("/api/admin/sellers")
async def get_sellers(_: CurrentUser = Depends(require_admin)):
    sellers = list_sellers()
    assignments = get_all_zone_assignments()
    for s in sellers:
        s["zones"] = assignments.get(s["id"], [])
    return sellers


@app.post("/api/admin/sellers")
async def post_seller(body: CreateSellerPayload, _: CurrentUser = Depends(require_admin)):
    email = body.email.strip().lower()
    if not email or len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Email y password (mín 6 chars) requeridos")
    try:
        return create_seller(email=email, password=body.password, full_name=body.full_name)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"No se pudo crear: {e}")


@app.put("/api/admin/sellers/{user_id}/zones")
async def put_seller_zones(user_id: str, body: SellerZonesPayload, _: CurrentUser = Depends(require_admin)):
    set_seller_zones(user_id, [z.strip() for z in body.zones if z.strip()])
    return {"ok": True, "zones": get_seller_zones(user_id)}


@app.patch("/api/admin/sellers/{user_id}/active")
async def patch_seller_active(user_id: str, body: ActivePayload, _: CurrentUser = Depends(require_admin)):
    set_seller_active(user_id, body.active)
    return {"ok": True}


@app.get("/api/admin/zones")
async def get_zones(_: CurrentUser = Depends(require_admin)):
    """All distinct zones present in leads — useful for the zone picker."""
    return list_distinct_zones()


@app.get("/api/admin/stats")
async def get_stats(_: CurrentUser = Depends(require_admin)):
    """Dashboard payload: KPIs + lead distribution + per-seller performance."""
    from collections import Counter, defaultdict
    from datetime import datetime, timedelta, timezone

    leads = get_all_leads(zones=None)
    sellers = list_sellers()
    assignments = get_all_zone_assignments()

    now = datetime.now(timezone.utc)
    d7  = now - timedelta(days=7)
    d30 = now - timedelta(days=30)

    def _parse(s: str | None) -> datetime | None:
        if not s: return None
        try:
            return datetime.fromisoformat(s.replace("Z", "+00:00"))
        except Exception:
            return None

    total = len(leads)
    with_email = sum(1 for l in leads if l.get("email"))
    by_status = Counter(l.get("status") or "nuevo" for l in leads)
    by_zone   = Counter(l.get("search_zone") for l in leads if l.get("search_zone"))
    by_query  = Counter(l.get("search_query") for l in leads if l.get("search_query"))

    by_category: Counter = Counter()
    for l in leads:
        for c in (l.get("category") or "").split(","):
            c = c.strip()
            if c: by_category[c] += 1

    # Activity (created) last 30 days, by date
    activity_30d: dict[str, int] = defaultdict(int)
    for l in leads:
        ts = _parse(l.get("scraped_at"))
        if ts and ts >= d30:
            activity_30d[ts.date().isoformat()] += 1

    # Activity (updates) — counted by `updated_by`
    updates_7d:  Counter = Counter()
    updates_30d: Counter = Counter()
    for l in leads:
        upd_by = l.get("updated_by")
        upd_at = _parse(l.get("updated_at"))
        if not upd_by or not upd_at: continue
        if upd_at >= d7:  updates_7d[upd_by] += 1
        if upd_at >= d30: updates_30d[upd_by] += 1

    # Zone → seller list (vendedores only)
    zone_to_sellers: dict[str, list[str]] = defaultdict(list)
    for s in sellers:
        if s["role"] != "vendedor": continue
        for z in assignments.get(s["id"], []):
            zone_to_sellers[z].append(s["id"])

    # Per-seller aggregation
    per_seller: dict[str, dict] = {}
    for s in sellers:
        if s["role"] != "vendedor": continue
        per_seller[s["id"]] = {
            "id": s["id"],
            "email": s["email"],
            "full_name": s.get("full_name"),
            "active": s.get("active", True),
            "zones": assignments.get(s["id"], []),
            "total_assigned": 0,
            "by_status": {st: 0 for st in ("nuevo","contactado","interesado","cerrado_ganado","cerrado_perdido")},
            "with_email": 0,
            "updates_7d": updates_7d.get(s["id"], 0),
            "updates_30d": updates_30d.get(s["id"], 0),
        }

    for l in leads:
        owners = zone_to_sellers.get(l.get("search_zone") or "", [])
        for sid in owners:
            agg = per_seller.get(sid)
            if not agg: continue
            agg["total_assigned"] += 1
            st = l.get("status") or "nuevo"
            if st in agg["by_status"]:
                agg["by_status"][st] += 1
            if l.get("email"):
                agg["with_email"] += 1

    # Conversion % por vendedor (contactado o mejor / total)
    for s in per_seller.values():
        t = s["total_assigned"] or 1
        contacted_plus = s["by_status"]["contactado"] + s["by_status"]["interesado"] + s["by_status"]["cerrado_ganado"] + s["by_status"]["cerrado_perdido"]
        won = s["by_status"]["cerrado_ganado"]
        s["contact_rate"] = round(contacted_plus / t * 100, 1)
        s["win_rate"]     = round(won / t * 100, 1)

    return {
        "overview": {
            "total": total,
            "with_email": with_email,
            "without_email": total - with_email,
            "email_rate": round(with_email / total * 100, 1) if total else 0,
            "by_status": dict(by_status),
            "scraped_last_7d":  sum(1 for l in leads if (ts := _parse(l.get("scraped_at"))) and ts >= d7),
            "scraped_last_30d": sum(1 for l in leads if (ts := _parse(l.get("scraped_at"))) and ts >= d30),
        },
        "top_zones":      [{"zone": z, "count": c} for z, c in by_zone.most_common(10)],
        "top_categories": [{"category": k, "count": c} for k, c in by_category.most_common(10)],
        "top_queries":    [{"query": q, "count": c} for q, c in by_query.most_common(10)],
        "activity_30d":   [{"date": d, "count": activity_30d[d]} for d in sorted(activity_30d.keys())],
        "sellers":        sorted(per_seller.values(), key=lambda x: x["by_status"]["cerrado_ganado"], reverse=True),
    }


# ── Run ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=9001, reload=False)
