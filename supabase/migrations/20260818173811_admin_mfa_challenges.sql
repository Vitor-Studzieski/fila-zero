-- Native Supabase TOTP MFA for manager/admin login.
-- The temporary Supabase access token is encrypted by the application before
-- it is stored and is removed after verification or expiration.

alter table public.app_sessions
  add column if not exists mfa_verified boolean not null default false;

create table if not exists public.auth_mfa_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  factor_id uuid not null,
  challenge_id uuid not null,
  flow text not null check (flow in ('login', 'enrollment')),
  access_token_ciphertext text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0 and attempts <= 5),
  completed_at timestamptz,
  constraint auth_mfa_challenges_expiry_after_creation check (expires_at > created_at)
);

create index if not exists idx_auth_mfa_challenges_user
  on public.auth_mfa_challenges (user_id, created_at desc);

create index if not exists idx_auth_mfa_challenges_expiry
  on public.auth_mfa_challenges (expires_at)
  where completed_at is null;

alter table public.auth_mfa_challenges enable row level security;

revoke all on table public.auth_mfa_challenges from public, anon, authenticated;
grant select, insert, update, delete on table public.auth_mfa_challenges to service_role;
