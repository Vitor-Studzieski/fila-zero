# Operação oficial na Vercel e Supabase

O runtime oficial não exige servidor Linux interno nem PostgreSQL local. A aplicação Next.js roda na Vercel e atende `/api/*` pelo runtime Supabase; os dispositivos acessam apenas o domínio HTTPS da aplicação.

1. Configure as variáveis de `.env.example` no projeto da Vercel, principalmente `DATA_BACKEND=supabase`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` e `AUTH_SECRET`.
2. Aplique as migrações da pasta `supabase/migrations` no projeto Supabase.
3. Execute `npm run preflight:production` e `npm run build` antes de promover a versão.
4. Monitore `/api/health` e `/api/ready` após o deploy.

Os arquivos de systemd desta pasta ficam preservados para a instalação self-hosted com PostgreSQL local quando o servidor da loja for preparado. Eles não são usados pelo deploy atual da Vercel, que permanece no Supabase.
