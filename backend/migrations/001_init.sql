-- ============================================================================
-- Scala Leads Scraper — schema inicial (auth + roles + asignación por zona)
-- Ejecutar en Supabase SQL Editor en este orden.
-- ============================================================================

-- 1) Tabla principal de leads (si no existe, créala; si existe, ALTER abajo)
create table if not exists public.scraping_leads (
    place_id        text primary key,
    name            text,
    address         text,
    phone           text,
    website         text,
    email           text,
    rating          numeric,
    reviews_count   integer,
    category        text,
    search_query    text,
    search_zone     text,
    scraped_at      timestamptz default now()
);

-- Nuevas columnas: status, notes, updated_at
alter table public.scraping_leads
    add column if not exists status      text not null default 'nuevo',
    add column if not exists notes       text,
    add column if not exists updated_at  timestamptz default now(),
    add column if not exists updated_by  uuid;

-- Estados válidos (constraint)
do $$ begin
    alter table public.scraping_leads
        add constraint scraping_leads_status_check
        check (status in ('nuevo','contactado','interesado','cerrado_ganado','cerrado_perdido'));
exception when duplicate_object then null; end $$;

create index if not exists idx_leads_zone   on public.scraping_leads (search_zone);
create index if not exists idx_leads_status on public.scraping_leads (status);


-- 2) Perfil de usuarios (linked a auth.users de Supabase)
create table if not exists public.users_profile (
    id          uuid primary key references auth.users(id) on delete cascade,
    email       text not null,
    full_name   text,
    role        text not null default 'vendedor' check (role in ('admin','vendedor')),
    active      boolean not null default true,
    created_at  timestamptz default now()
);


-- 3) Zonas asignadas a cada vendedor (un vendedor → muchas zonas)
create table if not exists public.seller_zones (
    user_id  uuid not null references public.users_profile(id) on delete cascade,
    zone     text not null,
    primary key (user_id, zone)
);

create index if not exists idx_seller_zones_zone on public.seller_zones (zone);


-- 4) Trigger: crear perfil automáticamente al crear usuario en auth.users
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.users_profile (id, email, full_name, role)
    values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data->>'full_name', new.email),
        coalesce(new.raw_user_meta_data->>'role', 'vendedor')
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();


-- 5) Trigger: bumpea updated_at cuando se modifica un lead
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_touch_leads on public.scraping_leads;
create trigger trg_touch_leads
    before update on public.scraping_leads
    for each row execute function public.touch_updated_at();


-- 6) RLS (Row-Level Security) — el backend usa service_role y BYPASS RLS,
--    pero conviene habilitarlo igual por si el frontend consulta directo.
alter table public.users_profile enable row level security;
alter table public.seller_zones  enable row level security;
alter table public.scraping_leads enable row level security;

-- Cada usuario puede leer su propio perfil
drop policy if exists "user reads own profile" on public.users_profile;
create policy "user reads own profile" on public.users_profile
    for select using (auth.uid() = id);

-- Cada vendedor puede leer sus propias zonas
drop policy if exists "seller reads own zones" on public.seller_zones;
create policy "seller reads own zones" on public.seller_zones
    for select using (auth.uid() = user_id);


-- ============================================================================
-- Crear el primer admin (REEMPLAZÁ el email):
--   1) Crear usuario desde Supabase Dashboard → Authentication → Add user
--   2) Ejecutar:
--        update public.users_profile set role = 'admin' where email = 'tu@email.com';
-- ============================================================================
