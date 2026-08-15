-- SenhaHub Supabase schema
-- Consolidated migration: initial schema, offer insight indexes, and shopping agent signals.
-- Run this file in Supabase SQL Editor before switching the app from SQLite to Supabase.

create extension if not exists pgcrypto;

-- New Supabase projects no longer guarantee automatic Data API grants.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from PUBLIC, anon, authenticated, service_role;

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
  customer_name text not null default 'Cliente',
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

alter table public.tickets add column if not exists smart_wait_reason text;
alter table public.tickets add column if not exists customer_name text not null default 'Cliente';
alter table public.tickets add column if not exists blocked_by_ticket_id uuid references public.tickets(id) on delete set null;
alter table public.tickets add column if not exists smart_wait_since timestamptz;
alter table public.tickets add column if not exists called_at timestamptz;
alter table public.tickets add column if not exists eligible_at timestamptz;
alter table public.tickets add column if not exists priority boolean not null default false;
alter table public.tickets add column if not exists priority_reason text;
alter table public.tickets add column if not exists standby_started_at timestamptz;
alter table public.tickets add column if not exists standby_expires_at timestamptz;
alter table public.tickets add column if not exists service_started_at timestamptz;
alter table public.tickets add column if not exists finished_at timestamptz;
alter table public.tickets add column if not exists canceled_at timestamptz;
alter table public.tickets add column if not exists expired_at timestamptz;
alter table public.tickets add column if not exists location_lat double precision;
alter table public.tickets add column if not exists location_lng double precision;
alter table public.tickets add column if not exists location_accuracy double precision;
alter table public.tickets add column if not exists location_distance_meters double precision;
alter table public.tickets add column if not exists location_verified boolean not null default false;
alter table public.tickets add column if not exists qr_verified boolean not null default false;
alter table public.tickets add column if not exists absence_count integer not null default 0;

update public.tickets t
set customer_name = coalesce(nullif(trim(p.name), ''), 'Cliente')
from public.profiles p
where t.customer_id = p.id
  and (t.customer_name is null or t.customer_name = '' or t.customer_name = 'Cliente');

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

create table if not exists public.shopping_signals (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  signal_type text not null,
  query text,
  product_id text,
  product_name text,
  sector_name text,
  created_at timestamptz not null default now()
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
create index if not exists idx_tickets_customer_created on public.tickets (customer_id, created_at desc);
create index if not exists idx_tickets_device on public.tickets (device_id);
create index if not exists idx_tickets_blocked_by on public.tickets (blocked_by_ticket_id);
create index if not exists idx_calls_ticket on public.calls (ticket_id);
create index if not exists idx_calls_sector on public.calls (sector_id);
create index if not exists idx_services_ticket on public.services (ticket_id);
create index if not exists idx_services_sector on public.services (sector_id);
create index if not exists idx_services_customer on public.services (customer_id);
create index if not exists idx_ratings_customer on public.ratings (customer_id);
create index if not exists idx_ratings_ticket on public.ratings (ticket_id);
create index if not exists idx_devices_customer on public.devices (customer_id);
create index if not exists idx_events_customer on public.events (customer_id);
create index if not exists idx_events_sector on public.events (sector_id);
create index if not exists idx_profile_sector_permissions_sector on public.profile_sector_permissions (sector_id);
create index if not exists idx_events_created_at on public.events (created_at desc);
create index if not exists idx_cart_customer on public.cart_items (customer_id);
create index if not exists idx_cart_items_created_at on public.cart_items (created_at desc);
create index if not exists idx_cart_items_product on public.cart_items (product_id);
create index if not exists idx_cart_items_customer_created on public.cart_items (customer_id, created_at desc);
create index if not exists idx_shopping_signals_customer_created on public.shopping_signals (customer_id, created_at desc);
create unique index if not exists uq_tickets_active_customer_sector
  on public.tickets (customer_id, sector_id)
  where status in ('aguardando', 'proximo', 'chamado', 'em_atendimento', 'espera_inteligente', 'standby');
create unique index if not exists uq_tickets_active_call_sector
  on public.tickets (sector_id)
  where status in ('chamado', 'em_atendimento');
create unique index if not exists uq_tickets_active_call_customer
  on public.tickets (customer_id)
  where status in ('chamado', 'em_atendimento');
create unique index if not exists uq_tickets_active_call_device
  on public.tickets (device_id)
  where device_id is not null and status in ('chamado', 'em_atendimento');
create unique index if not exists uq_services_open_ticket
  on public.services (ticket_id)
  where finished_at is null;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
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
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'name', split_part(coalesce(new.email, ''), '@', 1), 'Usuario'),
    'customer'
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
-- Reexecutar a migration nao pode apagar configuracoes operacionais do gestor.
on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.sectors enable row level security;
alter table public.profile_sector_permissions enable row level security;
alter table public.devices enable row level security;
alter table public.tickets enable row level security;
alter table public.calls enable row level security;
alter table public.services enable row level security;
alter table public.ratings enable row level security;
alter table public.events enable row level security;
alter table public.ticket_counters enable row level security;
alter table public.cart_items enable row level security;
alter table public.shopping_signals enable row level security;
alter table public.login_attempts enable row level security;

