-- Security hardening for public endpoints, kiosk sessions and internal tables.
-- This is a forward migration; existing migration history is intentionally not rewritten.

alter table public.print_kiosks
  add column if not exists session_nonce text;

update public.print_kiosks
set session_nonce = gen_random_uuid()::text
where session_nonce is null;

alter table public.print_kiosks
  alter column session_nonce set default gen_random_uuid()::text,
  alter column session_nonce set not null;

create table if not exists public.security_rate_limits (
  rate_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.security_rate_limits enable row level security;

revoke all on table public.security_rate_limits from public, anon, authenticated;
grant all on table public.security_rate_limits to service_role;

create or replace function public.consume_security_rate_limit(
  p_rate_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_count integer;
begin
  if p_rate_key is null
    or char_length(p_rate_key) < 8
    or char_length(p_rate_key) > 240
    or p_limit <= 0
    or p_window_seconds <= 0 then
    return false;
  end if;

  insert into public.security_rate_limits (rate_key, window_started_at, request_count, updated_at)
  values (p_rate_key, v_now, 1, v_now)
  on conflict (rate_key) do update set
    window_started_at = case
      when public.security_rate_limits.window_started_at <= v_now - make_interval(secs => p_window_seconds)
        then excluded.window_started_at
      else public.security_rate_limits.window_started_at
    end,
    request_count = case
      when public.security_rate_limits.window_started_at <= v_now - make_interval(secs => p_window_seconds)
        then 1
      else public.security_rate_limits.request_count + 1
    end,
    updated_at = v_now
  returning request_count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke execute on function public.consume_security_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_security_rate_limit(text, integer, integer) to service_role;

create unique index if not exists idx_ratings_customer_ticket_unique
  on public.ratings (customer_id, ticket_id)
  where ticket_id is not null;

-- Internal tables are intentionally service_role-only. Explicit deny policies
-- document that authenticated and anonymous clients must not query them.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'app_sessions',
    'calls',
    'devices',
    'events',
    'login_attempts',
    'print_jobs',
    'print_kiosks',
    'profile_sector_permissions',
    'push_notification_events',
    'push_rate_limits',
    'ratings',
    'services',
    'ticket_counters',
    'security_rate_limits'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('drop policy if exists senhahub_deny_external_access on public.%I', v_table);
    execute format(
      'create policy senhahub_deny_external_access on public.%I for all to anon, authenticated using (false) with check (false)',
      v_table
    );
  end loop;
end;
$$;
