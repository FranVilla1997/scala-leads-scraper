-- ============================================================================
-- Scala Leads — responsables / tomadores de decisión por lead
-- Ejecutar en Supabase SQL Editor después de 002_calls.sql
-- ============================================================================

-- 1) Columnas nuevas en leads
alter table public.scraping_leads
    add column if not exists socials     jsonb,        -- {linkedin, instagram, facebook, whatsapp}
    add column if not exists enriched_at timestamptz;  -- última búsqueda de responsables

create index if not exists idx_leads_enriched on public.scraping_leads (enriched_at);


-- 2) Contactos de cada lead (un lead → muchas personas)
create table if not exists public.lead_contacts (
    id           uuid primary key default gen_random_uuid(),
    place_id     text not null references public.scraping_leads(place_id) on delete cascade,

    full_name    text,
    role         text,
    email        text,
    phone        text,
    linkedin_url text,
    is_decision_maker boolean not null default false,

    -- De dónde salió el dato (trazabilidad — Ley 25.326):
    -- web_jsonld | web_llm | web_email | manual (y las fuentes que se sumen después)
    source       text not null,
    source_url   text,
    confidence   text not null default 'media' check (confidence in ('alta','media','baja')),

    created_at   timestamptz not null default now()
);

create index if not exists idx_contacts_place on public.lead_contacts (place_id);


-- 3) RLS — el backend usa service_role; sin policies nadie más lee
alter table public.lead_contacts enable row level security;
