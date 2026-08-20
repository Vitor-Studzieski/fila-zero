-- Reconcile observability tables that may be absent when the remote migration
-- history predates the local observability migration.

create table if not exists public.cron_executions (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  request_id text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms bigint,
  status text not null default 'running',
  result jsonb,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  constraint cron_executions_status_check check (status in ('running', 'succeeded', 'failed')),
  constraint cron_executions_duration_check check (duration_ms is null or duration_ms >= 0)
);

create index if not exists idx_cron_executions_job_started
  on public.cron_executions (job_name, started_at desc);
create index if not exists idx_cron_executions_status_started
  on public.cron_executions (status, started_at desc);

create table if not exists public.print_job_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.print_jobs(id) on delete cascade,
  kiosk_id text not null references public.print_kiosks(id) on delete restrict,
  attempt_number integer not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  duration_ms bigint,
  status text not null default 'printing',
  error_message text,
  created_at timestamptz not null default now(),
  constraint print_job_attempts_number_check check (attempt_number > 0),
  constraint print_job_attempts_status_check check (status in ('printing', 'printed', 'failed', 'reprocessed')),
  constraint print_job_attempts_duration_check check (duration_ms is null or duration_ms >= 0)
);

create index if not exists idx_print_job_attempts_job_started
  on public.print_job_attempts (job_id, started_at desc);
create index if not exists idx_print_job_attempts_status_finished
  on public.print_job_attempts (status, finished_at desc);

alter table public.cron_executions enable row level security;
alter table public.print_job_attempts enable row level security;

revoke all on table public.cron_executions from public, anon, authenticated;
revoke all on table public.print_job_attempts from public, anon, authenticated;
grant select, insert, update, delete on table public.cron_executions to service_role;
grant select, insert, update, delete on table public.print_job_attempts to service_role;

notify pgrst, 'reload schema';
