-- O totem físico da operação atual atende exclusivamente a Loja 2.
update public.print_kiosks
set store_code = 'loja-2',
    updated_at = now()
where id = 'totem-pompeia-01';
