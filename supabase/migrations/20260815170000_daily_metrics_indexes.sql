-- Indexes used by the daily metrics endpoint.
-- Historical rows remain available; these indexes only make date-scoped reads efficient.

create index if not exists idx_tickets_sector_created_at
  on public.tickets (sector_id, created_at);

create index if not exists idx_tickets_sector_finished_at
  on public.tickets (sector_id, finished_at)
  where finished_at is not null;

create index if not exists idx_tickets_sector_expired_at
  on public.tickets (sector_id, expired_at)
  where status = 'expirado' and expired_at is not null;

create index if not exists idx_tickets_sector_canceled_at
  on public.tickets (sector_id, canceled_at)
  where status = 'cancelado' and canceled_at is not null;

create index if not exists idx_ratings_created_at
  on public.ratings (created_at);
