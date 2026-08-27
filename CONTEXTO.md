# CONTEXTO DEL PROYECTO — Scala Leads Scraper

> **Para Claude Code en una máquina nueva:** leé este documento completo antes de tocar nada.
> Resume todo lo desarrollado y decidido hasta ahora (agosto 2026). El dueño del proyecto es
> Franco (francovillayoma@gmail.com), fundador de **Scala** (agencia de marketing/desarrollo, Argentina).
> Trato: en español rioplatense, directo, sin vueltas.

---

## 1. Qué es esto

Sistema de **generación y gestión de leads B2B** para Scala. Scrapea negocios de Google Maps
por rubro y zona, les extrae emails de sus webs, los asigna a vendedores por zona, y registra
todo el trabajo de llamadas en frío (con grabación y transcripción). El objetivo final es que un
**agente de voz IA** haga el primer contacto telefónico a escala (~1.000 llamadas/día), califique
interés, y pase citas a closers humanos.

**Flujo de negocio:** scrapear → llamar (hoy humano, mañana IA) → calificar → agendar cita → closer vende.

## 2. Stack y URLs

| Pieza | Tech | Producción |
|---|---|---|
| Frontend | React + Vite + Tailwind | https://scala-leads-frontend.vercel.app (Vercel, proyecto `scala-leads-frontend`, cuenta franvilla1997) |
| Backend | FastAPI (Python) | https://scala-leads-backend-production.up.railway.app (Railway, proyecto `scala-leads-backend`, plan Hobby) |
| DB + Auth + Storage | Supabase | Proyecto ref `txqtysahvgxbpkjdrukt` → https://supabase.com/dashboard/project/txqtysahvgxbpkjdrukt |
| Repo | GitHub | https://github.com/FranVilla1997/scala-leads-scraper |

