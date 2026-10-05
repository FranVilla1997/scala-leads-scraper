"""Transcripción de grabaciones (Whisper) + análisis post-llamada.

Diseñado para que el mismo pipeline sirva tanto para llamadas grabadas por un
humano desde el navegador como para audio que devuelva un agente IA más adelante.
"""
from __future__ import annotations

import json

import httpx

from config import OPENAI_API_KEY, WHISPER_MODEL, ANALYSIS_MODEL

OPENAI_BASE = "https://api.openai.com/v1"

# ~$0.006 por minuto de audio (Whisper)
WHISPER_USD_PER_MINUTE = 0.006


class TranscriptionUnavailable(RuntimeError):
    """Se levanta cuando no hay API key configurada."""


def _require_key() -> str:
    if not OPENAI_API_KEY:
        raise TranscriptionUnavailable(
            "OPENAI_API_KEY no configurado — la transcripción está deshabilitada"
        )
    return OPENAI_API_KEY


# ── Transcripción ────────────────────────────────────────────────────────────

def transcribe_audio(audio_bytes: bytes, filename: str = "call.webm") -> str:
    """Devuelve el texto transcripto del audio (español)."""
    key = _require_key()
    with httpx.Client(timeout=180) as client:
        resp = client.post(
            f"{OPENAI_BASE}/audio/transcriptions",
            headers={"Authorization": f"Bearer {key}"},
            files={"file": (filename, audio_bytes, "application/octet-stream")},
            data={
                "model": WHISPER_MODEL,
                "language": "es",
                # Ayuda al modelo con jerga rioplatense y nombres propios
                "prompt": "Llamada comercial en español rioplatense de Argentina. "
                          "Se habla de marketing, sitios web, presencia digital y reuniones.",
            },
        )
        resp.raise_for_status()
        return (resp.json() or {}).get("text", "").strip()


def estimate_transcription_cost(duration_seconds: int | None) -> float:
    if not duration_seconds:
        return 0.0
    return round((duration_seconds / 60.0) * WHISPER_USD_PER_MINUTE, 4)


# ── Análisis post-llamada ────────────────────────────────────────────────────

_ANALYSIS_SCHEMA = {
    "resumen": "1-2 oraciones sobre qué pasó en la llamada",
    "sentimiento": "positivo | neutral | negativo",
    "nivel_interes": "alto | medio | bajo | ninguno",
    "objeciones": ["lista de objeciones que planteó el prospecto"],
    "compromiso": "qué se acordó concretamente, o null",
    "proximo_paso_sugerido": "qué conviene hacer después",
    "pidio_no_contactar": "true si pidió explícitamente que no lo llamen más",
}

_SYSTEM = (
    "Sos un analista de llamadas comerciales. Recibís la transcripción de una "
    "llamada en frío hecha a un negocio en Argentina y devolvés un análisis "
    "estructurado en JSON. Sé conciso y objetivo. Si la transcripción es muy "
    "corta o no hubo conversación real, indicá nivel_interes 'ninguno'."
)


def analyze_transcript(transcript: str) -> dict:
    """Extrae resumen, sentimiento, objeciones y próximo paso de la transcripción."""
    if not transcript or len(transcript.strip()) < 20:
        return {
            "resumen": "Sin conversación registrada.",
            "sentimiento": "neutral",
            "nivel_interes": "ninguno",
            "objeciones": [],
            "compromiso": None,
            "proximo_paso_sugerido": None,
            "pidio_no_contactar": False,
        }

    key = _require_key()
    with httpx.Client(timeout=90) as client:
        resp = client.post(
            f"{OPENAI_BASE}/chat/completions",
            headers={"Authorization": f"Bearer {key}"},
            json={
                "model": ANALYSIS_MODEL,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": _SYSTEM},
                    {
                        "role": "user",
                        "content": (
                            f"Devolvé un JSON con exactamente estas claves:\n"
                            f"{json.dumps(_ANALYSIS_SCHEMA, ensure_ascii=False, indent=2)}\n\n"
                            f"Transcripción:\n\"\"\"\n{transcript[:12000]}\n\"\"\""
                        ),
                    },
                ],
            },
        )
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"]

    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        return {}

    # Normalizar valores a los enums que acepta la DB
    sentiment = str(data.get("sentimiento", "")).lower()
    if sentiment not in ("positivo", "neutral", "negativo"):
        sentiment = "neutral"

    interest = str(data.get("nivel_interes", "")).lower()
    if interest not in ("alto", "medio", "bajo", "ninguno"):
        interest = "ninguno"

    objections = data.get("objeciones") or []
    if not isinstance(objections, list):
        objections = [str(objections)]

    return {
        "resumen": data.get("resumen"),
        "sentimiento": sentiment,
        "nivel_interes": interest,
        "objeciones": [str(o) for o in objections][:10],
        "compromiso": data.get("compromiso"),
        "proximo_paso_sugerido": data.get("proximo_paso_sugerido"),
        "pidio_no_contactar": bool(data.get("pidio_no_contactar")),
    }


def process_recording(audio_bytes: bytes, filename: str, duration_seconds: int | None) -> dict:
    """Transcribe + analiza. Devuelve los campos listos para persistir en `calls`."""
    transcript = transcribe_audio(audio_bytes, filename)
    analysis = analyze_transcript(transcript)
    return {
        "transcript": transcript,
        "transcript_status": "listo",
        "summary": analysis.get("resumen"),
        "sentiment": analysis.get("sentimiento"),
        "interest_level": analysis.get("nivel_interes"),
        "objections": analysis.get("objeciones") or [],
        "cost_usd": estimate_transcription_cost(duration_seconds),
        "_next_step": analysis.get("proximo_paso_sugerido"),
        "_do_not_call": analysis.get("pidio_no_contactar", False),
    }
