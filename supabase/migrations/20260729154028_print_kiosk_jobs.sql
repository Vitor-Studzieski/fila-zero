-- Physical ticket kiosk and reliable print queue.

alter table public.tickets alter column customer_id drop not null;
alter table public.services alter column customer_id drop not null;
alter table public.tickets add column if not exists source text not null default 'digital';
alter table public.tickets add column if not exists kiosk_id text;

do $$ begin
  alter table public.tickets
    add constraint tickets_source_check check (source in ('digital', 'physical'));
exception
  when duplicate_object then null;
end $$;

create table if not exists public.print_kiosks (
  id text primary key,
  name text not null,
  active boolean not null default true,
  printer_name text not null,
  printer_port text not null,
  paper_width_mm smallint not null default 80,
  install_url text not null,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint print_kiosks_paper_width_check check (paper_width_mm in (58, 80)),
  constraint print_kiosks_install_url_check check (install_url ~ '^https://')
);

do $$ begin
  alter table public.tickets
    add constraint tickets_kiosk_id_fkey
    foreign key (kiosk_id) references public.print_kiosks(id) on delete set null;
exception
  when duplicate_object then null;
end $$;

create table if not exists public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null unique references public.tickets(id) on delete cascade,
  kiosk_id text not null references public.print_kiosks(id) on delete restrict,
  idempotency_key text not null unique,
  status text not null default 'pending',
  payload jsonb not null,
  attempts integer not null default 0,
  claimed_at timestamptz,
  printed_at timestamptz,
  failed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint print_jobs_status_check check (status in ('pending', 'printing', 'printed', 'failed')),
  constraint print_jobs_attempts_check check (attempts between 0 and 10),
  constraint print_jobs_idempotency_length_check check (char_length(idempotency_key) between 16 and 160),
  constraint print_jobs_payload_object_check check (jsonb_typeof(payload) = 'object')
);

create index if not exists idx_tickets_source_created
  on public.tickets (source, created_at desc);
create index if not exists idx_print_jobs_kiosk_status_created
  on public.print_jobs (kiosk_id, status, created_at);
create index if not exists idx_print_jobs_retry
  on public.print_jobs (kiosk_id, attempts, updated_at)
  where status in ('pending', 'printing', 'failed');

drop trigger if exists print_kiosks_set_updated_at on public.print_kiosks;
create trigger print_kiosks_set_updated_at
before update on public.print_kiosks
for each row execute function public.set_updated_at();

drop trigger if exists print_jobs_set_updated_at on public.print_jobs;
create trigger print_jobs_set_updated_at
before update on public.print_jobs
for each row execute function public.set_updated_at();

insert into public.print_kiosks (
  id,
  name,
  active,
  printer_name,
  printer_port,
  paper_width_mm,
  install_url
)
values (
  'totem-pompeia-01',
  'Totem Supermercado Pompeia',
  true,
  'Bematech MP - 4200 TH',
  'COM3',
  80,
  'https://senhahub.vercel.app/instalar'
)
on conflict (id) do nothing;