- **Branch de trabajo:** `feat/auth-roles-scraper-optimizations` (PR #1 abierto contra `master`, todavía sin mergear — todo el desarrollo vive en esta branch).
- Swagger del backend: `/docs` en la URL de Railway.
- Deploy backend: `cd backend && railway up --service scala-leads-backend --detach`
- Deploy frontend: `cd frontend && vercel deploy --prod --yes`
- Ambos CLIs (railway, vercel) estaban logueados en la máquina anterior; en una nueva hay que hacer `railway login` y `vercel login` + `vercel link` (proyecto `scala-leads-frontend`, root `frontend`).

## 3. Variables de entorno (los VALORES no están en el repo)

Los `.env` están gitignoreados. En la máquina nueva hay que recrearlos:

**`backend/.env`** — valores: sacarlos de Railway (`railway variables`) o del dashboard:
```
GOOGLE_PLACES_API_KEY=      # Google Cloud
SUPABASE_URL=https://txqtysahvgxbpkjdrukt.supabase.co
SUPABASE_SERVICE_KEY=       # Supabase → Settings → API → service_role
SUPABASE_JWT_SECRET=        # Supabase → Settings → API → Legacy JWT Secret (HS256; el backend también valida ES256 vía JWKS)
FRONTEND_URL=https://scala-leads-frontend.vercel.app
SCRAPER_CONCURRENCY=8
PLACES_RATE_RPS=8
OPENAI_API_KEY=             # para Whisper + análisis post-llamada
WHISPER_MODEL=whisper-1
ANALYSIS_MODEL=gpt-4o-mini
RECORDINGS_BUCKET=call-recordings
```

**`frontend/.env`**:
```
VITE_API_URL=http://localhost:9001        # en Vercel apunta a Railway
VITE_SUPABASE_URL=https://txqtysahvgxbpkjdrukt.supabase.co
VITE_SUPABASE_ANON_KEY=                   # Supabase → Settings → API → anon public
```

Correr local: `start.bat` (levanta backend puerto 9001 + frontend 5173). Backend necesita
`pip install -r backend/requirements.txt` y `playwright install chromium`.

## 4. Base de datos (Supabase, schema public)

Migraciones en `backend/migrations/` — **ya ejecutadas** en el proyecto:

- `001_init.sql`: `scraping_leads` (leads, PK place_id, con status/notes/do_not_call/etc.),
  `users_profile` (rol admin|vendedor, trigger auto-crea perfil al crear user en Auth),
  `seller_zones` (asignación vendedor↔zona).
- `002_calls.sql`: tabla `calls` (disposición, notas, próximo paso, cita, grabación, transcripción,
  análisis post-llamada, duración, costo), columnas nuevas en leads (`do_not_call`, `last_called_at`,
  `call_count`, `next_action_at`), trigger que sincroniza el lead con cada llamada insertada,
  bucket privado Storage `call-recordings`.

**Auth:** Supabase Auth (email+password). El backend valida JWT (ES256 vía JWKS con fallback HS256, leeway 60s).
Roles: `admin` (Franco, franco@scala.com) ve todo + tabs Scraper/Dashboard/Vendedores; `vendedor` solo ve
leads de sus zonas asignadas. Los vendedores se crean desde la UI (tab Vendedores) — usa la Admin API de Supabase.

## 5. Funcionalidades ya construidas

1. **Scraper**: multi-keyword × multi-zona (producto cartesiano), grilla geográfica para >60 resultados
   (geocoding vía Nominatim con fallback a Places; Places API v1 con rate limit y retry), extracción de
   emails httpx-first con fallback Playwright (browser compartido), deobfuscación de emails, progreso SSE en vivo.
2. **Base de datos (tab)**: filtros (zona, keyword, tipo de negocio, estado, vendedor, con/sin email),
   orden por calidad (score bayesiano rating×reseñas), paginación, export CSV, edición inline de estado,
   botón llamar y botón WhatsApp por lead.
3. **Vendedores (tab admin)**: crear vendedor (email+pass), activar/desactivar, asignar zonas.
4. **Dashboard (tab admin)**: estadísticas de leads + rendimiento por vendedor (tipo `AdminStats` en types.ts).
5. **Sistema de llamadas (tab Llamadas)** — lo más reciente:
   - Cola "a quién llamo hoy": seguimientos vencidos → nunca llamados (por calidad) → reintentar (+7 días).
   - Panel de llamada (`CallPanel.tsx`): contexto del lead a la vista, grabación por navegador (MediaRecorder,
     celular en altavoz) **o subir archivo de audio** grabado en el celular, 9 disposiciones
     (`no_atendio, buzon, gatekeeper, no_interesado, interesado, cita_agendada, llamar_despues, numero_equivocado, no_llamar`),
     campos de cita con atajos 24/48/72hs, próximo paso con presets (1 sem / 1 mes / 3 meses), historial con
     reproductor de audio, guard anti-pérdida de grabación sin guardar.
   - Transcripción: Whisper (es) + análisis con LLM (resumen, sentimiento, nivel de interés, objeciones,
     próximo paso sugerido, detección de "no me llamen más" → auto-setea `do_not_call`).
   - Transcripción diferida: si falla (ej. sin crédito), botones "Transcribir ahora" (por llamada) y
     "Transcribir N pendientes" (batch). Endpoint `/api/calls/{id}/recording-url` re-firma URLs vencidas (7 días).
   - KPIs: llamadas, conversaciones, citas, llamadas-por-cita, costo-por-cita.
   - Botón **"Enviar WhatsApp"** (wa.me con mensaje precargado "Hola, me darías más información por favor?" —
     táctica mystery-shopper). Helper `frontend/src/lib/phone.ts` normaliza números argentinos (saca 0 y 15, agrega 549).

## 6. Estado actual y pendientes inmediatos

- ⚠️ **La cuenta de OpenAI está SIN CRÉDITO** → transcripción caída. Franco tiene que cargar ~USD 5 en
  platform.openai.com/settings/organization/billing. Después: tab Llamadas → "Transcribir pendientes".
- **Franco está haciendo las primeras llamadas A MANO** (arrancó ~24 ago 2026) para aprender el proceso antes
  de delegarlo a vendedores y después al agente IA. Ya hay 1+ llamada registrada con audio.
  Objetivo: ~300 llamadas para tener ratios propios (conexión, conversación→cita, costo/cita).
- El sistema de llamadas fue diseñado para que `caller_type='agente_ia'` escriba en la misma tabla `calls`
  sin cambios de schema.

**Roadmap acordado (en orden):**
1. Piloto manual 300 llamadas → medir ratios reales en los KPIs del tab Llamadas.
2. **Campaign runner**: seleccionar leads filtrados → lanzar llamadas vía API de Retell → webhook
   `call_analyzed` escribe en `calls` (con dry-run si no hay API key). *Aún no construido.*
3. Cuenta Retell + **clonar voz argentina** (el acento rioplatense es crítico — las voces stock no sirven).
4. SIP trunk argentino + pool de números con rotación anti-spam (para escalar a 1.000/día).
5. Sweep automático de scraping (categorías × zonas) para alimentar volumen.
6. Sender de seguimiento (WhatsApp/email post-cita) — canal aún no decidido, los triggers ya existen
   (análisis post-llamada + `next_action_at`).

## 7. Decisiones tomadas y por qué (investigación hecha)

**Plataforma de voz:** Retell AI (menor latencia ~600ms, $0.07/min base, 31+ idiomas, pay-as-you-go).
Alternativas evaluadas: Vapi (más caro real, facturación fragmentada), Bland (latencia peor), Fonema AI
(español nativo LATAM, evaluar como alternativa), Air AI (**EVITAR** — baneada por la FTC en 2026, 1.2★ Trustpilot).
TTS: ElevenLabs v3 (mejor español/realismo) con opción de migrar a Cartesia Sonic (40ms, 3-4x más barato) si
la latencia molesta. **La voz se clona** (~3 min de audio) para acento argentino. El TTS es intercambiable
dentro de Retell — no es una decisión irreversible.

**Costos reales investigados** (los precios de homepage mienten 2-5x):
- Costo total por minuto all-in: $0.13–0.31/min (Retell config estándar ~$0.125/min).
- Duración promedio real por llamada: ~0.85 min (45% no atiende, 40% corta rápido, 15% conversa).
- 1.000 llamadas ≈ $106–157. 1.000/día ≈ $2.300–3.500/mes. Costo por cita estimado: $5–16.
- Transcripción Whisper: $0.006/min (~$3 por 300 llamadas).
- Benchmarks B2B verificados: conexión SMB 18-25%, dial→cita 2-3% (~1 cita cada 40-100 llamadas),
  ~8 intentos para contactar a alguien. **Ningún número de conversión de vendors de IA sobrevivió
  verificación adversarial — medir con piloto propio.**

**Compliance Argentina (CRÍTICO, verificado con fuentes oficiales):**
- Ley 26.951 **Registro Nacional No Llame** + Resolución AAIP 126/2024: obligatorio consultar el registro
  cada 30 días antes de llamar. Las personas JURÍDICAS también pueden inscribirse (Art. 5) — la lista B2B
  scrapeada PUEDE contener números protegidos. Multas ARS 1.000–100.000, suspensión de base de datos hasta 365 días.
- Pendiente: pedir credenciales AAIP para el sistema de consultas + consulta con abogado sobre exposición B2B.
- El flag `do_not_call` en leads implementa el opt-out; el análisis de transcripción lo setea solo.
- NUNCA llamar a números de EE.UU. con voz IA (TCPA: $500-1.500 por llamada).

**Metodología de cold calling** (curso analizado + video de llamadas reales):
- Estructura: intro permission-based → pitch → downsell + cierre → agendar → **calificar DESPUÉS de agendar**.
- Manejo de objeciones en 4 pasos: pausa → acknowledge → disarm ("te marco acá y no te molesto más") → re-engage.
- Smoke screens (inicio) ≠ objeciones reales (post-pitch).
- Show rate: agendar dentro de 72hs, que el prospecto diga su email, tie-down ("¿cómo me avisás si no llegás?"),
  que acepte la invitación en la llamada. Los atajos de la UI reflejan esto.
- Seguimiento trimestral por 36 meses = la ventaja del 1% (un agente IA lo hace gratis; los presets de
  next_action_at están pensados para esto).
- El mejor gancho comprobado: **contexto observable del lead** ("vi que no tienen web" / "su web no carga").
  El CallPanel resalta "sin sitio web — buen gancho". La personalización con datos del scraper
  (nombre, rubro, zona, rating) es la ventaja competitiva de Scala sobre cold calling genérico.
- Ratio esperado para no frustrarse: 1-2 citas cada 100 llamadas al empezar.

**Guion del agente Retell:** ya hay un prompt completo redactado (identidad "Valen", asistente de Scala,
rioplatense, objetivo único calificar+agendar, transparencia si preguntan si es IA, registro de
interesado/resultado/día_horario en post-call analysis). Franco ya empezó a configurarlo en Retell.
Buscarlo en el historial de conversación si hace falta; si no, reescribirlo con esas specs.

## 8. Cosas técnicas con historia (para no pisar rastrillos)

- `supabase.auth.getSession()` del JS SDK **se colgaba** → AuthContext usa solo `onAuthStateChange`
  + token cacheado en `lib/api.ts` (`setAccessToken`). No reintroducir getSession.
- PostgREST capa respuestas a 1000 filas → `db.py` pagina con `_paginate()`/`.range()`. Cualquier
  query nueva sobre tablas grandes debe usar eso.
- Places API no geocodifica ciudades ("rosario" da 0 resultados) → geocoding por Nominatim (User-Agent
  obligatorio) con fallback Places + ", Argentina".
- El JWT de Supabase es ES256 (JWKS) — el secret HS256 legacy es fallback. PyJWT necesita el extra `[crypto]`.
- MetaMask/extensiones rompen la app (CSP/eval) → probar en incógnito ante pantallas colgadas.
- Los tests de escritorio en Windows: cuidado con emojis/UTF-8 en `python -c` (cp1252).
- SSE con auth: EventSource no manda headers → el token va por query param `?access_token=`.

## 9. Cómo retomar en la máquina nueva

```bash
git clone https://github.com/FranVilla1997/scala-leads-scraper.git
cd scala-leads-scraper
git checkout feat/auth-roles-scraper-optimizations
# Recrear backend/.env y frontend/.env (sección 3 — valores desde Railway/Supabase/Vercel)
cd backend && pip install -r requirements.txt && playwright install chromium
cd ../frontend && npm install
# Correr: start.bat (o python main.py + npm run dev)
```

Luego decirle a Claude: *"Leé CONTEXTO.md y retomemos"*.
