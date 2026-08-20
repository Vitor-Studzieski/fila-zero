# SenhaHub Supermercado Pompeia

Aplicativo de fila virtual para supermercado, com login por perfil, solicitacao de senhas por setor, painel do atendente, painel administrativo e lista de compras/promocoes.

## Requisitos

- Node.js 22.x
- npm

O projeto requer Node 22. O SQLite continua disponivel para testes e compatibilidade, mas a operacao migrada usa PostgreSQL local por meio de `DATA_BACKEND=local-postgres`.

## Como rodar localmente

1. Instale as dependencias:

```bash
npm install
```

2. Inicie o servidor local:

```bash
npm run dev
```

Para iniciar usando o PostgreSQL local migrado, confirme no `.env.local`:

```text
DATA_BACKEND=local-postgres
LOCAL_POSTGRES_ROUTES_ENABLED=1
LOCAL_POSTGRES_APP_ENABLED=1
SUPABASE_AUTH_ENABLED=0
```

Antes de iniciar, valide a estrutura e as permissoes:

```bash
npm run preflight:local-postgres
```

3. Abra no navegador:

```text
http://localhost:3000
```

O backend, as paginas Next.js e os arquivos de `public/` rodam pelo mesmo servidor.

## Rotas principais

- `http://localhost:3000/login` - login
- `http://localhost:3000/` - app do cliente
- `http://localhost:3000/attendant` - painel do funcionario
- `http://localhost:3000/admin` - painel do gestor
- `http://localhost:3000/admin/operacao` - operação em tempo real
- `http://localhost:3000/admin/setores` - configuração dos setores
- `http://localhost:3000/admin/totens` - totens e impressão
- `http://localhost:3000/admin/usuarios` - usuários e permissões
- `http://localhost:3000/iccf` - clusters e inteligencia comercial
- `http://localhost:3000/totem` - emissão física de senhas por etapas
- `http://localhost:3000/acompanhar/<token>` - acompanhamento individual da senha

## Contas de teste

O repositorio nao versiona logins ou senhas de demonstracao. Para criar contas locais ou de demo, configure `DEMO_USERS_JSON` em um arquivo `.env` local ou nas Environment Variables da Vercel.

Exemplo de estrutura, usando valores ficticios:

```json
[
  {
    "name": "Cliente Demo",
    "email": "<email-do-cliente-demo>",
    "password": "<senha-forte-fora-do-git>",
    "role": "customer",
    "sectorIds": []
  },
  {
    "name": "Gestor Demo",
    "email": "<email-do-gestor-demo>",
    "password": "<outra-senha-forte-fora-do-git>",
    "role": "manager",
    "sectorIds": []
  }
]
```

Esses valores sao apenas modelo. Use senhas diferentes e mantenha os valores reais fora do Git.

## Variaveis de ambiente

Copie `.env.example` como referencia e configure os valores sensiveis fora do Git.

Para producao com PostgreSQL local, defina pelo menos:

```text
DATA_BACKEND=local-postgres
LOCAL_DATABASE_URL=postgresql://...
LOCAL_POSTGRES_ROUTES_ENABLED=1
LOCAL_POSTGRES_APP_ENABLED=1
SUPABASE_AUTH_ENABLED=0
LOCAL_PUBLIC_REGISTRATION_ENABLED=0
AUTH_SECRET
CRON_SECRET
PUBLIC_APP_URL=https://...
KIOSK_ID
KIOSK_PRINTER_PORT
PRINT_AGENT_TOKEN
```

