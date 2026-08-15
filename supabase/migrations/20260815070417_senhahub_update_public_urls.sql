update public.print_kiosks
set app_url = 'https://senhahub-mauve.vercel.app'
where app_url is distinct from 'https://senhahub-mauve.vercel.app';