revoke all privileges on all tables in schema public from anon, authenticated, service_role;
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant select on table public.profiles, public.sectors, public.tickets, public.cart_items, public.shopping_signals to authenticated;
grant insert on table public.shopping_signals to authenticated;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select
to authenticated
using (id = (select auth.uid()));

drop policy if exists "profiles_update_own_name" on public.profiles;
create policy "profiles_update_own_name"
on public.profiles for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

-- RLS filters rows, while column grants prevent a customer from changing role/status.
revoke update on table public.profiles from anon, authenticated;
grant update (name) on table public.profiles to authenticated;

drop policy if exists "sectors_public_read" on public.sectors;
create policy "sectors_public_read"
on public.sectors for select
to authenticated
using (true);

drop policy if exists "cart_items_customer_read" on public.cart_items;
create policy "cart_items_customer_read"
on public.cart_items for select
to authenticated
using (customer_id = (select auth.uid()));

drop policy if exists "shopping_signals_customer_read" on public.shopping_signals;
create policy "shopping_signals_customer_read"
on public.shopping_signals for select
to authenticated
using (customer_id = (select auth.uid()));

drop policy if exists "shopping_signals_customer_insert" on public.shopping_signals;
create policy "shopping_signals_customer_insert"
on public.shopping_signals for insert
to authenticated
with check (customer_id = (select auth.uid()));

drop policy if exists "tickets_customer_read" on public.tickets;
create policy "tickets_customer_read"
on public.tickets for select
to authenticated
using (customer_id = (select auth.uid()));

create or replace function public.issue_ticket(
  p_customer_id uuid,
  p_device_id text,
  p_sector_id text,
  p_priority boolean,
  p_priority_reason text,
  p_auto_call_delay_seconds integer default 30,
  p_max_active_tickets integer default 3
)
returns public.tickets
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_sector public.sectors;
  v_existing public.tickets;
  v_counter public.ticket_counters;
  v_number integer;
  v_order integer;
  v_ticket public.tickets;
  v_customer_name text;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_active_statuses public.ticket_status[] := array['aguardando', 'proximo', 'chamado', 'em_atendimento', 'espera_inteligente', 'standby']::public.ticket_status[];
begin
  select name into v_customer_name
  from public.profiles
  where id = p_customer_id and status = 'active'
  for update;

  if not found then
    raise exception 'customer_not_active';
  end if;

  select * into v_sector
  from public.sectors
  where id = p_sector_id
  for update;

  if not found or v_sector.status <> 'open' then
    raise exception 'sector_unavailable';
  end if;

  select * into v_existing
  from public.tickets
  where customer_id = p_customer_id
    and sector_id = p_sector_id
    and status = any(v_active_statuses)
  order by created_at desc
  limit 1;

  if found then
    return v_existing;
  end if;

  if (
    select count(*)
    from public.tickets
    where customer_id = p_customer_id
      and status = any(v_active_statuses)
  ) >= p_max_active_tickets then
    raise exception 'active_ticket_limit';
  end if;

  insert into public.ticket_counters (sector_id, business_date, last_number, updated_at)
  values (p_sector_id, v_today, -1, now())
  on conflict (sector_id) do nothing;

  select * into v_counter
  from public.ticket_counters
  where sector_id = p_sector_id
  for update;

  if v_counter.business_date <> v_today or v_counter.last_number >= 999 then
    v_number := 0;
  else
    v_number := v_counter.last_number + 1;
  end if;

  update public.ticket_counters
  set business_date = v_today,
      last_number = v_number,
      updated_at = now()
  where sector_id = p_sector_id;

  select coalesce(max(queue_order), 0) + 1 into v_order
  from public.tickets
  where sector_id = p_sector_id;

  insert into public.tickets (
    customer_id,
    device_id,
    sector_id,
    customer_name,
    number,
    code,
    status,
    queue_order,
    eligible_at,
    priority,
    priority_reason,
    location_verified,
    qr_verified,
    created_at,
    updated_at
  )
  values (
    p_customer_id,
    p_device_id,
    p_sector_id,
    coalesce(nullif(trim(v_customer_name), ''), 'Cliente'),
    v_number,
    v_sector.prefix || lpad(v_number::text, 3, '0'),
    'aguardando',
    v_order,
    now() + make_interval(secs => p_auto_call_delay_seconds),
    coalesce(p_priority, false),
    p_priority_reason,
    false,
    false,
    now(),
    now()
  )
  returning * into v_ticket;

  return v_ticket;