Para producao em Supabase, defina pelo menos:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_AUTH_ENABLED
DATA_BACKEND
SUPABASE_AUTO_CONFIRM_CUSTOMERS
AUTH_SECRET
CRON_SECRET
DATABASE_URL
PUBLIC_APP_URL
KIOSK_ID
KIOSK_PRINTER_PORT
PRINT_AGENT_TOKEN
OBSERVABILITY_ALERT_WEBHOOK_URL (opcional)
BOOTSTRAP_ADMIN_EMAIL
BOOTSTRAP_ADMIN_PASSWORD
DEMO_USERS_JSON
PUSH_NOTIFICATIONS_ENABLED
NEXT_PUBLIC_VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
VAPID_SUBJECT
KIOSK_MODE
KIOSK_SECTOR_ID
```

Use `DATA_BACKEND=local-postgres` no servidor interno para rodar login, filas, carrinho, setores, metricas e usuarios no PostgreSQL local. O cadastro publico permanece bloqueado em producao; para provisionar um gestor sem expor senha no codigo, use `npm run local:admin` com as variaveis `LOCAL_ADMIN_EMAIL`, `LOCAL_ADMIN_PASSWORD`, `LOCAL_ADMIN_NAME`, `LOCAL_ADMIN_ROLE` e `LOCAL_ADMIN_CONFIRM=1`. Use `DATA_BACKEND=supabase` somente quando a operacao estiver apontando para o projeto remoto. `AUTH_SECRET` precisa ser um segredo fixo com ao menos 32 caracteres. `SUPABASE_AUTO_CONFIRM_CUSTOMERS=1` libera cadastro publico sem confirmacao de e-mail para testes; em producao real, volte para `0`.

`CRON_SECRET` protege a rota interna `/api/internal/jobs`, usada pela Vercel Cron para executar expiracao de senhas, chamadas automaticas e notificacoes mesmo sem trafego de usuarios. Gere um segredo exclusivo e cadastre o mesmo valor no ambiente local e na Vercel.

Antes de promover uma versão para produção local, execute `npm run preflight:local-postgres`; para a variante Supabase, use `npm run preflight:production`. Os comandos validam segredos, conexão, tabelas, RLS, funções, permissões, cron, totem, agente de impressão e VAPID quando o Web Push estiver habilitado. Eles nunca imprimem os valores secretos. Use `/api/health` para liveness e `/api/ready` para confirmar que a API conseguiu consultar o PostgreSQL.

`OBSERVABILITY_ALERT_WEBHOOK_URL` e opcional. Quando configurada somente no servidor, recebe alertas JSON de falhas do Cron e de trabalhos de impressão. Mesmo sem webhook, cada execução fica registrada e pode ser consultada por um perfil administrativo em `/api/observability`, enquanto os logs estruturados incluem `requestId`, duração e resultado.

`KIOSK_MODE=central` permite escolher o setor no Totem. Com `KIOSK_MODE=sector` e `KIOSK_SECTOR_ID=acougue`, o dispositivo inicia direto no atendimento daquele balcão. O QR Code geral leva ao SenhaHub; cada senha impressa recebe um QR Code individual para `/acompanhar/<token>`.

### Politica de senhas

O servidor exige pelo menos 12 caracteres, letras maiusculas, minusculas e numeros, bloqueia escolhas comuns e consulta vazamentos pelo endpoint publico gratuito do Have I Been Pwned usando k-anonymity. A senha completa nunca e enviada: apenas os cinco primeiros caracteres do hash SHA-1. Se o endpoint estiver indisponivel, a criacao ou troca da senha e interrompida para evitar validar uma senha sem essa protecao. Nenhum servico pago e necessario.

Para ativar as notificacoes Web Push, execute `npx web-push generate-vapid-keys`, cadastre o par gerado e um contato valido em `VAPID_SUBJECT`, e so entao defina `PUSH_NOTIFICATIONS_ENABLED=1`. A chave privada nunca deve chegar ao navegador ou ser versionada.

O guia completo de instalacao, notificacoes, cache e testes da PWA esta em [docs/pwa-web-push.md](docs/pwa-web-push.md).

O fluxo de emissao fisica, pareamento do totem e simulacao da impressao esta em [docs/totem-impressao.md](docs/totem-impressao.md).

O monitoramento de Cron, request IDs, logs estruturados e métricas de impressão está em [docs/observabilidade.md](docs/observabilidade.md).

## Banco de dados local

### PostgreSQL migrado

O banco operacional migrado deve ser configurado em `LOCAL_DATABASE_URL`. O serviço da aplicação usa o papel `senhahub_service`; o papel `senhahub_app` fica disponível para conexoes administrativas controladas. O PostgreSQL nao deve ser exposto diretamente aos dispositivos: eles acessam somente a API HTTPS local.

Validações e operação:

```bash
npm run preflight:local-postgres
npm run backup:postgres
```

O backup PostgreSQL exige `BACKUP_ENCRYPTION_KEY` e `BACKUP_OFFSITE_DIR` fora do projeto. Para exportar roles, configure também `BACKUP_ROLES_DATABASE_URL` com um usuário administrativo separado; esse usuário não é usado pela API. Para verificar um backup sem alterar banco algum:

```bash
BACKUP_DIR=/caminho/para/backup npm run restore:postgres -- --verify-only
```

Uma restauração real deve apontar para um banco de teste separado e exigir `RESTORE_TARGET_CONFIRMED=1`.

### SQLite de compatibilidade

O SQLite local fica em:

```text
data/senhahub.sqlite
```

Esse arquivo nao e versionado pelo Git. Se quiser reiniciar os dados locais, pare o servidor e apague os arquivos SQLite dentro de `data/`.

Tambem e possivel escolher outra pasta de dados:

```bash
DATA_DIR=/caminho/para/dados npm run dev
```

No PowerShell:

```powershell
$env:DATA_DIR="C:\caminho\para\dados"; npm run dev
```

## Scripts

```bash
npm run dev
```

Roda o servidor local em modo desenvolvimento.

```bash
npm run build
```

Gera o build de producao com Next.js.

```bash
npm run check
```

Verifica a sintaxe dos arquivos principais.

```bash
npm test
```

Executa os testes de orquestracao da fila, PWA e Web Push.

## Observacoes para deploy

O projeto possui adaptacao para Vercel em `app/api/[...path]/route.js`. A Vercel continua adequada para a variante Supabase. Para o PostgreSQL local, execute o servidor Node na maquina/servidor interno, atrás de HTTPS reverso, com `/api/health` e `/api/ready` monitorados.

O acompanhamento das tarefas fica em [BACKLOG_SENHAHUB.md](BACKLOG_SENHAHUB.md). Esse é o único documento de status do projeto.

O registro da demonstração técnica e do formulário de feedback fica em [docs/INOVASKILL_VALIDACAO.md](docs/INOVASKILL_VALIDACAO.md).

As acoes autenticadas usam cookie `HttpOnly` e token CSRF. Se o login funcionar, mas acoes como carrinho ou senha falharem com erro de token de seguranca, recarregue a pagina para sincronizar o cookie `senhahub_csrf`.

## Preparacao Supabase

Para manter o dominio/deploy na Vercel e migrar banco/contas para Supabase, use o guia:

```text
docs/supabase-setup.md
```

A estrutura SQL inicial esta em:

```text
supabase/migrations/0001_initial_schema.sql
```

Depois da estrutura inicial, execute tambem:

```text
supabase/migrations/20260724182303_pwa_push_notifications.sql
```

Depois de criar as tabelas no Supabase e configurar `DATA_BACKEND=supabase` na Vercel, o backend passa a usar Supabase/Postgres para os dados operacionais.