create or replace function public.issue_physical_ticket(
  p_kiosk_id text,
  p_sector_id text,
  p_idempotency_key text,
  p_install_url text,
  p_auto_call_delay_seconds integer default 30
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_kiosk public.print_kiosks;
  v_sector public.sectors;
  v_counter public.ticket_counters;
  v_ticket public.tickets;
  v_job public.print_jobs;
  v_number integer;
  v_order integer;
  v_now timestamptz := now();
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if char_length(coalesce(p_idempotency_key, '')) not between 16 and 160 then
    raise exception 'invalid_idempotency_key';
  end if;

  select * into v_job
  from public.print_jobs
  where idempotency_key = p_idempotency_key;

  if found then
    select * into v_ticket from public.tickets where id = v_job.ticket_id;
    return jsonb_build_object(
      'ticket', to_jsonb(v_ticket),
      'printJob', to_jsonb(v_job),
      'alreadyExists', true
    );
  end if;

  select * into v_kiosk
  from public.print_kiosks
  where id = p_kiosk_id
  for update;

  if not found or not v_kiosk.active then
    raise exception 'kiosk_unavailable';
  end if;

  select * into v_sector
  from public.sectors
  where id = p_sector_id
  for update;

  if not found or v_sector.status <> 'open' then
    raise exception 'sector_unavailable';
  end if;

  insert into public.ticket_counters (sector_id, business_date, last_number, updated_at)
  values (p_sector_id, v_today, -1, v_now)
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
      updated_at = v_now
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
    location_verified,
    qr_verified,
    source,
    kiosk_id,
    created_at,
    updated_at
  )
  values (
    null,
    null,
    p_sector_id,
    'Cliente do totem',
    v_number,
    v_sector.prefix || lpad(v_number::text, 3, '0'),
    'aguardando',
    v_order,
    v_now + make_interval(secs => greatest(0, p_auto_call_delay_seconds)),
    false,
    false,
    true,
    'physical',
    p_kiosk_id,
    v_now,
    v_now
  )
  returning * into v_ticket;

  insert into public.print_jobs (
    ticket_id,
    kiosk_id,
    idempotency_key,
    status,
    payload,
    created_at,
    updated_at
  )
  values (
    v_ticket.id,
    p_kiosk_id,
    p_idempotency_key,
    'pending',
    jsonb_build_object(
      'ticketCode', v_ticket.code,
      'ticketNumber', v_ticket.number,
      'sectorId', v_sector.id,
      'sectorName', v_sector.name,
      'issuedAt', v_now,
      'installUrl', coalesce(nullif(trim(p_install_url), ''), v_kiosk.install_url),
      'paperWidthMm', v_kiosk.paper_width_mm,
      'printerName', v_kiosk.printer_name,
      'printerPort', v_kiosk.printer_port
    ),
    v_now,
    v_now
  )
  returning * into v_job;

  return jsonb_build_object(
    'ticket', to_jsonb(v_ticket),
    'printJob', to_jsonb(v_job),
    'alreadyExists', false
  );
end;
$$;

create or replace function public.claim_next_print_job(p_kiosk_id text)
returns public.print_jobs
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job public.print_jobs;
begin
  select * into v_job
  from public.print_jobs
  where kiosk_id = p_kiosk_id
    and attempts < 5
    and (
      status = 'pending'
      or status = 'failed'
      or (status = 'printing' and claimed_at < now() - interval '2 minutes')
    )
  order by created_at asc
  limit 1
  for update skip locked;

  if not found then
    update public.print_kiosks set last_seen_at = now() where id = p_kiosk_id;
    return null;
  end if;

  update public.print_jobs
  set status = 'printing',
      attempts = attempts + 1,
      claimed_at = now(),
      failed_at = null,
      last_error = null,
      updated_at = now()
  where id = v_job.id
  returning * into v_job;

  update public.print_kiosks set last_seen_at = now() where id = p_kiosk_id;
  return v_job;
end;
$$;

create or replace function public.finish_print_job(
  p_job_id uuid,
  p_kiosk_id text,
  p_success boolean,
  p_error text default null
)
returns public.print_jobs
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job public.print_jobs;
begin
  update public.print_jobs
  set status = case when p_success then 'printed' else 'failed' end,
      printed_at = case when p_success then now() else null end,
      failed_at = case when p_success then null else now() end,
      last_error = case when p_success then null else left(coalesce(p_error, 'Falha de impressao.'), 500) end,
      updated_at = now()
  where id = p_job_id
    and kiosk_id = p_kiosk_id
    and status = 'printing'
  returning * into v_job;

  if not found then
    raise exception 'print_job_not_claimed';
  end if;

  update public.print_kiosks set last_seen_at = now() where id = p_kiosk_id;
  return v_job;
end;
$$;

alter table public.print_kiosks enable row level security;
alter table public.print_jobs enable row level security;

revoke all on table public.print_kiosks from PUBLIC, anon, authenticated;
revoke all on table public.print_jobs from PUBLIC, anon, authenticated;
grant select, insert, update, delete on table public.print_kiosks to service_role;
grant select, insert, update, delete on table public.print_jobs to service_role;

revoke execute on function public.issue_physical_ticket(text, text, text, text, integer)
  from PUBLIC, anon, authenticated;
revoke execute on function public.claim_next_print_job(text)
  from PUBLIC, anon, authenticated;
revoke execute on function public.finish_print_job(uuid, text, boolean, text)
  from PUBLIC, anon, authenticated;

grant execute on function public.issue_physical_ticket(text, text, text, text, integer)
  to service_role;
grant execute on function public.claim_next_print_job(text)
  to service_role;
grant execute on function public.finish_print_job(uuid, text, boolean, text)
  to service_role;
