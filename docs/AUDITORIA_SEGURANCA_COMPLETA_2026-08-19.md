# Auditoria completa de segurança — SenhaHub

**Data:** 2026-08-19; atualização de fechamento em 2026-08-20  
**Escopo:** repositório inteiro, aplicação web/PWA, API Node/Next.js, PostgreSQL local, migrations, scripts, agente de impressão, configuração de deploy, Git e dependências disponíveis no ambiente autorizado.  
**Tipo:** auditoria defensiva; não foram executados ataques contra serviços externos, DDoS, ações destrutivas, ransomware ou extração de dados reais.

## 1. Conclusão executiva

O projeto possui uma base de segurança consistente para staging e preparação de produção. A autenticação PostgreSQL, as sessões, o CSRF, o controle por função, o RLS das tabelas públicas, as transações de tickets e os testes automatizados estão funcionando.

Na atualização de fechamento, as rotas antigas foram migradas para o PostgreSQL local e o papel de runtime deixou de usar `BYPASSRLS`. O preflight confirmou `senhahub_service` sem superusuário e sem bypass, com grants e policies explícitos. A liberação definitiva ainda depende das configurações do servidor, backup/restore, impressão física e validação operacional da rede — não de uma pendência de código dessas rotas.

### Contagem dos achados

| Severidade | Total identificado | Corrigido/mitigado | Aberto |
| --- | ---: | ---: | ---: |
| Critical | 0 | 0 | 0 |
| High | 1 | 1 mitigado | 0 |
| Medium | 3 | 3 | 0 |
| Low | 0 | 0 | 0 |
| Info | 4 | 0 | 4 |

Os itens Info são hardening, governança ou lacunas operacionais; não foram tratados como exploração confirmada.

## 2. Mapa da arquitetura identificado

    Navegador / PWA / Service Worker
            │
            ├── páginas Next.js e scripts públicos
            ├── API Next.js /api/[...path]
            └── servidor Node direto server/server.js
                    │
                    ├── PostgreSQL local: auth.users, auth.sessions,
                    │   24 tabelas public, RLS e funções SQL
                    ├── SQLite legado: transição/testes
                    ├── agente Windows de impressão → porta COM5
                    ├── Web Push/VAPID
                    └── compatibilidade Supabase/Vercel

### Estrutura e tecnologias

- `app/`: páginas, componentes e rotas App Router.
- `public/`: PWA, Service Worker, telas públicas e scripts de frontend.
- `server/`: HTTP standalone, autenticação, PostgreSQL, repositório, totem, push, impressão, observabilidade e compatibilidade Supabase.
- `supabase/migrations/`: schema cloud e migrations de segurança/integrações.
- `scripts/`: preflight, backup/restore, testes locais e agente de impressão.
- `deploy/`: modelos systemd, nginx e instruções para servidor persistente.
- `windows/print-agent/`: instalação do agente de impressão no Windows.
- `tests/`: testes de orquestração, PWA, impressão, observabilidade, senha e prontidão de produção.
- Não foram encontrados Dockerfiles, Docker Compose ou workflows GitHub Actions.
- Não foram encontrados endpoints GraphQL, uploads de arquivos ou WebSockets de negócio.

## 3. Inventário de superfícies e endpoints

### Rotas PostgreSQL locais implementadas

| Grupo | Rotas cobertas | Controles principais |
| --- | --- | --- |
| Auth | login, register, me, logout, troca e recuperação de senha | sessão no banco, cookie HttpOnly, expiração, CSRF, token de recuperação com hash e rate limit |
| Sessões | `POST /api/sessions` | sessão autenticada, CSRF, vínculo de dispositivo |
| Estado | queue, state, staff/state | autenticação conforme o dado, `no-store` privado |
| Tickets | criar, cancelar, confirmar, finalizar, pular, rastrear | CSRF, ownership/setor, transações e locks |
| Atendimento | staff/call-next | função de staff, setor permitido, CSRF |
| Carrinho | leitura, inserção, edição e remoção | cliente autenticado, CSRF e ownership |
| Totem | status, pair, unpair, tickets, print-job | sessão, nonce, role, CSRF e idempotência |
| Impressão | claim e finish | agente/runtime, função interna e estado |
| Push | status, subscribe, unsubscribe, preferences, test | sessão, CSRF, origem, allowlist e rate limit |
| Sinais | shopping-agent, shopping-signals | autenticação, allowlist de campos e CSRF |

### Rotas legadas migradas para PostgreSQL local

