# Supabase setup

Este projeto continua podendo usar o dominio/deploy da Vercel, mas o banco e as contas podem migrar para o Supabase.

## O que voce precisa pegar no Supabase

No Supabase, abra o projeto e copie:

1. `SUPABASE_URL`
   - Caminho: Project Settings > API Keys
   - Campo: Project URL

2. `SUPABASE_ANON_KEY`
   - Caminho: Project Settings > API Keys
   - Campo: anon/public key

3. `SUPABASE_SERVICE_ROLE_KEY`
   - Caminho: Project Settings > API Keys
   - Campo: service_role key
   - Nunca coloque isso no frontend.

4. `DATABASE_URL`
   - Caminho: Project > Connect > Connection string > URI
   - Use a senha do banco definida no Supabase.

## Onde colocar esses dados

Coloque todos em:

```text
Vercel > Project > Settings > Environment Variables > Production
```

Variaveis:

```env
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=
SUPABASE_AUTH_ENABLED=1
DATA_BACKEND=supabase
SUPABASE_AUTO_CONFIRM_CUSTOMERS=0
AUTH_SECRET=
PUSH_NOTIFICATIONS_ENABLED=0
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:contato@seu-dominio.com
```

`AUTH_SECRET` voce cria. Use um valor fixo, aleatorio e com 32 ou mais caracteres.

Em producao, mantenha `SUPABASE_AUTO_CONFIRM_CUSTOMERS=0`. A emissao digital nao exige QR Code nem geolocalizacao nesta fase; variaveis antigas `PRESENCE_CHECK_ENABLED`, `QR_TOKEN_*` e `STORE_*` podem ser removidas da Vercel.

## Como criar as tabelas

No Supabase:

1. Abra SQL Editor.
2. Crie uma nova query.
3. Cole o conteudo de:

```text
supabase/migrations/0001_initial_schema.sql
```

4. Execute.

5. Em outra query, execute tambem:

```text
supabase/migrations/20260724182303_pwa_push_notifications.sql
```

6. Para habilitar o totem e a fila de impressao, execute na ordem:

```text
supabase/migrations/20260729154028_print_kiosk_jobs.sql
supabase/migrations/20260729175827_index_tickets_kiosk_id.sql
```

Isso cria:

- `profiles`
- `sectors`
- `profile_sector_permissions`
- `devices`
- `tickets`
- `calls`
- `services`
- `ratings`
- `events`
- `ticket_counters`
- `cart_items`
- `login_attempts`
- `web_push_subscriptions`
- `push_notification_preferences`
- `push_notification_events`
- `push_rate_limits`
- `print_kiosks`
- `print_jobs`

Tambem cria os setores iniciais:

- `acougue`
- `frios`
- `padaria`

## Como criar contas

No Supabase, va em:

```text
Authentication > Users > Add user
```

Crie o usuario com e-mail e senha.

Para definir o perfil, use `User Metadata`:

Cliente:

```json
{
  "name": "Cliente Demo",
  "role": "customer"
}
```

Funcionario:

```json
{
  "name": "Funcionario Acougue",
  "role": "attendant"
}
```

Gestor:

```json
{
  "name": "Gestor",
  "role": "manager"
}
```

Depois de criar funcionario, conceda o setor no SQL Editor:

```sql
insert into public.profile_sector_permissions (profile_id, sector_id)
select id, 'acougue'
from public.profiles
where email = '<email-do-funcionario>';
```

Troque `acougue` por `frios` ou `padaria` conforme o caso.

## Ativando o backend Supabase

Com `DATA_BACKEND=supabase`, a rota `app/api/[...path]/route.js` usa o runtime `server/supabase-runtime.js`.

Nesse modo, o app usa Supabase/Postgres para:

- login via Supabase Auth;
- perfis e permissoes;
- setores;
- tickets/senhas;
- chamadas e atendimentos;
- carrinho;
- avaliacoes;
- eventos;
- metricas;
- controle de tentativas de login.

O SQLite permanece apenas como fallback local quando `DATA_BACKEND` nao for `supabase`.

## Ativando Web Push

Gere um unico par VAPID para o projeto:

```bash
npx web-push generate-vapid-keys
```

Cadastre a chave publica em `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, a chave privada em `VAPID_PRIVATE_KEY` e um e-mail de contato em `VAPID_SUBJECT`, por exemplo `mailto:contato@seu-dominio.com`. Use os mesmos valores em Production e Preview somente se os dois ambientes representarem o mesmo aplicativo.

Deixe `PUSH_NOTIFICATIONS_ENABLED=0` durante a configuracao. Depois de aplicar a migracao, cadastrar as tres variaveis e fazer um novo deploy, altere para `1` e redeploy. A permissao de notificacao continua sendo solicitada somente depois de uma acao explicita do cliente.
