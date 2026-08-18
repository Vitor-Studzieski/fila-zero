create or replace function public.issue_physical_ticket_bundle(
  p_kiosk_id text,
  p_sector_ids text[],
  p_idempotency_key text,
  p_install_url text,
  p_app_url text default 'https://senhahub.vercel.app',
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
  v_first_sector public.sectors;
  v_counter public.ticket_counters;
  v_ticket public.tickets;
  v_first_ticket public.tickets;
  v_job public.print_jobs;
  v_sector_id text;
  v_sector_ids text[];
  v_number integer;
  v_order integer;
  v_now timestamptz := now();
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_tracking_token text;
  v_first_tracking_token text;
  v_payload_tickets jsonb := '[]'::jsonb;
  v_return_tickets jsonb := '[]'::jsonb;
  v_ticket_ids uuid[] := '{}'::uuid[];
  v_has_first boolean := false;
begin
  if char_length(coalesce(p_idempotency_key, '')) not between 16 and 160 then
    raise exception 'invalid_idempotency_key';
  end if;

  select coalesce(array_agg(value order by value), '{}'::text[])
    into v_sector_ids
  from (
    select distinct trim(value) as value
    from unnest(coalesce(p_sector_ids, '{}'::text[])) as input(value)
    where char_length(trim(value)) > 0
  ) normalized;

  if cardinality(v_sector_ids) < 2 then
    raise exception 'bundle_requires_multiple_sectors';
  end if;
  if cardinality(v_sector_ids) > 12 then
    raise exception 'bundle_has_too_many_sectors';
  end if;

  select * into v_job
  from public.print_jobs
  where idempotency_key = p_idempotency_key;

  if found then
    select * into v_first_ticket from public.tickets where id = v_job.ticket_id;
    return jsonb_build_object(
      'ticket', to_jsonb(v_first_ticket),
      'tickets', coalesce((
        select jsonb_agg(to_jsonb(t) order by t.created_at)
        from public.tickets t
        where t.id::text in (
          select value
          from jsonb_array_elements_text(coalesce(v_job.payload -> 'ticketIds', '[]'::jsonb)) as ids(value)
        )
      ), jsonb_build_array(to_jsonb(v_first_ticket))),
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
  if v_kiosk.mode = 'sector' then
    raise exception 'sector_kiosk_does_not_support_bundles';
  end if;

  foreach v_sector_id in array v_sector_ids loop
    select * into v_sector
    from public.sectors
    where id = v_sector_id
    for update;

    if not found or v_sector.status <> 'open' then
      raise exception 'sector_unavailable';
    end if;

    insert into public.ticket_counters (sector_id, business_date, last_number, updated_at)
    values (v_sector_id, v_today, -1, v_now)
    on conflict (sector_id) do nothing;

    select * into v_counter
    from public.ticket_counters
    where sector_id = v_sector_id
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
    where sector_id = v_sector_id;

    select coalesce(max(queue_order), 0) + 1 into v_order
    from public.tickets
    where sector_id = v_sector_id;

    v_tracking_token := gen_random_uuid()::text;
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
      v_sector_id,
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

    if not v_has_first then
      v_first_ticket := v_ticket;
      v_first_sector := v_sector;
      v_first_tracking_token := v_tracking_token;
      v_has_first := true;
    end if;
    v_ticket_ids := array_append(v_ticket_ids, v_ticket.id);
    v_return_tickets := v_return_tickets || jsonb_build_array(to_jsonb(v_ticket));
    v_payload_tickets := v_payload_tickets || jsonb_build_array(jsonb_build_object(
      'ticketId', v_ticket.id,
      'ticketCode', v_ticket.code,
      'ticketNumber', v_ticket.number,
      'sectorId', v_sector.id,
      'sectorName', v_sector.name,
      'issuedAt', v_now,
      'priority', coalesce(p_priority, false),
      'priorityReason', p_priority_reason,
      'trackUrl', rtrim(coalesce(nullif(trim(p_app_url), ''), v_kiosk.app_url), '/') || '/acompanhar/' || v_tracking_token
    ));
  end loop;

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
    v_first_ticket.id,
    p_kiosk_id,
    p_idempotency_key,
    'pending',
    jsonb_build_object(
      'ticketId', v_first_ticket.id,
      'ticketCode', v_first_ticket.code,
      'ticketNumber', v_first_ticket.number,
      'sectorId', v_first_sector.id,
      'sectorName', v_first_sector.name,
      'issuedAt', v_now,
      'installUrl', coalesce(nullif(trim(p_install_url), ''), v_kiosk.install_url),
      'trackUrl', rtrim(coalesce(nullif(trim(p_app_url), ''), v_kiosk.app_url), '/') || '/acompanhar/' || v_first_tracking_token,
      'priority', coalesce(p_priority, false),
      'priorityReason', p_priority_reason,
      'paperWidthMm', v_kiosk.paper_width_mm,
      'printerName', v_kiosk.printer_name,
      'printerPort', v_kiosk.printer_port,
      'tickets', v_payload_tickets,
      'ticketIds', to_jsonb(v_ticket_ids)
    ),
    v_now,
    v_now
  )
  returning * into v_job;

  return jsonb_build_object(
    'ticket', to_jsonb(v_first_ticket),
    'tickets', v_return_tickets,
    'printJob', to_jsonb(v_job),
    'alreadyExists', false
  );
end;
$$;

revoke execute on function public.issue_physical_ticket_bundle(text, text[], text, text, text, boolean, text, integer)
  from PUBLIC, anon, authenticated;

grant execute on function public.issue_physical_ticket_bundle(text, text[], text, text, text, boolean, text, integer)
  to service_role;