Com `DATA_BACKEND=local-postgres`, `LOCAL_POSTGRES_ROUTES_ENABLED=1` e `LOCAL_POSTGRES_ALLOW_LEGACY_FALLBACK=0`, as rotas antigas abaixo agora usam o mesmo backend PostgreSQL local, com autenticação, autorização, CSRF e queries parametrizadas:

- `POST /api/auth/change-password`, `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`;
- `GET /api/history`, `GET /api/events`, `GET /api/metrics`, `GET /api/offer-insights`;
- `GET/POST /api/users`, `PUT /api/sectors/:id`, `POST /api/ratings`;
- `PATCH/DELETE /api/cart/items/:id`.

Foi criada a tabela privada `auth.password_resets` com token armazenado somente em hash, expiração de 30 minutos, uso único e revogação das sessões após redefinição. A entrega do link por e-mail continua sendo uma configuração externa do ambiente, sem enumeração de usuários. O rastreamento `GET /api/tickets/track/:token` também permanece coberto pela camada local.

## 4. Achados detalhados

### SEC-001 — Fallback silencioso entre PostgreSQL local e SQLite

**ID:** SEC-001  
**Título:** modo PostgreSQL local permitia cair no backend SQLite legado  
**Severidade:** High — mitigado  
**Categoria:** Insecure Design / Security Misconfiguration / Data Integrity  
**CWE:** CWE-669 — Incorrect Resource Transfer Between Spheres  
**OWASP:** A04 Insecure Design; A05 Security Misconfiguration; API1 Broken Object Level Authorization por divergência de fonte de dados  
**Arquivo:** `server/server.js`  
**Linha(s):** 825–831 na versão corrigida; aliases locais em 51–106 e 1341–1372  
**Componente:** roteador standalone e migração PostgreSQL local.

**Descrição:** quando o backend local era habilitado, apenas um subconjunto das rotas era redirecionado para PostgreSQL. As demais continuavam no fluxo SQLite. Isso podia fazer uma tela ler uma base e uma mutação escrever em outra.

**Cenário de exploração:** um usuário chama diretamente uma rota ainda não migrada, por exemplo `/api/metrics` ou `/api/users`, enquanto o restante da sessão está no PostgreSQL. A requisição não falhava claramente; era atendida pelo backend legado.

**Impacto:** inconsistência de dados, possível leitura de informação de uma base diferente da esperada e divergência entre staging e produção.

**Probabilidade:** Alta durante a transição se o fallback estivesse ativo; a exposição externa depende da configuração do servidor.

**Evidência encontrada:** o mapa de aliases cobria somente rotas locais implementadas, enquanto o fluxo abaixo dele continuava processando SQLite.

**Correção recomendada:** negar por padrão qualquer rota não migrada; permitir fallback somente em desenvolvimento controlado; bloquear o fallback no preflight de produção.

**Código atual:**

    if (isLocalPostgresEnabled() && process.env.LOCAL_POSTGRES_ALLOW_LEGACY_FALLBACK !== "1") {
      sendJson(res, 503, { code: "LOCAL_POSTGRES_ROUTE_REQUIRED" });
      return;
    }

**Código corrigido:** o guard foi adicionado em `server/server.js:825–831`; `LOCAL_POSTGRES_ALLOW_LEGACY_FALLBACK=0` foi documentado em `.env.example`; o preflight reprova valor `1` em `server/production-readiness.js:67–69`.

**Risco de regressão:** uma rota nova que não seja adicionada ao mapa local retorna 503 em vez de responder pelo SQLite. Isso é intencional; o teste `test:local-legacy-routes` e o preflight devem continuar obrigatórios.

**Status:** mitigado por fail-closed; as rotas legadas inventariadas nesta auditoria foram migradas.

### SEC-002 — Rate limit de login local podia confiar em IP falsificado

**ID:** SEC-002  
**Título:** cabeçalhos de proxy não confiáveis usados na chave de limitação  
**Severidade:** Medium — corrigido  
**Categoria:** Authentication Failures / API Abuse  
**CWE:** CWE-307 — Improper Restriction of Excessive Authentication Attempts  
**OWASP:** A07 Identification and Authentication Failures; API4 Unrestricted Resource Consumption  
**Arquivo:** `app/api/local-postgres/auth/login/route.js`, `server/local-http-auth.js`  
**Linha(s):** login 21–30; helper 8–14  
**Componente:** login local PostgreSQL.

**Descrição:** a implementação inicial usava `x-forwarded-for`/`x-real-ip` sem comprovar que a requisição vinha de um proxy confiável. Um cliente podia trocar o cabeçalho a cada tentativa e evitar o limite por IP.

