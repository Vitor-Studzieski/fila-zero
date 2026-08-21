-- Permite que o mesmo setor tenha varias senhas chamadas ao mesmo tempo.
-- As restricoes por cliente e dispositivo continuam protegendo contra a
-- chamada duplicada da mesma pessoa.
drop index if exists public.uq_tickets_active_call_sector;

alter table public.ticket_counters
  add column if not exists preferential_streak smallint not null default 0;

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
  v_counter public.ticket_counters;
  v_candidate public.tickets;
  v_conflict public.tickets;
  v_called public.tickets;
  v_preferential_available boolean;
  v_common_available boolean;
  v_target_priority boolean;
  v_fallback_priority boolean;
  v_statuses public.ticket_status[] := case
    when p_prefer_standby then array['aguardando', 'proximo', 'standby']::public.ticket_status[]
    else array['aguardando', 'proximo']::public.ticket_status[]
  end;
begin
  -- Serializa chamadas do mesmo setor e mantém o contador 2:1 consistente.
  select * into v_sector
  from public.sectors
  where id = p_sector_id
  for update;

  if not found or v_sector.status <> 'open' then
    raise exception 'sector_unavailable';
  end if;

  insert into public.ticket_counters (sector_id, business_date, last_number, preferential_streak, updated_at)
  values (p_sector_id, (now() at time zone 'America/Sao_Paulo')::date, 0, 0, now())
  on conflict (sector_id) do nothing;

  select * into v_counter
  from public.ticket_counters
  where sector_id = p_sector_id
  for update;

  select exists (
    select 1
    from public.tickets
    where sector_id = p_sector_id
      and status = any(v_statuses)
      and priority = true
      and (not p_require_eligible or coalesce(eligible_at, created_at) <= now())
  ) into v_preferential_available;

  select exists (
    select 1
    from public.tickets
    where sector_id = p_sector_id
      and status = any(v_statuses)
      and priority = false
      and (not p_require_eligible or coalesce(eligible_at, created_at) <= now())
  ) into v_common_available;

  if not v_preferential_available and not v_common_available then
    return null;
  end if;

  -- Com as duas filas disponíveis: preferencial, preferencial, comum.
  -- Se uma fila estiver vazia, atende a fila que ainda possui senha.
  v_target_priority := v_preferential_available
    and (not v_common_available or coalesce(v_counter.preferential_streak, 0) < 2);
  v_fallback_priority := case
    when v_preferential_available and v_common_available then not v_target_priority
    else null
  end;

  for v_candidate in
    select *
    from public.tickets
    where sector_id = p_sector_id
      and status = any(v_statuses)
      and (not p_require_eligible or coalesce(eligible_at, created_at) <= now())
      and (
        priority = v_target_priority
        or (v_fallback_priority is not null and priority = v_fallback_priority)
      )
    order by
      case when p_prefer_standby and status = 'standby' then 0 else 1 end,
      case when priority = v_target_priority then 0 else 1 end,
      queue_order asc,
      created_at asc
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

      update public.ticket_counters
      set preferential_streak = case
            when v_called.priority then least(coalesce(preferential_streak, 0) + 1, 2)
            else 0
          end,
          updated_at = now()
      where sector_id = p_sector_id;

      return v_called;
    exception
      when unique_violation then
        -- Mantém a proteção contra a mesma pessoa ser chamada duas vezes.
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
