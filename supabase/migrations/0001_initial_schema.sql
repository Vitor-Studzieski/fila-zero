-- Fila Zero Supabase schema
-- Run this file in Supabase SQL Editor before switching the app from SQLite to Supabase.

create extension if not exists pgcrypto;

do $$ begin
  create type public.user_role as enum ('customer', 'attendant', 'manager', 'admin');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.user_status as enum ('active', 'inactive');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.sector_status as enum ('open', 'paused', 'closed');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.ticket_status as enum (
    'aguardando',
    'proximo',
    'chamado',
    'em_atendimento',
    'espera_inteligente',
    'standby',
    'cancelado',
    'atendido',
    'expirado'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null unique,
  role public.user_role not null default 'customer',
  status public.user_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sectors (
  id text primary key,
  name text not null,
  prefix text not null,
  counter_label text not null,
  service_label text not null,
  base_number integer not null default 0,
  current_number integer not null default 0,
  queue_size integer not null default 1,
  average_service_seconds integer not null default 60,
  capacity integer not null default 1,
  status public.sector_status not null default 'open',
  updated_at timestamptz not null default now()
);

create table if not exists public.profile_sector_permissions (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  sector_id text not null references public.sectors(id) on delete cascade,
  primary key (profile_id, sector_id)
);

create table if not exists public.devices (
  id text primary key,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  user_agent text,
  last_seen_at timestamptz not null default now()
);

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  device_id text references public.devices(id) on delete set null,
  sector_id text not null references public.sectors(id),
  number integer not null,
  code text not null,
  status public.ticket_status not null,
  queue_order integer not null,
  smart_wait_reason text,
  blocked_by_ticket_id uuid references public.tickets(id) on delete set null,
  smart_wait_since timestamptz,
  called_at timestamptz,
  eligible_at timestamptz,
  priority boolean not null default false,
  priority_reason text,
  service_started_at timestamptz,
  finished_at timestamptz,
  canceled_at timestamptz,
  expired_at timestamptz,
  location_lat double precision,
  location_lng double precision,
  location_accuracy double precision,
  location_distance_meters double precision,
  location_verified boolean not null default false,
  qr_verified boolean not null default false,
  absence_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  sector_id text not null references public.sectors(id),
  action text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  sector_id text not null references public.sectors(id),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.ratings (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  ticket_id uuid references public.tickets(id) on delete set null,
  score text not null,
  comment text,
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  entity_type text not null,
  entity_id text not null,
  customer_id uuid references public.profiles(id) on delete set null,
  sector_id text references public.sectors(id) on delete set null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ticket_counters (
  sector_id text primary key references public.sectors(id) on delete cascade,
  business_date date not null,
  last_number integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.cart_items (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  product_id text not null,
  product_name text not null,
  sector_name text not null,
  price text not null,
  quantity integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, product_id)
);

create table if not exists public.login_attempts (
  attempt_key text primary key,
  count integer not null default 0,
  first_attempt_at bigint not null,
  locked_until bigint not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists idx_tickets_customer_status on public.tickets (customer_id, status);
create index if not exists idx_tickets_sector_queue on public.tickets (sector_id, priority desc, queue_order);
create index if not exists idx_tickets_sector_status on public.tickets (sector_id, status);
create index if not exists idx_events_created_at on public.events (created_at desc);
create index if not exists idx_cart_customer on public.cart_items (customer_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists sectors_set_updated_at on public.sectors;
create trigger sectors_set_updated_at
before update on public.sectors
for each row execute function public.set_updated_at();

drop trigger if exists tickets_set_updated_at on public.tickets;
create trigger tickets_set_updated_at
before update on public.tickets
for each row execute function public.set_updated_at();

drop trigger if exists cart_items_set_updated_at on public.cart_items;
create trigger cart_items_set_updated_at
before update on public.cart_items
for each row execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'name', split_part(coalesce(new.email, ''), '@', 1), 'Usuario'),
    coalesce((new.raw_user_meta_data->>'role')::public.user_role, 'customer')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

insert into public.sectors (id, name, prefix, counter_label, service_label, base_number, current_number, queue_size, average_service_seconds, capacity, status)
values
  ('acougue', 'Acougue', 'A', 'Balcao 1', 'Carnes frescas e cortes especiais', 0, 0, 7, 42, 1, 'open'),
  ('frios', 'Frios e Laticinios', 'F', 'Balcao 2', 'Queijos, embutidos e fatiados', 0, 0, 4, 36, 1, 'open'),
  ('padaria', 'Padaria', 'P', 'Balcao 3', 'Paes, bolos e salgados frescos', 0, 0, 5, 34, 1, 'open')
on conflict (id) do update set
  name = excluded.name,
  prefix = excluded.prefix,
  counter_label = excluded.counter_label,
  service_label = excluded.service_label,
  queue_size = excluded.queue_size,
  average_service_seconds = excluded.average_service_seconds,
  capacity = excluded.capacity,
  status = excluded.status,
  updated_at = now();

alter table public.profiles enable row level security;
alter table public.profile_sector_permissions enable row level security;
alter table public.devices enable row level security;
alter table public.tickets enable row level security;
alter table public.calls enable row level security;
alter table public.services enable row level security;
alter table public.ratings enable row level security;
alter table public.events enable row level security;
alter table public.ticket_counters enable row level security;
alter table public.cart_items enable row level security;
alter table public.login_attempts enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select
to authenticated
using (id = auth.uid());

drop policy if exists "profiles_update_own_name" on public.profiles;
create policy "profiles_update_own_name"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "sectors_public_read" on public.sectors;
create policy "sectors_public_read"
on public.sectors for select
to authenticated
using (true);

drop policy if exists "cart_items_customer_read" on public.cart_items;
create policy "cart_items_customer_read"
on public.cart_items for select
to authenticated
using (customer_id = auth.uid());

drop policy if exists "tickets_customer_read" on public.tickets;
create policy "tickets_customer_read"
on public.tickets for select
to authenticated
using (customer_id = auth.uid());