**Cenário de exploração:** enviar repetidas tentativas de senha alterando `X-Forwarded-For` em cada requisição.

**Impacto:** redução da eficácia contra brute force e password spraying.

**Probabilidade:** Média em ambiente publicado diretamente; baixa se houver proxy que remove headers recebidos do cliente.

**Evidência encontrada:** o login dependia de cabeçalho controlável pelo cliente antes do helper de confiança de proxy.

**Correção recomendada:** aceitar headers encaminhados somente com `TRUST_PROXY_HEADERS=1` e proxy confiável; caso contrário usar uma chave conservadora.

**Código atual/corrigido:** `server/local-http-auth.js:8–14` ignora headers por padrão. O login limita 60 tentativas por IP em 15 minutos e mantém a chave por IP/e-mail (`route.js:21–30`).

**Risco de regressão:** atrás de proxy confiável, é necessário configurar explicitamente `TRUST_PROXY_HEADERS=1`; sem isso vários clientes podem compartilhar a chave `unknown`.

**Status:** corrigido e coberto pelos testes locais de autenticação.

### SEC-003 — Cadastro local sem rate limit

**ID:** SEC-003  
**Título:** cadastro público podia ser usado para abuso de recursos  
**Severidade:** Medium — corrigido  
**Categoria:** API Abuse / Authentication Failures  
**CWE:** CWE-799 — Improper Control of Interaction Frequency  
**OWASP:** API4 Unrestricted Resource Consumption; A07 Identification and Authentication Failures  
**Arquivo:** `app/api/local-postgres/auth/register/route.js`  
**Linha(s):** 22–34  
**Componente:** cadastro local.

**Descrição:** quando o cadastro local estava habilitado, não havia limitação específica por IP/e-mail nessa rota.

**Cenário de exploração:** enviar muitos cadastros para consumir banco, gerar logs ou criar contas descartáveis.

**Impacto:** consumo de recursos, spam de contas e superfície para credential stuffing.

**Probabilidade:** Média se o cadastro público for ativado; produção deve mantê-lo desligado até haver verificação de e-mail.

**Evidência encontrada:** a rota executava `registerLocalUser` diretamente após ler o JSON.

**Correção recomendada:** limitar por IP e e-mail e, em publicação pública, adicionar verificação de e-mail/CAPTCHA adaptativo.

**Código atual/corrigido:** limites de 12/IP em 15 minutos e 5/e-mail por hora em `public.security_rate_limits`; produção bloqueia cadastro público por padrão.

**Risco de regressão:** cadastros legítimos em rede compartilhada podem dividir a chave conservadora; ajustar somente após métricas reais.

**Status:** corrigido.

### SEC-004 — Papel de runtime com BYPASSRLS e privilégios amplos

**ID:** SEC-004  
**Título:** `senhahub_service` pode ignorar RLS se a credencial do backend vazar  
**Severidade:** Medium — corrigido  
**Categoria:** Database Security / Least Privilege / Security Misconfiguration  
**CWE:** CWE-250 — Execution with Unnecessary Privileges; CWE-732 — Incorrect Permission Assignment for Critical Resource  
**OWASP:** A01 Broken Access Control; A05 Security Misconfiguration  
**Arquivo:** `supabase/migrations/20260819220000_local_runtime_role_grants.sql:1–15`; configuração de conexão local  
**Componente:** PostgreSQL e identidade do backend.

**Descrição original:** a auditoria confirmou `senhahub_service` com login e `rolbypassrls=true`. O papel era usado pelo backend para operar a base e tinha acesso amplo.

**Cenário de exploração:** obter a credencial do servidor por vazamento de ambiente, backup, log ou conta de infraestrutura e conectar ao PostgreSQL.

**Impacto:** leitura/modificação de dados de clientes e tabelas internas; potencial comprometimento amplo do banco.

**Probabilidade:** Baixa no estado atual, pois o PostgreSQL auditado está com `listen_addresses=localhost` e não há credencial privada versionada; sobe para Alta se a porta 5432 for exposta.

**Evidência original:** consulta somente leitura confirmou `senhahub_service: LOGIN=true, SUPERUSER=false, BYPASSRLS=true`; `listen_addresses=localhost`; `password_encryption=scram-sha-256`; 24/24 tabelas públicas com RLS.

**Correção aplicada:** manter o banco inacessível aos clientes; separar o papel de migrations do papel de runtime; remover `BYPASSRLS` do runtime; manter grants e policies explícitos; revogar login/privilégios de `senhahub_app` se não for usado; rotacionar credenciais.

