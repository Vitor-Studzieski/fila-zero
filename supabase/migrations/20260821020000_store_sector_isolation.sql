begin;

alter table public.profiles
  add column if not exists store_code text;

alter table public.sectors
  add column if not exists store_code text;

alter table public.print_kiosks
  add column if not exists store_code text;

update public.sectors
set store_code = coalesce(nullif(store_code, ''), 'loja-1');

update public.print_kiosks
set store_code = coalesce(nullif(store_code, ''), 'loja-1');

alter table public.sectors
  alter column store_code set default 'loja-1',
  alter column store_code set not null;

alter table public.print_kiosks
  alter column store_code set default 'loja-1',
  alter column store_code set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_store_code_format'
  ) then
    alter table public.profiles
      add constraint profiles_store_code_format
      check (store_code is null or store_code ~ '^loja-[0-9]+$');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.sectors'::regclass
      and conname = 'sectors_store_code_format'
  ) then
    alter table public.sectors
      add constraint sectors_store_code_format
      check (store_code ~ '^loja-[0-9]+$');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.print_kiosks'::regclass
      and conname = 'print_kiosks_store_code_format'
  ) then
    alter table public.print_kiosks
      add constraint print_kiosks_store_code_format
      check (store_code ~ '^loja-[0-9]+$');
  end if;
end;
$$;

create index if not exists idx_profiles_store_code on public.profiles(store_code);
create index if not exists idx_sectors_store_code on public.sectors(store_code);
create index if not exists idx_print_kiosks_store_code on public.print_kiosks(store_code);

insert into public.sectors (
  id,
  name,
  prefix,
  counter_label,
  service_label,
  base_number,
  current_number,
  queue_size,
  average_service_seconds,
  capacity,
  status,
  store_code,
  updated_at
)
select
  source.id || '-loja-1',
  case source.id
    when 'acougue' then 'Açougue - Loja 1'
    when 'frios' then 'Frios e Laticínios - Loja 1'
    when 'padaria' then 'Padaria - Loja 1'
  end,
  source.prefix,
  source.counter_label,
  source.service_label,
  source.base_number,
  source.current_number,
  source.queue_size,
  source.average_service_seconds,
  source.capacity,
  source.status,
  'loja-1',
  source.updated_at
from public.sectors as source
where source.id in ('acougue', 'frios', 'padaria')
on conflict (id) do nothing;

insert into public.sectors (
  id,
  name,
  prefix,
  counter_label,
  service_label,
  base_number,
  current_number,
  queue_size,
  average_service_seconds,
  capacity,
  status,
  store_code,
  updated_at
)
select
  source.id || '-loja-2',
  case source.id
    when 'acougue' then 'Açougue - Loja 2'
    when 'frios' then 'Frios e Laticínios - Loja 2'
    when 'padaria' then 'Padaria - Loja 2'
  end,
  source.prefix,
  source.counter_label,
  source.service_label,
  0,
  0,
  source.queue_size,
  source.average_service_seconds,
  source.capacity,
  source.status,
  'loja-2',
  source.updated_at
from public.sectors as source
where source.id in ('acougue', 'frios', 'padaria')
on conflict (id) do nothing;

update public.calls set sector_id = 'acougue-loja-1' where sector_id = 'acougue';
update public.calls set sector_id = 'frios-loja-1' where sector_id = 'frios';
update public.calls set sector_id = 'padaria-loja-1' where sector_id = 'padaria';

update public.events set sector_id = 'acougue-loja-1' where sector_id = 'acougue';
update public.events set sector_id = 'frios-loja-1' where sector_id = 'frios';
update public.events set sector_id = 'padaria-loja-1' where sector_id = 'padaria';

update public.services set sector_id = 'acougue-loja-1' where sector_id = 'acougue';
update public.services set sector_id = 'frios-loja-1' where sector_id = 'frios';
update public.services set sector_id = 'padaria-loja-1' where sector_id = 'padaria';

update public.ticket_counters set sector_id = 'acougue-loja-1' where sector_id = 'acougue';
update public.ticket_counters set sector_id = 'frios-loja-1' where sector_id = 'frios';
update public.ticket_counters set sector_id = 'padaria-loja-1' where sector_id = 'padaria';

update public.tickets set sector_id = 'acougue-loja-1' where sector_id = 'acougue';
update public.tickets set sector_id = 'frios-loja-1' where sector_id = 'frios';
update public.tickets set sector_id = 'padaria-loja-1' where sector_id = 'padaria';

update public.profile_sector_permissions set sector_id = 'acougue-loja-1' where sector_id = 'acougue';
update public.profile_sector_permissions set sector_id = 'frios-loja-1' where sector_id = 'frios';
update public.profile_sector_permissions set sector_id = 'padaria-loja-1' where sector_id = 'padaria';

update public.profile_sector_permissions as permissions
set sector_id = replace(permissions.sector_id, '-loja-1', '-loja-2')
from public.profiles as profile
where permissions.profile_id = profile.id
  and profile.email in (
    'setor.acougue2@superpompeia.com',
    'setor.frios2@superpompeia.com',
    'setor.padaria2@superpompeia.com'
  );

update public.profiles
set store_code = 'loja-1'
where email in (
  'setor.acougue1@superpompeia.com',
  'setor.frios1@superpompeia.com',
  'setor.padaria1@superpompeia.com',
  'tv.acougue@superpompeia.com'
);

update public.profiles
set store_code = 'loja-2'
where email in (
  'setor.acougue2@superpompeia.com',
  'setor.frios2@superpompeia.com',
  'setor.padaria2@superpompeia.com'
);

insert into public.profile_sector_permissions (profile_id, sector_id)
select profile.id, 'acougue-loja-1'
from public.profiles as profile
where profile.email = 'tv.acougue@superpompeia.com'
on conflict do nothing;

delete from public.sectors
where id in ('acougue', 'frios', 'padaria');

update public.print_kiosks
set store_code = 'loja-1'
where id = 'totem-pompeia-01';

create or replace function public.enforce_physical_ticket_store()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_kiosk_store text;
  v_sector_store text;
begin
  if new.source = 'physical' and new.kiosk_id is not null then
    select store_code into v_kiosk_store
    from public.print_kiosks
    where id = new.kiosk_id;

    select store_code into v_sector_store
    from public.sectors
    where id = new.sector_id;

    if v_kiosk_store is null or v_sector_store is null or v_kiosk_store <> v_sector_store then
      raise exception 'physical_ticket_store_mismatch';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists tickets_physical_store_boundary on public.tickets;

create trigger tickets_physical_store_boundary
before insert or update of sector_id, kiosk_id, source on public.tickets
for each row execute function public.enforce_physical_ticket_store();

commit;
