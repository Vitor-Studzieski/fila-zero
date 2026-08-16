# Supabase setup e operação segura

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

## Reconciliação de migrations

Este projeto já possui um banco remoto com dados reais. Portanto, não cole todas as migrations no SQL Editor e não execute `db reset --linked` em produção.

Antes de aplicar qualquer alteração, compare os arquivos locais com o histórico remoto:

```bash
supabase migration list
```

No diagnóstico de 16/08/2026, os arquivos locais incluem as migrations de sessões, fases do Totem e índices de métricas, enquanto o histórico remoto registra somente parte delas. Isso é uma divergência de histórico, não uma prova de que as tabelas ou índices estejam ausentes: o banco remoto já possui `app_sessions`, `print_kiosks`, `print_jobs`, as tabelas de Web Push, `ticket_counters` e os índices de métricas.

Procedimento obrigatório antes de reconciliar:

1. Comparar cada arquivo local com os objetos existentes no banco remoto.
2. Confirmar que a alteração não será reaplicada sobre dados reais.
3. Registrar o resultado da comparação no cartão de migrations.
4. Só então avaliar uma correção de histórico com a CLI, preservando os arquivos SQL locais.

Não edite manualmente `supabase_migrations.schema_migrations` e não aplique novamente migrations que já criaram objetos no banco. A reconciliação permanece pendente até essa comparação ser concluída.

## Como criar as tabelas em um projeto novo

As instruções abaixo valem somente para um projeto novo ou descartável, sem dados de produção:

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

Em um projeto existente, use o procedimento de reconciliação acima. Não use este bloco para “corrigir” o histórico remoto.

## Como criar contas

No Supabase, va em:

```text
Authentication > Users > Add user
```

Crie o usuario com e-mail e senha.

Não use `User Metadata` para autorizar perfis. Esses dados podem ser alterados pelo próprio usuário e não devem decidir permissões. O papel oficial deve permanecer em `public.profiles.role`, alterado pelo backend administrativo com a chave `service_role`, que nunca pode chegar ao navegador.

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

## Validação do `DATABASE_URL`

O `DATABASE_URL` é usado somente por CLI, `psql`, migrations e backups. Nunca o coloque no frontend, no Git ou no chat. Depois de configurar a variável localmente, valide apenas a conexão e o contexto:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "select current_database(), current_user, now();"
```

Não copie o valor da URL para a saída do terminal ou para um commit.

## RLS e Supabase Advisor

As tabelas internas usadas pelo backend permanecem com RLS habilitado, políticas explícitas de negação para `anon`/`authenticated` e acesso operacional somente pelo `service_role`. Isso documenta a intenção e evita que uma concessão futura abra as tabelas por acidente.

Não crie policies genéricas como `to authenticated using (true)`. Isso pode expor filas, sessões, impressão, auditoria e dados de usuários. A migration de hardening cria `senhahub_deny_external_access` nas tabelas internas e deixa a função de rate limit executável somente por `service_role`.

## Preflight e health check

Antes de um deploy de produção, execute localmente com o `.env` de produção carregado:

```bash
npm run preflight:production
```

O preflight reprova a promoção quando faltam `DATABASE_URL`, `AUTH_SECRET`, `CRON_SECRET`, `PRINT_AGENT_TOKEN`, `KIOSK_ID`, `PUBLIC_APP_URL`, Supabase ou quando contas demo/cadastro sem confirmação estão ativos. Ele também valida as chaves VAPID quando `PUSH_NOTIFICATIONS_ENABLED=1`.

Depois do deploy, monitore:

```text
GET https://senhahub.vercel.app/api/health
```

O endpoint não revela nomes ou valores de variáveis; responde `200` somente quando o ambiente está pronto e `503` quando há configuração obrigatória ausente.

## Validações que dependem de ambiente real

Continuam pendentes até serem executadas com segurança:

- SMTP, domínio, SPF, DKIM, DMARC e recuperação de senha em produção;
- tampa aberta, falta de papel, corte de 80 mm, reinício do Windows e queda de internet;
- Web Push em Android e iPhone com o PWA instalado;
- auditoria completa de acessibilidade;
- concorrência diretamente no Supabase.

Não execute testes destrutivos no projeto de produção. Para concorrência e restauração, use um projeto de teste ou dados isolados.

## Ativando Web Push

Gere um unico par VAPID para o projeto:

```bash
npx web-push generate-vapid-keys
```

Cadastre a chave publica em `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, a chave privada em `VAPID_PRIVATE_KEY` e um e-mail de contato em `VAPID_SUBJECT`, por exemplo `mailto:contato@seu-dominio.com`. Use os mesmos valores em Production e Preview somente se os dois ambientes representarem o mesmo aplicativo.

Deixe `PUSH_NOTIFICATIONS_ENABLED=0` durante a configuracao. Depois de aplicar a migracao, cadastrar as tres variaveis e fazer um novo deploy, altere para `1` e redeploy. A permissao de notificacao continua sendo solicitada somente depois de uma acao explicita do cliente.