end;
$$;

create or replace function public.issue_verified_ticket(
  p_customer_id uuid,
  p_device_id text,
  p_sector_id text,
  p_priority boolean,
  p_priority_reason text,
  p_qr_verified boolean,
  p_location_verified boolean,
  p_location_lat double precision,
  p_location_lng double precision,
  p_location_accuracy double precision,
  p_location_distance_meters double precision,
  p_auto_call_delay_seconds integer,
  p_max_active_tickets integer
)
returns public.tickets
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ticket public.tickets;
begin
  select * into v_ticket
  from public.issue_ticket(
    p_customer_id,
    p_device_id,
    p_sector_id,
    p_priority,
    p_priority_reason,
    p_auto_call_delay_seconds,
    p_max_active_tickets
  );

  update public.tickets
  set qr_verified = coalesce(p_qr_verified, false),
      location_verified = coalesce(p_location_verified, false),
      location_lat = p_location_lat,
      location_lng = p_location_lng,
      location_accuracy = p_location_accuracy,
      location_distance_meters = p_location_distance_meters,
      updated_at = now()
  where id = v_ticket.id
  returning * into v_ticket;

  return v_ticket;
end;
$$;

create or replace function public.call_next_ticket(
  p_sector_id text,
  p_require_eligible boolean default false,
  p_prefer_standby boolean default false
)
returns public.tickets
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_sector public.sectors;
  v_active public.tickets;
  v_candidate public.tickets;
  v_conflict public.tickets;
  v_called public.tickets;
  v_statuses public.ticket_status[] := case
    when p_prefer_standby then array['aguardando', 'proximo', 'standby']::public.ticket_status[]
    else array['aguardando', 'proximo']::public.ticket_status[]
  end;
begin
  select * into v_sector
  from public.sectors
  where id = p_sector_id
  for update;

  if not found or v_sector.status <> 'open' then
    raise exception 'sector_unavailable';
  end if;

  select * into v_active
  from public.tickets
  where sector_id = p_sector_id
    and status in ('chamado', 'em_atendimento')
  limit 1
  for update;

  if found then
    raise exception 'active_ticket_exists';
  end if;

  for v_candidate in
    select *
    from public.tickets
    where sector_id = p_sector_id
      and status = any(v_statuses)
      and (not p_require_eligible or coalesce(eligible_at, created_at) <= now())
    order by
      case when p_prefer_standby and status = 'standby' then 0 else 1 end,
      priority desc,
      queue_order asc
    for update skip locked
  loop
    select * into v_conflict
    from public.tickets
    where id <> v_candidate.id
      and (customer_id = v_candidate.customer_id or device_id = v_candidate.device_id)
      and status in ('chamado', 'em_atendimento')
    order by updated_at desc
    limit 1
    for update;

    if found then
      update public.tickets
      set status = 'espera_inteligente',
          smart_wait_reason = 'Cliente ja possui a senha ' || v_conflict.code || ' em atendimento ou chamada.',
          blocked_by_ticket_id = v_conflict.id,
          smart_wait_since = now(),
          updated_at = now()
      where id = v_candidate.id;
      continue;
    end if;

    begin
      update public.tickets
      set status = 'chamado',
          called_at = now(),
          standby_started_at = null,
          standby_expires_at = null,
          updated_at = now()
      where id = v_candidate.id
      returning * into v_called;

      insert into public.calls (ticket_id, sector_id, action, created_at)
      values (v_called.id, p_sector_id, 'senha_chamada', now());

      return v_called;
    exception
      when unique_violation then
        select * into v_conflict
        from public.tickets
        where id <> v_candidate.id
          and (customer_id = v_candidate.customer_id or device_id = v_candidate.device_id)
          and status in ('chamado', 'em_atendimento')
        order by updated_at desc
        limit 1
        for update;

        if found then
          update public.tickets
          set status = 'espera_inteligente',
              called_at = null,
              smart_wait_reason = 'Cliente ja possui a senha ' || v_conflict.code || ' em atendimento ou chamada.',
              blocked_by_ticket_id = v_conflict.id,
              smart_wait_since = now(),
              updated_at = now()
          where id = v_candidate.id;
          continue;
        end if;

        raise;
    end;
  end loop;

  return null;
