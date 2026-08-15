-- SenhaHub PWA and Web Push (applied as migration 20260724182303)
-- Additive migration: subscriptions, preferences, idempotent delivery events and API rate limits.

create table if not exists public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  device_name text,
  platform text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  failure_count integer not null default 0,
  revoked_at timestamptz,
  constraint web_push_endpoint_https check (
    char_length(endpoint) between 16 and 2048
    and endpoint ~ '^https://'
  ),
  constraint web_push_p256dh_length check (char_length(p256dh) between 80 and 120),
  constraint web_push_auth_length check (char_length(auth) between 20 and 32),
  constraint web_push_user_agent_length check (user_agent is null or char_length(user_agent) <= 512),
  constraint web_push_device_name_length check (device_name is null or char_length(device_name) <= 120),
  constraint web_push_platform_length check (platform is null or char_length(platform) <= 80),
  constraint web_push_failure_count_nonnegative check (failure_count >= 0)
);

create table if not exists public.push_notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  queue_near_enabled boolean not null default true,
  queue_called_enabled boolean not null default true,
  standby_enabled boolean not null default true,
  queue_changes_enabled boolean not null default true,
  promotions_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.push_notification_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  user_id uuid not null references public.profiles(id) on delete cascade,
  ticket_id uuid references public.tickets(id) on delete set null,
  event_type text not null,
  payload_version integer not null default 1,
  status text not null default 'processing',
  attempts integer not null default 0,
  failure_reason text,
  sent_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_event_key_length check (char_length(event_key) between 8 and 240),
  constraint push_event_type_length check (char_length(event_type) between 3 and 80),
  constraint push_event_status_valid check (status in ('processing', 'sent', 'partial', 'failed', 'skipped')),
  constraint push_event_attempts_nonnegative check (attempts >= 0),
  constraint push_event_payload_version_positive check (payload_version > 0),
  constraint push_event_failure_reason_length check (failure_reason is null or char_length(failure_reason) <= 120)
);

create table if not exists public.push_rate_limits (
  rate_key text primary key,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 1,
  updated_at timestamptz not null default now(),
  constraint push_rate_key_length check (char_length(rate_key) between 8 and 240),
  constraint push_rate_count_positive check (request_count > 0)
);

create index if not exists idx_web_push_subscriptions_user_enabled
  on public.web_push_subscriptions (user_id, enabled);
create index if not exists idx_push_notification_events_user_created
  on public.push_notification_events (user_id, created_at desc);
create index if not exists idx_push_notification_events_ticket_type
  on public.push_notification_events (ticket_id, event_type);
create index if not exists idx_push_rate_limits_updated_at
  on public.push_rate_limits (updated_at);

drop trigger if exists web_push_subscriptions_set_updated_at on public.web_push_subscriptions;
create trigger web_push_subscriptions_set_updated_at
before update on public.web_push_subscriptions
for each row execute function public.set_updated_at();

drop trigger if exists push_notification_preferences_set_updated_at on public.push_notification_preferences;
create trigger push_notification_preferences_set_updated_at
before update on public.push_notification_preferences
for each row execute function public.set_updated_at();

drop trigger if exists push_notification_events_set_updated_at on public.push_notification_events;
create trigger push_notification_events_set_updated_at
before update on public.push_notification_events
for each row execute function public.set_updated_at();

create or replace function public.claim_push_notification_event(
  p_event_key text,
  p_user_id uuid,
  p_ticket_id uuid,
  p_event_type text,
  p_payload_version integer default 1
)
returns public.push_notification_events
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_event public.push_notification_events;
begin
  insert into public.push_notification_events (
    event_key,
    user_id,
    ticket_id,
    event_type,
    payload_version,
    status,
    attempts,
    created_at,
    updated_at
  )
  values (
    p_event_key,
    p_user_id,
    p_ticket_id,
    p_event_type,
    greatest(1, p_payload_version),
    'processing',
    0,
    now(),
    now()
  )
  on conflict (event_key) do nothing
  returning * into v_event;

  return v_event;
