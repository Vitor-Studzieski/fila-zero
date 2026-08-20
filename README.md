# SenhaHub Supermercado Pompeia

Aplicativo de fila virtual para supermercado, com login por perfil, solicitacao de senhas por setor, painel do atendente, painel administrativo e lista de compras/promocoes.

## Requisitos

- Node.js 22.x
- npm

O projeto requer Node 22. O deploy atual na Vercel usa exclusivamente o Supabase para autenticação, dados da fila, carrinho, notificações, impressão e RPCs transacionais. O caminho PostgreSQL local permanece preservado para a futura instalação do servidor da loja.

## Como rodar localmente

1. Instale as dependencias:

```bash
npm install
```

2. Inicie o servidor local:

```bash
npm run dev
```

Para iniciar usando o Supabase, confirme no `.env.local`:

```text
DATA_BACKEND=supabase
SUPABASE_AUTH_ENABLED=1
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<publishable-ou-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<secret-key-apenas-no-servidor>
```

3. Para testar a API, use:

```text
http://localhost:3000/api/ready
```

Em desenvolvimento e produção, as telas chamam o runtime Supabase pelo mesmo domínio da aplicação. Não é necessário configurar `API_SERVER_URL` nem um servidor PostgreSQL separado.

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

Para produção com Supabase, defina pelo menos:

```text
DATA_BACKEND=supabase
SUPABASE_AUTH_ENABLED=1
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<publishable-ou-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<secret-key-apenas-no-servidor>
DATABASE_URL=postgresql://...
AUTH_SECRET
CRON_SECRET
PUBLIC_APP_URL=https://...
KIOSK_ID
KIOSK_PRINTER_PORT
PRINT_AGENT_TOKEN
```

O cadastro público permanece bloqueado em produção até a verificação de e-mail estar configurada. Contas administrativas devem ser criadas em Supabase > Authentication > Users e receber um perfil correspondente em `public.profiles`. `AUTH_SECRET` precisa ser um segredo fixo com ao menos 32 caracteres.

`CRON_SECRET` protege a rota interna `/api/internal/jobs` quando acionada por monitoramento autorizado. Em produção, o processamento é executado pelo runtime da aplicação e pelas funções/RPCs do Supabase; não há dependência de um servidor persistente com banco local.

Antes de promover uma versão para produção, execute `npm run preflight:production`. O comando valida segredos, configuração do Supabase, tabelas, RLS, funções, jobs, totem, agente de impressão e VAPID quando o Web Push estiver habilitado. Ele nunca imprime os valores secretos. Use `/api/health` para liveness e `/api/ready` para confirmar que o runtime está usando o Supabase.

`OBSERVABILITY_ALERT_WEBHOOK_URL` e opcional. Quando configurada somente no servidor, recebe alertas JSON de falhas do Cron e de trabalhos de impressão. Mesmo sem webhook, cada execução fica registrada e pode ser consultada por um perfil administrativo em `/api/observability`, enquanto os logs estruturados incluem `requestId`, duração e resultado.

`KIOSK_MODE=central` permite escolher o setor no Totem. Com `KIOSK_MODE=sector` e `KIOSK_SECTOR_ID=acougue`, o dispositivo inicia direto no atendimento daquele balcão. O QR Code geral leva ao SenhaHub; cada senha impressa recebe um QR Code individual para `/acompanhar/<token>`.

### Politica de senhas

O servidor exige pelo menos 12 caracteres, letras maiusculas, minusculas e numeros, bloqueia escolhas comuns e consulta vazamentos pelo endpoint publico gratuito do Have I Been Pwned usando k-anonymity. A senha completa nunca e enviada: apenas os cinco primeiros caracteres do hash SHA-1. Se o endpoint estiver indisponivel, a criacao ou troca da senha e interrompida para evitar validar uma senha sem essa protecao. Nenhum servico pago e necessario.

Para ativar as notificacoes Web Push, execute `npx web-push generate-vapid-keys`, cadastre o par gerado e um contato valido em `VAPID_SUBJECT`, e so entao defina `PUSH_NOTIFICATIONS_ENABLED=1`. A chave privada nunca deve chegar ao navegador ou ser versionada.

O guia completo de instalacao, notificacoes, cache e testes da PWA esta em [docs/pwa-web-push.md](docs/pwa-web-push.md).

O fluxo de emissao fisica, pareamento do totem e simulacao da impressao esta em [docs/totem-impressao.md](docs/totem-impressao.md).

O monitoramento de Cron, request IDs, logs estruturados e métricas de impressão está em [docs/observabilidade.md](docs/observabilidade.md).

## Dados e operação no Supabase

O runtime oficial usa o Supabase para Auth, perfis, setores, tickets, carrinho, notificações, impressão e funções transacionais. O navegador acessa somente a API HTTPS do próprio domínio; as chaves administrativas ficam exclusivamente no servidor.

Validações e operação:

```bash
npm run preflight:production
npm run build
npm test
```

O backup dos dados deve ser feito pelas ferramentas e políticas do projeto Supabase no deploy atual. O caminho PostgreSQL local permanece suportado para a instalação self-hosted: configure `DATA_BACKEND=local-postgres`, `LOCAL_POSTGRES_ROUTES_ENABLED=1`, `LOCAL_POSTGRES_APP_ENABLED=1`, `SUPABASE_AUTH_ENABLED=0` e `LOCAL_DATABASE_URL`, e execute o servidor instalado com `npm start`. Essa configuração não altera o runtime Supabase da Vercel.

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

O projeto roda como uma aplicação Next.js na Vercel, com `/api/*` atendido diretamente pelo runtime Supabase. Não é necessário `API_SERVER_URL`, proxy reverso, servidor Node separado ou PostgreSQL local. Monitore `/api/health` para liveness e `/api/ready` para confirmar a conexão com o Supabase.

O acompanhamento das tarefas fica em [BACKLOG_SENHAHUB.md](BACKLOG_SENHAHUB.md). Esse é o único documento de status do projeto.

O registro da demonstração técnica e do formulário de feedback fica em [docs/INOVASKILL_VALIDACAO.md](docs/INOVASKILL_VALIDACAO.md).

As acoes autenticadas usam cookie `HttpOnly` e token CSRF. Se o login funcionar, mas acoes como carrinho ou senha falharem com erro de token de seguranca, recarregue a pagina para sincronizar o cookie `senhahub_csrf`.

## Configuração Supabase

Para configurar o projeto Supabase, use o guia:

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

Depois de aplicar as migrações e configurar `DATA_BACKEND=supabase` na Vercel, todo o backend operacional usa o Supabase.