end;
$$;

create or replace function public.confirm_ticket(p_ticket_id uuid)
returns public.tickets
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_customer_id uuid;
  v_ticket public.tickets;
  v_blocking public.tickets;
begin
  select customer_id into v_customer_id
  from public.tickets
  where id = p_ticket_id;

  if not found then
    raise exception 'ticket_not_found';
  end if;

  perform 1
  from public.profiles
  where id = v_customer_id
  for update;

  select * into v_ticket
  from public.tickets
  where id = p_ticket_id
  for update;

  if v_ticket.status <> 'chamado' then
    raise exception 'invalid_ticket_status';
  end if;

  select * into v_blocking
  from public.tickets
  where id <> v_ticket.id
    and customer_id = v_ticket.customer_id
    and status = 'em_atendimento'
  limit 1
  for update;

  if found then
    raise exception 'customer_already_in_service';
  end if;

  update public.tickets
  set status = 'em_atendimento',
      service_started_at = now(),
      updated_at = now()
  where id = v_ticket.id
  returning * into v_ticket;

  insert into public.services (ticket_id, sector_id, customer_id, started_at)
  values (v_ticket.id, v_ticket.sector_id, v_ticket.customer_id, v_ticket.service_started_at);

  return v_ticket;
end;
$$;

create or replace function public.finish_ticket(p_ticket_id uuid)
returns public.tickets
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_customer_id uuid;
  v_ticket public.tickets;
begin
  select customer_id into v_customer_id
  from public.tickets
  where id = p_ticket_id;

  if not found then
    raise exception 'ticket_not_found';
  end if;

  perform 1
  from public.profiles
  where id = v_customer_id
  for update;

  select * into v_ticket
  from public.tickets
  where id = p_ticket_id
  for update;

  if v_ticket.status <> 'em_atendimento' then
    raise exception 'invalid_ticket_status';
  end if;

  update public.tickets
  set status = 'atendido',
      finished_at = now(),
      updated_at = now()
  where id = v_ticket.id
  returning * into v_ticket;

  update public.services
  set finished_at = v_ticket.finished_at
  where ticket_id = v_ticket.id
    and finished_at is null;

  update public.sectors
  set current_number = greatest(current_number, v_ticket.number),
      updated_at = now()
  where id = v_ticket.sector_id;

  return v_ticket;
end;
$$;

-- Backend-only functions are not directly callable through anon/authenticated JWTs.
revoke execute on function public.handle_new_auth_user() from PUBLIC, anon, authenticated;
revoke execute on function public.issue_ticket(uuid, text, text, boolean, text, integer, integer) from PUBLIC, anon, authenticated;
revoke execute on function public.issue_verified_ticket(uuid, text, text, boolean, text, boolean, boolean, double precision, double precision, double precision, double precision, integer, integer) from PUBLIC, anon, authenticated;
revoke execute on function public.call_next_ticket(text, boolean, boolean) from PUBLIC, anon, authenticated;
revoke execute on function public.confirm_ticket(uuid) from PUBLIC, anon, authenticated;
revoke execute on function public.finish_ticket(uuid) from PUBLIC, anon, authenticated;

grant execute on function public.issue_ticket(uuid, text, text, boolean, text, integer, integer) to service_role;
grant execute on function public.issue_verified_ticket(uuid, text, text, boolean, text, boolean, boolean, double precision, double precision, double precision, double precision, integer, integer) to service_role;
grant execute on function public.call_next_ticket(text, boolean, boolean) to service_role;
grant execute on function public.confirm_ticket(uuid) to service_role;
grant execute on function public.finish_ticket(uuid) to service_role;
