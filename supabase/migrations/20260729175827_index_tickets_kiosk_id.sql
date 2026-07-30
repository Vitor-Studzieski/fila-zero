-- Keep kiosk ticket lookups efficient and cover tickets.kiosk_id foreign key operations.
create index if not exists idx_tickets_kiosk_id
on public.tickets (kiosk_id);