end;
$$;

create or replace function public.consume_push_rate_limit(
  p_rate_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
  v_now timestamptz := now();
begin
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'invalid_rate_limit';
  end if;

  insert into public.push_rate_limits (
    rate_key,
    window_started_at,
    request_count,
    updated_at
  )
  values (
    p_rate_key,
    v_now,
    1,
    v_now
  )
  on conflict (rate_key) do update
  set window_started_at = case
        when public.push_rate_limits.window_started_at <= v_now - make_interval(secs => p_window_seconds)
          then v_now
        else public.push_rate_limits.window_started_at
      end,
      request_count = case
        when public.push_rate_limits.window_started_at <= v_now - make_interval(secs => p_window_seconds)
          then 1
        else public.push_rate_limits.request_count + 1
      end,
      updated_at = v_now
  returning request_count into v_count;

  return v_count <= p_limit;
end;
$$;

alter table public.web_push_subscriptions enable row level security;
alter table public.push_notification_preferences enable row level security;
alter table public.push_notification_events enable row level security;
alter table public.push_rate_limits enable row level security;

drop policy if exists "web_push_subscriptions_select_own" on public.web_push_subscriptions;
create policy "web_push_subscriptions_select_own"
on public.web_push_subscriptions for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "web_push_subscriptions_insert_own" on public.web_push_subscriptions;
create policy "web_push_subscriptions_insert_own"
on public.web_push_subscriptions for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "web_push_subscriptions_update_own" on public.web_push_subscriptions;
create policy "web_push_subscriptions_update_own"
on public.web_push_subscriptions for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "push_notification_preferences_select_own" on public.push_notification_preferences;
create policy "push_notification_preferences_select_own"
on public.push_notification_preferences for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "push_notification_preferences_insert_own" on public.push_notification_preferences;
create policy "push_notification_preferences_insert_own"
on public.push_notification_preferences for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "push_notification_preferences_update_own" on public.push_notification_preferences;
create policy "push_notification_preferences_update_own"
on public.push_notification_preferences for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

revoke all on table public.web_push_subscriptions from PUBLIC, anon, authenticated;
revoke all on table public.push_notification_preferences from PUBLIC, anon, authenticated;
revoke all on table public.push_notification_events from PUBLIC, anon, authenticated;
revoke all on table public.push_rate_limits from PUBLIC, anon, authenticated;

grant select on table public.web_push_subscriptions to authenticated;
grant insert (user_id, endpoint, p256dh, auth, user_agent, device_name, platform, enabled)
  on table public.web_push_subscriptions to authenticated;
grant update (enabled, revoked_at, updated_at)
  on table public.web_push_subscriptions to authenticated;

grant select on table public.push_notification_preferences to authenticated;
grant insert (
  user_id,
  queue_near_enabled,
  queue_called_enabled,
  standby_enabled,
  queue_changes_enabled,
  promotions_enabled
) on table public.push_notification_preferences to authenticated;
grant update (
  queue_near_enabled,
  queue_called_enabled,
  standby_enabled,
  queue_changes_enabled,
  promotions_enabled,
  updated_at
) on table public.push_notification_preferences to authenticated;

grant select, insert, update, delete on table public.web_push_subscriptions to service_role;
grant select, insert, update, delete on table public.push_notification_preferences to service_role;
grant select, insert, update, delete on table public.push_notification_events to service_role;
grant select, insert, update, delete on table public.push_rate_limits to service_role;

revoke execute on function public.claim_push_notification_event(text, uuid, uuid, text, integer)
  from PUBLIC, anon, authenticated;
revoke execute on function public.consume_push_rate_limit(text, integer, integer)
  from PUBLIC, anon, authenticated;

grant execute on function public.claim_push_notification_event(text, uuid, uuid, text, integer)
  to service_role;
grant execute on function public.consume_push_rate_limit(text, integer, integer)
  to service_role;