**Código corrigido:** `supabase/migrations/20260820091000_local_runtime_nobypassrls.sql` aplica `ALTER ROLE senhahub_service NOBYPASSRLS`, grants explícitos e uma policy `senhahub_service_backend_access` por tabela pública necessária. A tabela `auth.password_resets` e as tabelas de autenticação também receberam grants privados explícitos.

**Risco de regressão:** médio se uma consulta nova não receber grant/policy explícito; o preflight e os testes de rotas devem bloquear essa regressão.

**Status:** corrigido; o preflight agora reprova qualquer retorno de `BYPASSRLS`.

### SEC-005 — `unsafe-inline` reduz a defesa de CSP

**ID:** SEC-005  
**Título:** Content Security Policy de produção permite scripts inline  
**Severidade:** Info / hardening  
**Categoria:** Security Misconfiguration / XSS Defense-in-Depth  
**CWE:** CWE-16 — Configuration  
**OWASP:** A03 Injection; A05 Security Misconfiguration  
**Arquivo:** `next.config.js:3–17`, `server/server.js:2745–2760`, `server/supabase-runtime.js:3351–3360`  
**Componente:** headers HTTP.

**Descrição:** a CSP mantém `script-src 'self' 'unsafe-inline'` para compatibilidade com scripts inline existentes. Isso não prova XSS: o código dinâmico analisado usa escaping e não confirmou entrada controlada pelo usuário em `dangerouslySetInnerHTML`. Porém a CSP oferece menos contenção se outra falha surgir.

**Cenário de exploração:** dependeria de uma segunda falha que injete HTML/script em resposta ou DOM.

**Impacto:** menor proteção de defesa em profundidade contra XSS.

**Probabilidade:** Baixa no código analisado; nenhum XSS foi confirmado.

