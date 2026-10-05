# Scala Leads Scraper

Scrapea negocios de Google Maps por zona, extrae emails de sus sitios web y los gestiona con auth + asignación por zona a vendedores.

## Features

- Búsqueda multi-zona con grilla geográfica (hasta 300 leads por zona)
- Extracción de emails con **httpx async + fallback a Playwright** y deobfuscation (`foo [at] bar.com`)
- Paralelismo configurable (`SCRAPER_CONCURRENCY`), reuso de browser
- Rate limit + retry/backoff contra Google Places
- **Auth con Supabase** (email + contraseña)
- Roles `admin` / `vendedor`
- Cada vendedor ve solo los leads de sus zonas asignadas
- Pipeline de 5 estados: nuevo → contactado → interesado → cerrado ganado/perdido
- Notas por lead
- Export CSV con escaping correcto

---

## Setup

### 1) Supabase

1. Crear proyecto en [supabase.com](https://supabase.com)
2. Abrir **SQL Editor** → pegar y ejecutar [`backend/migrations/001_init.sql`](backend/migrations/001_init.sql)
3. **Crear primer admin**:
   - `Authentication → Add user` (email + password)
   - SQL Editor:
     ```sql
     update public.users_profile set role = 'admin' where email = 'tu@email.com';
     ```
4. **Crear vendedores** del mismo modo (`Add user`) — quedan con rol `vendedor` por default.

### 2) Backend (`backend/.env`)

```env
GOOGLE_PLACES_API_KEY=tu-key
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...    # service role (NO anon)
SUPABASE_JWT_SECRET=...        # Project Settings → API → JWT Secret
FRONTEND_URL=https://tu-frontend.com   # opcional
SCRAPER_CONCURRENCY=8
PLACES_RATE_RPS=8
```

```bash
cd backend
pip install -r requirements.txt
playwright install chromium
python main.py
```

### 3) Frontend (`frontend/.env`)

```env
VITE_API_URL=http://localhost:9001
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...   # anon public key
```

```bash
cd frontend
npm install
npm run dev
```

### 4) Inicio rápido (Windows)

```
start.bat
```

---

## Uso

- Entrar con email + password
- **Admin** ve 3 tabs: Scraper · Base de datos · Vendedores
  - **Scraper**: lanza búsquedas, ve progreso en vivo
  - **Base de datos**: filtros completos (zona, keyword, estado, vendedor asignado, con/sin email), edita estado de cada lead, export CSV
  - **Vendedores**: lista vendedores creados en Supabase y asigna/quita zonas a cada uno
- **Vendedor** ve solo su dashboard:
  - Leads de sus zonas asignadas
  - Stats por estado (clickeables como filtro)
  - Cambia estado inline, agrega notas
  - Export CSV de sus leads

---

## Arquitectura

```
frontend (React + Vite + Tailwind)
   │ Supabase auth (anon key) → JWT
   │
   ▼
backend (FastAPI)
   │ Valida JWT con SUPABASE_JWT_SECRET
   │ Lee perfil/zonas desde users_profile + seller_zones
   │
   ├─► Google Places API (text search + grilla)
   ├─► httpx → Playwright (email scraping)
   └─► Supabase (service key) — leads, profiles, zones
```

Vendedor solo recibe leads cuyo `search_zone` está en su lista de zonas asignadas.
