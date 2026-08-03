-- ============================================================================
-- Scala Leads — sistema de llamadas (humanas y de agente IA)
-- Ejecutar en Supabase SQL Editor después de 001_init.sql
-- ============================================================================

-- 1) Columnas nuevas en leads
alter table public.scraping_leads
    add column if not exists do_not_call    boolean     not null default false,
    add column if not exists last_called_at timestamptz,
    add column if not exists call_count     integer     not null default 0,
    add column if not exists next_action_at timestamptz;

create index if not exists idx_leads_do_not_call   on public.scraping_leads (do_not_call);
create index if not exists idx_leads_next_action   on public.scraping_leads (next_action_at);


-- 2) Registro de llamadas — mismo esquema para humano y agente IA
create table if not exists public.calls (
    id           uuid primary key default gen_random_uuid(),
    place_id     text not null references public.scraping_leads(place_id) on delete cascade,

    -- Quién llamó
    caller_type  text not null default 'humano' check (caller_type in ('humano','agente_ia')),
    caller_id    uuid references public.users_profile(id) on delete set null,
    caller_email text,

    -- Resultado de la llamada (disposiciones)
    disposition  text not null check (disposition in (
        'no_atendio','buzon','gatekeeper','no_interesado','interesado',
        'cita_agendada','llamar_despues','numero_equivocado','no_llamar'
    )),
    notes        text,

    -- Seguimiento
    next_step      text,
    next_action_at timestamptz,

    -- Datos de la cita (si disposition = cita_agendada)
    appointment_at timestamptz,
    contact_name   text,
    contact_email  text,

    -- Audio y transcripción
    recording_path   text,     -- path dentro del bucket de Storage
    recording_url    text,     -- URL firmada/pública
    transcript       text,
    transcript_source text check (transcript_source in ('browser','upload','retell','manual')),
    transcript_status text not null default 'ninguno'
        check (transcript_status in ('ninguno','pendiente','listo','error')),

    -- Análisis automático post-llamada
    summary     text,
    sentiment   text check (sentiment in ('positivo','neutral','negativo')),
    objections  text[],
    interest_level text check (interest_level in ('alto','medio','bajo','ninguno')),

    -- Métricas
    duration_seconds integer,
    cost_usd         numeric(10,4),

    started_at timestamptz not null default now(),
    created_at timestamptz not null default now()
);

create index if not exists idx_calls_place      on public.calls (place_id);
create index if not exists idx_calls_caller     on public.calls (caller_id);
create index if not exists idx_calls_created    on public.calls (created_at desc);
create index if not exists idx_calls_disposition on public.calls (disposition);
create index if not exists idx_calls_next_action on public.calls (next_action_at);


-- 3) Trigger: cada llamada actualiza el lead (contador, última llamada,
--    próximo paso, do_not_call y estado del pipeline)
create or replace function public.sync_lead_from_call()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.scraping_leads
    set last_called_at = greatest(coalesce(last_called_at, new.started_at), new.started_at),
        call_count     = call_count + 1,
        next_action_at = new.next_action_at,
        do_not_call    = case when new.disposition = 'no_llamar' then true else do_not_call end,
        status = case
            when new.disposition = 'cita_agendada' then 'interesado'
            when new.disposition = 'interesado'    then 'interesado'
            when new.disposition = 'no_interesado' then 'cerrado_perdido'
            when new.disposition = 'no_llamar'     then 'cerrado_perdido'
            when status = 'nuevo'                  then 'contactado'
            else status
        end,
        updated_by = new.caller_id
    where place_id = new.place_id;

    return new;
end;
$$;

drop trigger if exists trg_sync_lead_from_call on public.calls;
create trigger trg_sync_lead_from_call
    after insert on public.calls
    for each row execute function public.sync_lead_from_call();


-- 4) RLS
alter table public.calls enable row level security;

drop policy if exists "caller reads own calls" on public.calls;
create policy "caller reads own calls" on public.calls
    for select using (auth.uid() = caller_id);


-- ============================================================================
-- 5) STORAGE — crear el bucket para las grabaciones
--    Se puede hacer desde el Dashboard (Storage → New bucket → "call-recordings",
--    privado) o con este insert:
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('call-recordings', 'call-recordings', false)
on conflict (id) do nothing;