**Evidência encontrada:** `script-src 'self' 'unsafe-inline'` nos geradores de headers; `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, HSTS em produção e `no-store` privado estão presentes.

**Correção recomendada:** migrar scripts inline para arquivos externos ou CSP com nonce/hash por resposta.

**Código atual/corrigido:** não alterado por ser mudança arquitetural de CSP, e não vulnerabilidade explorável confirmada.

**Risco de regressão:** alto para o PWA se inline scripts forem bloqueados sem migração.

**Status:** aberto como hardening.

## 5. Áreas sem vulnerabilidade confirmada

### Injection

- As consultas PostgreSQL locais analisadas usam parâmetros `$1`, `$2`, etc.; não foi encontrada concatenação de input de usuário em SQL local.
- As consultas SQLite legadas usam parâmetros `?` nos fluxos analisados.
- IDs, tokens, roles e status possuem validações/allowlists em camadas de repositório e rota.
- Não há MongoDB/Firestore/NoSQL; NoSQL injection não se aplica.
- Não foi encontrado `eval` ou `new Function` no código da aplicação.

### XSS e DOM

- Existem `innerHTML` em telas, mas os campos provenientes de API passam por `escapeHtml` nos trechos analisados.
- `dangerouslySetInnerHTML` em `app/_components/HtmlTemplate.jsx` lê templates locais allowlisted, não conteúdo de usuário.
- O SVG do QR é produzido por biblioteca local a partir de URL previamente validada.
- Nenhuma Stored/Reflected/DOM XSS foi confirmada. A CSP continua sendo hardening SEC-005.

### CSRF, cookies e sessões

- Mutations locais autenticadas exigem cookie de sessão, cookie CSRF e header `x-csrf-token` comparados com `timingSafeEqual`.
- Cookies de autenticação usam `HttpOnly`, `SameSite=Strict`, `Path=/`, expiração de 12 horas e `Secure` em produção.
- Sessões guardam apenas hash do token no PostgreSQL, têm expiração e são revogadas no logout.
- O teste local confirmou `invalidCsrfHttp: 403`, logout 200 e `/me` após logout 401.
- O erro anterior “Token CSRF inválido” é comportamento de proteção quando o cookie/header não estão sincronizados; não é evidência de bypass.

### BOLA/IDOR e mass assignment

- Tickets de cliente validam ownership; operações de staff validam função e setor permitido no backend.
- Campos administrativos não são aceitos livremente pelo cadastro público; o role inicial é cliente.
- Rotas de ticket usam transações, locks/constraints e testes paralelos confirmam uma única senha/chamada válida.
- O ciclo HTTP testado confirmou login, criação, chamada, confirmação e finalização com status 200/201.

### SSRF, path traversal, upload e command injection

- Não há upload ou download baseado em caminho informado pelo usuário.
- URLs de push e impressão são validadas/allowlisted; a consulta HIBP usa endpoint fixo.
- Os subprocessos de backup/restore usam argumentos estruturados; não foi encontrada concatenação de input de usuário em shell.
- Não há endpoint que aceite URL arbitrária para proxy/fetch.

### Redirect, clickjacking e headers

- `next` no middleware é derivado do pathname atual, não de URL externa arbitrária.
- `frame-ancestors 'none'` e `X-Frame-Options: DENY` bloqueiam clickjacking.
- Estão presentes `nosniff`, HSTS em produção, Referrer-Policy, Permissions-Policy, COOP, `base-uri`, `form-action` e `no-store` nas respostas privadas.

### PWA, push e impressão

- O Service Worker não mantém ações privadas offline sem bloqueio; cache e atualização têm políticas próprias.
- Web Push valida formato, provedor HTTPS, origem, CSRF, preferências e rate limit; endpoints externos arbitrários são rejeitados.
- Totem usa nonce, sessão, idempotência e fluxo claim/finish; teste confirmou não duplicação e estado `printed`.
- Token do agente e porta física são configurações externas; nunca devem ser colocados no frontend.

## 6. Banco de dados e controle de acesso

### Evidências do PostgreSQL auditado

    PostgreSQL: 18.6
    database: senhahub_local_teste
    listen_addresses: localhost
    password_encryption: scram-sha-256
    public tables: 24
    public tables with RLS: 24
    public/anon/authenticated table grants encontrados: 0

Roles sem login: `anon`, `authenticated`, `service_role`.  
`senhahub_service`: login, não superuser, `BYPASSRLS=false`; grants e policies explícitos; tratado em SEC-004.  
`senhahub_app`: role administrativa sem login após o hardening local; tratado em SEC-008.
`vitorstudzieski`: superuser local de administração, não deve ser usado pela aplicação.

As tabelas internas têm RLS/deny policies para clientes externos nas migrations de hardening. As funções `SECURITY DEFINER` verificadas usam `search_path` fixo quando necessário. A RLS não está `FORCE` nas tabelas públicas; por isso o papel de runtime e a proteção da credencial continuam sendo importantes.

## 7. Secrets, Git, logs e dados pessoais

- `.env` e `.env.local` são ignorados; apenas arquivos `.env.example` e `.env.print-agent.example` são rastreados.
- O backup compactado, bancos SQLite, WAL/SHM e diretório de backups existentes localmente não estão rastreados pelo Git.
- A varredura recursiva encontrou somente referências a nomes de variáveis/placeholders; nenhum valor privado foi incluído neste relatório.
- Não foram encontrados certificados, chaves privadas ou service-role keys versionados.
- Logs estruturados incluem método, rota, status, duração e request ID; tokens, cookies e senhas não devem ser adicionados a logs futuros.
- O sistema trata e-mails, nomes, identificadores de cliente, dispositivos e histórico de atendimento. É necessário definir retenção, finalidade, acesso administrativo, rotina de exclusão e política LGPD fora do código.

## 8. Backups, ransomware e recuperação

Existem scripts de backup/restore PostgreSQL e modelos de timer systemd. A documentação orienta chave de criptografia e diretório externo/offsite, mas a resiliência real depende da configuração do servidor. Não foi possível provar, somente pelo repositório, que há cópias imutáveis, offsite, controle de acesso separado ou restauração periódica em produção.

**Single Point of Failure atual:** um único servidor local concentra aplicação, PostgreSQL e, potencialmente, o agente de impressão. Se esse host for comprometido ou perder o disco, a operação para. Antes da produção, manter backup criptografado fora do host, retenção definida e teste de restauração documentado.

## 9. Dependências e supply chain

- `npm audit --omit=dev`: `critical=0`, `high=0`, `moderate=0`, `low=0`, `total=0`.
- Lockfile está presente e foi preservado.
- Next.js/React têm versões patch mais recentes disponíveis na data da auditoria; não foram atualizados automaticamente para evitar breaking changes. Fazer atualização controlada em branch com testes.
- Não há dependências instaladas de fontes Git desconhecidas no manifesto auditado.

## 10. Segunda varredura e validação

Após as correções, foram executados:

- `npm run check` — passou;
- `npm test` — **66/66 testes passaram**;
- `npm run build` — passou; permanece apenas warning conhecido de dependência dinâmica em `server/server.js` usado pelo dispatcher;
- `npm run preflight:local-postgres` após o hardening — passou: conexão real como `senhahub_service`, 24/24 tabelas públicas com RLS, `BYPASSRLS=false`, 28 tabelas requeridas e 7 funções requeridas, sem warnings;
- `npm run test:local-legacy-routes` — passou: métricas, ICCF, usuários, histórico, SSE, setor, carrinho, recuperação, troca e redefinição de senha;
- `npm run test:local-auth` — passou;
- `npm run test:local-auth-session-routes` — passou: login, `/me`, estado, validação, CSRF e logout;
- `npm run test:local-ticket-route` — passou: criação e cancelamento;
- `npm run test:local-ticket-alias` — passou: criação, chamada, confirmação e finalização;
- `npm run test:local-repository` — passou;
- `npm run test:local-ticket-lifecycle` — passou;
- `npm run test:local-ticket-rollback` — passou e confirmou que o ticket não persiste após rollback;
- `npm run test:local-maintenance` — passou e removeu sessão expirada de teste;
- `npm run test:local-kiosk` — passou com idempotência, claim e finish;
- busca recursiva de secrets — nenhum valor privado rastreado encontrado;
- busca de Docker/Compose/CI — nenhum arquivo encontrado;
- auditoria somente leitura do PostgreSQL — resultados registrados na seção 6.

Durante a primeira execução, a suíte legada falhou porque herdou as variáveis de `.env.local` e tentou usar PostgreSQL local. Os testes foram corrigidos para declarar explicitamente `DATA_BACKEND=sqlite` e desligar as flags locais em seus processos temporários. A segunda execução passou integralmente.

## 11. Matriz de segurança

| Área | Status | Risco | Observação |
| --- | --- | --- | --- |
| Autenticação | ✅ Protegido | Médio residual | Sessões, pgcrypto, expiração, troca/recuperação e rate limits; entrega de e-mail é configuração externa. |
| Autorização | ✅ Protegido | Médio residual | Ownership/setor no backend; runtime sem `BYPASSRLS`, com grants e policies explícitos. |
| Banco de dados | ✅ Protegido | Médio residual | Localhost, SCRAM, RLS e papel de runtime restrito; rede, backup e rotação dependem do servidor. |
| APIs | ✅ Protegido | Médio residual | Rotas principais e legadas inventariadas cobertas; rotas fora do mapa falham fechado. |
| SQL Injection | ✅ Protegido | Baixo | Queries parametrizadas; nenhum caso confirmado. |
| XSS | ✅ Protegido | Baixo | Escaping observado; CSP ainda permite inline. |
| CSRF | ✅ Protegido | Baixo | Cookie/header CSRF e SameSite Strict; testes passaram. |
| SSRF | ✅ Protegido | Baixo | Sem URL arbitrária; endpoints externos fixos/validados. |
| Brute Force | ⚠️ Precisa melhorar | Médio | Login/cadastro limitados; proxy deve ser configurado corretamente. |
| DDoS/DoS | ⚠️ Precisa melhorar | Médio | Rate limits pontuais; WAF/CDN/infra dependem do deploy. |
| Malware | ✅ Protegido | Baixo | Sem upload/execução arbitrária confirmada. |
| Ransomware | ⚠️ Precisa melhorar | Alto operacional | Backup/restore existem; imutabilidade/offsite precisam de prova. |
| Phishing | ⚠️ Precisa melhorar | Médio | Sem open redirect confirmado; MFA/alertas/domínio de e-mail pendentes. |
| Uploads | ✅ Protegido | N/A | Não há fluxo de upload identificado. |
| Secrets | ✅ Protegido | Médio residual | Ignorados e não rastreados; falta secret scanning automático. |
| Dependências | ✅ Protegido | Baixo | `npm audit` de produção sem vulnerabilidades; patches futuros pendentes. |
| Docker | ❓ Não presente | Médio operacional | Não há baseline de container para auditar/publicar. |
| CI/CD | ❓ Não presente | Médio operacional | Não há workflow com gates de segurança. |
| Logs | ✅ Protegido | Baixo | Logs estruturados e sem secrets observados; retenção/LGPD pendentes. |
| Backups | ⚠️ Precisa melhorar | Alto operacional | Scripts e restore existem; isolamento, retenção e teste recorrente precisam de prova. |
| LGPD | ⚠️ Precisa melhorar | Médio | Dados pessoais identificados; retenção, finalidade e acesso formal ainda pendentes. |

## 12. Top 10 riscos/prioridades

1. Não publicar a porta 5432; mesmo sem `BYPASSRLS`, a credencial do runtime deve ficar restrita à rede interna.
2. Manter `LOCAL_POSTGRES_ALLOW_LEGACY_FALLBACK=0` em produção e fazer o preflight no pipeline.
3. Configurar `TRUST_PROXY_HEADERS=1` somente atrás de proxy confiável que substitua os headers.
4. Separar/restringir `senhahub_app` e remover credenciais não usadas.
5. Garantir backups criptografados, offsite e imutáveis, com restauração testada.
6. Migrar CSP para nonce/hash quando o frontend deixar de depender de inline scripts.
7. Criar CI/CD com check, testes, build, SCA, secret scanning e revisão de permissões.
8. Atualizar patches de Next/React em branch controlada e repetir a suíte completa.
9. Formalizar retenção, minimização, auditoria e acesso a dados pessoais conforme LGPD.
10. Reexecutar o preflight após qualquer mudança de schema, role ou configuração do servidor.

## 13. Plano de correção

### Fase 1 — imediato

- manter o banco somente em rede interna/localhost;
- proteger e rotacionar `LOCAL_DATABASE_URL`, `AUTH_SECRET`, `CRON_SECRET` e `PRINT_AGENT_TOKEN`;
- não usar `vitorstudzieski` como usuário de runtime;
- executar e guardar o resultado do preflight antes de cada release.

### Fase 2 — urgente

- validar os endpoints administrativos com cada role no servidor definitivo;
- manter o guard fail-closed e `LOCAL_POSTGRES_ALLOW_LEGACY_FALLBACK=0`;
- validar todos os endpoints administrativos com cada role;
- criar cópia de backup offsite criptografada e executar restore em banco descartável.

### Fase 3 — hardening

- revisar periodicamente o papel de runtime, mantendo `NOBYPASSRLS` e a allowlist de grants/policies;
- revogar/remover `senhahub_app` se não for necessário;
- remover `unsafe-inline` com nonce/hash;
- limitar body, timeout, conexões e endpoints de alto custo no proxy;
- definir retenção e anonimização de logs/dados pessoais.

### Fase 4 — prevenção contínua

- CI com SAST, SCA, secret scanning, testes e build;
- revisão mensal de roles/grants;
- `npm audit` e atualização de patches controlada;
- alerta para login falho, alteração de role, reset de senha e ações administrativas;
- teste de restauração periódico e simulação de perda do servidor;
- revisão de segurança antes de habilitar cadastro público, push real ou acesso externo.

## Anexo A — Achados operacionais complementares

**Pode continuar em desenvolvimento local e staging controlado:** sim.  
**Código e rotas podem seguir para o servidor:** sim, após revisar o diff.  
**Produção definitiva pode ser liberada agora:** não sem concluir as validações externas de servidor, backup/restore, impressão e rede.  
**Pode fazer Git push das alterações desta auditoria:** sim, depois de revisar o diff e confirmar que nenhum `.env`, backup ou banco entrou no commit; o relatório registra pendências abertas e não afirma segurança absoluta.  
**Próximo marco:** executar preflight de produção no servidor definitivo, testar impressão real na COM5 e validar backup/restore antes de liberar a rede da loja.

Nenhuma vulnerabilidade conhecida Critical foi identificada nos controles analisados dentro do escopo desta auditoria. Foram mitigados os problemas de fallback silencioso, confiança indevida em IP para rate limit, ausência de limite no cadastro local e `BYPASSRLS` no runtime; permanecem riscos operacionais de implantação que precisam ser tratados antes da publicação definitiva.

### SEC-006 — Preflight de produção não é bloqueio automático do processo

**ID:** SEC-006  
**Título:** validação completa de ambiente depende de etapa operacional  
**Severidade:** Info / hardening  
**Categoria:** Security Misconfiguration / Deployment Safety  
**CWE:** CWE-16 — Configuration  
**OWASP:** A05 Security Misconfiguration  
**Arquivo:** `scripts/production-preflight.js:7–18`, `server/server.js:175–199`  
**Componente:** inicialização/deploy.

**Descrição:** `npm run preflight:production` valida secrets, URLs, flags, VAPID e impressão, mas o servidor standalone não executa todas essas validações antes de escutar. `AUTH_SECRET` possui bloqueio próprio; outras falhas ficam visíveis por health/readiness ou dependem do deploy.

**Cenário:** operador inicia o serviço sem executar o preflight ou ignora health 503.

**Impacto:** serviço parcialmente configurado, endpoints indisponíveis ou controles incompletos.

**Probabilidade:** Média como erro operacional; não é bypass direto de autorização.

**Evidência encontrada:** o preflight existe e reprova ambiente inválido; `startStandaloneServer` inicia o listener sem chamar `validateProductionEnvironment`.

**Correção recomendada:** integrar o preflight obrigatoriamente no unit file/deploy pipeline e usar health/readiness como condição de tráfego.

**Código atual/corrigido:** o preflight e os testes foram reforçados para rejeitar fallback legado em produção; integração obrigatória no serviço ainda não foi implementada.

**Risco de regressão:** baixo se aplicado no systemd/CI; médio se o processo for encerrado antes do diagnóstico.

**Status:** aberto como hardening operacional.

### SEC-007 — Ausência de baseline versionado de CI/CD, SAST, SCA e secret scanning

**ID:** SEC-007  
**Título:** não há pipeline de segurança no repositório  
**Severidade:** Info  
**Categoria:** Software Supply Chain / DevSecOps  
**CWE:** não aplicável — lacuna de processo  
**OWASP:** A06 Vulnerable and Outdated Components; Software Supply Chain Failures  
**Arquivo:** nenhum `.github/workflows`, Dockerfile ou Compose encontrado  
**Componente:** entrega de software.

**Descrição:** os testes existem e o `npm audit` foi executado, mas não há pipeline versionado que obrigue check, testes, build, SCA e secret scanning antes de merge/deploy.

**Cenário:** uma alteração futura introduz segredo, dependência vulnerável ou regressão e chega ao servidor sem gate automático.

**Impacto:** aumento da probabilidade de regressões e supply-chain issues.

**Probabilidade:** Média ao longo do tempo; não é exploração presente no código atual.

**Evidência encontrada:** busca recursiva não encontrou workflows, Dockerfile ou Compose.

**Correção recomendada:** adicionar pipeline com `npm ci`, `npm run check`, `npm test`, `npm run build`, `npm audit --omit=dev`, secret scanner e revisão de lockfile.

**Código atual/corrigido:** nenhum código de aplicação necessário; pipeline não foi criado automaticamente para não escolher provedor/permissões sem decisão de deploy.

**Risco de regressão:** baixo.

**Status:** aberto como prevenção contínua.

### SEC-008 — Papel adicional `senhahub_app` tinha login e privilégios amplos

**ID:** SEC-008  
**Título:** credencial de aplicação não usada aumenta a superfície operacional  
**Severidade:** Info — corrigido
**Categoria:** Least Privilege / Database Hardening  
**CWE:** CWE-250 — Execution with Unnecessary Privileges  
**OWASP:** A01 Broken Access Control; A05 Security Misconfiguration  
**Arquivo:** roles do PostgreSQL local; grants da base  
**Componente:** gerenciamento de identidades do banco.

**Descrição original:** `senhahub_app` aparecia com `LOGIN=true` e sem `BYPASSRLS`, enquanto o runtime auditado usa `senhahub_service`.

**Cenário de exploração:** operador reutiliza ou vaza a credencial e o atacante tenta conectar ao banco local/rede.

**Impacto:** superfície adicional de credenciais e possível acesso além do necessário, dependendo dos grants.

**Probabilidade:** Baixa com PostgreSQL em localhost; maior se a porta for publicada.

**Evidência encontrada:** a migration local de reconciliação revoga os grants e aplica `NOLOGIN` a `senhahub_app`; o backend local usa exclusivamente `senhahub_service`.

**Correção aplicada:** revogar login, grants de tabelas/sequências e uso dos schemas `public` e `auth` para `senhahub_app`.

**Código atual/corrigido:** `supabase/migrations/20260820125056_local_postgres_runtime_reconciliation.sql`.

**Risco de regressão:** baixo após confirmar que a role não é usada.

**Status:** corrigido no PostgreSQL local.

## 14. Estado final e decisão de publicação

**Pode continuar em desenvolvimento local e staging controlado:** sim.  
**Código e rotas podem seguir para o servidor:** sim, após revisar o diff.  
**Produção definitiva pode ser liberada agora:** não sem concluir as validações externas de servidor, backup/restore, impressão e rede.  
**Pode fazer Git push das alterações desta auditoria:** sim, depois de revisar o diff e confirmar que nenhum `.env`, backup ou banco entrou no commit; o relatório registra pendências abertas e não afirma segurança absoluta.  
**Próximo marco:** executar preflight de produção no servidor definitivo, testar impressão real na COM5 e validar backup/restore antes de liberar a rede da loja.

Nenhuma vulnerabilidade conhecida Critical foi identificada nos controles analisados dentro do escopo desta auditoria. Foram mitigados os problemas de fallback silencioso, confiança indevida em IP para rate limit, ausência de limite no cadastro local e `BYPASSRLS` no runtime; permanecem riscos operacionais de implantação que precisam ser tratados antes da publicação definitiva.
