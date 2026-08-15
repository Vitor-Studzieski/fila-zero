alter table public.print_kiosks
  add column if not exists mode text not null default 'central',
  add column if not exists sector_id text,
  add column if not exists app_url text not null default 'https://senhahub-mauve.vercel.app';

alter table public.tickets
  add column if not exists tracking_token text;

create unique index if not exists idx_tickets_tracking_token
  on public.tickets (tracking_token)
  where tracking_token is not null;

drop function if exists public.issue_physical_ticket(text, text, text, text, integer);

create or replace function public.issue_physical_ticket(
  p_kiosk_id text,
  p_sector_id text,
  p_idempotency_key text,
  p_install_url text,
  p_app_url text default 'https://senhahub-mauve.vercel.app',
  p_priority boolean default false,
  p_priority_reason text default null,
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
  v_tracking_token text := gen_random_uuid()::text;
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

  if v_kiosk.mode = 'sector' and v_kiosk.sector_id <> p_sector_id then
    raise exception 'sector_not_configured_for_kiosk';
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
    priority_reason,
    tracking_token,
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
    coalesce(p_priority, false),
    p_priority_reason,
    v_tracking_token,
    false,
    false,
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
      'trackUrl', rtrim(coalesce(nullif(trim(p_app_url), ''), v_kiosk.app_url), '/') || '/acompanhar/' || v_tracking_token,
      'priority', coalesce(p_priority, false),
      'priorityReason', p_priority_reason,
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

revoke execute on function public.issue_physical_ticket(text, text, text, text, text, boolean, text, integer)
  from PUBLIC, anon, authenticated;

grant execute on function public.issue_physical_ticket(text, text, text, text, text, boolean, text, integer)
  to service_role;
