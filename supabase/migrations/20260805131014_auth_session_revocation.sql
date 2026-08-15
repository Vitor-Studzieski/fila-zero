-- Server-side application sessions for immediate revocation.

create table if not exists public.app_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  csrf_token_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint app_sessions_csrf_hash_length check (char_length(csrf_token_hash) = 64),
  constraint app_sessions_expiry_after_creation check (expires_at > created_at)
);

create index if not exists idx_app_sessions_user_active
  on public.app_sessions (user_id, expires_at desc)
  where revoked_at is null;

create index if not exists idx_app_sessions_expiry
  on public.app_sessions (expires_at)
  where revoked_at is null;

alter table public.app_sessions enable row level security;

revoke all on table public.app_sessions from PUBLIC, anon, authenticated;
grant select, insert, update, delete on table public.app_sessions to service_role;
