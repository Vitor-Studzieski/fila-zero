# Relatorio de Auditoria Tecnica - Fila Zero

Data: 2026-07-16

Atualizado em: 2026-07-17

Escopo: repositorio em `/Users/vitorstudzieski/Projetos/inova-supermercado`

Estado analisado: `main` no commit `29b58b9`

## 1. Resumo executivo

O projeto compila, os 16 testes de integracao existentes passam e a auditoria de dependencias nao encontrou vulnerabilidades conhecidas. A separacao de papeis nas rotas HTTP funciona nos testes executados, e o backend SQLite usa consultas preparadas.

O sistema ainda nao deve ser tratado como pronto para producao antes da correcao de dois problemas criticos e quatro altos. Os riscos principais estao nas permissoes SQL do Supabase, nas funcoes `security definer`, na concorrencia das transicoes de fila, na liberacao incorreta da espera inteligente e na verificacao de presenca desativada.

Foram catalogados 26 achados: 2 criticos, 4 altos, 14 medios, 3 baixos e 3 informativos. Os 2 criticos e os 4 altos foram corrigidos no repositorio, cobertos por regressao e aplicados ao schema do Supabase em 2026-07-17. O schema, os backends e o frontend corrigidos fazem parte da mesma revisao para implantacao pela `main`.

## 2. Arquitetura identificada

- Frontend: Next.js 16 App Router entrega quatro paginas (`/`, `/login`, `/attendant`, `/admin`) formadas por templates HTML em `public/` e JavaScript sem framework no navegador.
- Adaptador HTTP: `app/api/[...path]/route.js` encaminha todas as operacoes `/api/*`.
- Proxy: `proxy.js` protege as paginas por cookie assinado e papel.
- Backend local: `server/server.js`, Node HTTP + SQLite, tambem inicia o Next no desenvolvimento.
- Backend de producao: `server/supabase-runtime.js`, selecionado por `DATA_BACKEND=supabase`, usa Auth, REST e RPC do Supabase.
- Banco: `supabase/migrations/0001_initial_schema.sql`, com RLS, triggers e funcoes de fila.
- Autenticacao: Supabase Auth ou usuarios locais; a aplicacao emite cookie `fz_auth` assinado, `HttpOnly`, e cookie duplo de CSRF.
- Atualizacao: SSE no servidor persistente e polling no navegador; na Vercel, a resposta SSE atual e encerrada apos um unico evento.
- Testes: um arquivo de integracao, `tests/orchestration.test.js`, executando somente o backend SQLite em banco temporario.
- Integracoes: Supabase e Vercel. Nao ha provedor de e-mail, CAPTCHA, observabilidade ou fila de jobs configurado no codigo.

## 3. Fluxos principais

### Cliente

Login/cadastro -> sessao assinada -> check-in -> escolha do setor -> emissao de senha -> acompanhamento -> confirmacao -> finalizacao/cancelamento -> avaliacao. Lista de compras e sinais comportamentais usam rotas proprias vinculadas ao usuario autenticado.

### Atendente

Login -> carregamento apenas dos setores permitidos -> chamada -> confirmacao -> finalizacao ou ausencia/standby. A autorizacao do setor e repetida no backend antes das mutacoes.

### Gestor

Login -> metricas/ICCF -> filas -> criacao de usuarios -> edicao dos tres setores existentes. Edicao/desativacao de usuarios, criacao de setores e regras operacionais ainda nao possuem API completa.

## 4. Matriz de achados

| ID | Severidade | Categoria | Problema | Evidencia | Arquivo/linha | Impacto | Correcao recomendada |
| -- | ---------- | --------- | -------- | --------- | ------------- | ------- | -------------------- |
| SEC-01 | Critica | Autorizacao/RLS | Politica permite alterar qualquer coluna do proprio perfil | `UPDATE` verifica apenas `id = auth.uid()` | `supabase/migrations/0001_initial_schema.sql:316` | Cliente pode promover o proprio papel ou reativar a conta | Revogar `UPDATE` amplo e conceder somente `UPDATE(name)` |
| SEC-02 | Critica | PostgreSQL/RPC | Funcoes `security definer` sem restricao de execucao | Nao ha `REVOKE EXECUTE` apos as funcoes | `0001_initial_schema.sql:353`, `:482` | Chamadas/emissoes diretas ignorando a API e seus limites | Conceder execucao somente a `service_role` |
| BIZ-03 | Alta | Regra de fila | Espera inteligente e liberada diretamente como chamada | Teste isolado deixou F000 e F001 em `chamado` no mesmo setor | `server/server.js:1857`; `server/supabase-runtime.js:538` | Dupla chamada e conflito no balcao | Voltar a `aguardando` e usar a chamada atomica normal |
| DB-04 | Alta | Concorrencia | Transicoes Supabase usam leitura e escrita separadas | Confirmacao faz `SELECT`, `PATCH` e `INSERT` sem transacao | `supabase-runtime.js:445-535` | Estados/servicos duplicados sob concorrencia | RPCs transacionais, compare-and-set e indices parciais unicos |
| SEC-05 | Alta | Presenca | QR/localizacao estao desativados e o SQL registra QR verdadeiro | Flags fixas em `false`; `issue_ticket` grava `true` | `public/app.js:19`; `server/server.js:32`; SQL `:469-472` | Emissao remota e trilha de auditoria falsa | Configuracao segura e validacao server-side antes da emissao |
| API-06 | Alta | Disponibilidade | Mutacoes anonimas podem ficar sem resposta | `verifyCsrf` retorna sem enviar `401`; timeout reproduzido | `server/server.js:514-542`, `:1111` | Consumo de conexoes e indisponibilidade | Responder `401` imediatamente |
| AUTH-07 | Media | Sessao | Logout/troca de senha nao revogam token stateless | Exclusao usa cookie como ID de uma sessao com outro ID | `server/server.js:1079-1108` | Token capturado continua valido por ate 12 horas | Registro/versionamento e revogacao de sessao |
| AUTH-08 | Media | Recuperacao | Link de esquecimento exige senha atual | Formulario chama apenas `change-password` | `public/login.html:58`, `:85-100` | Usuario sem senha nao recupera a conta | Fluxo de recovery do Supabase |
| AUTH-09 | Media | Abuso | Cadastro e limitado por IP+e-mail e diverge entre backends | E-mails diferentes contornam o contador; SQLite confirma sempre | `supabase-runtime.js:174-198`; `server.js:1044-1050` | Criacao automatizada de contas | Limite por IP, CAPTCHA e configuracao unica |
| BIZ-10 | Media | Preferencial | Cliente autodeclara prioridade | API aceita booleano e categoria enviados pelo cliente | `supabase-runtime.js:1805`; `server.js:1421` | Abuso da ordem preferencial | Aprovacao operacional e trilha de auditoria |
| DB-11 | Media | Dispositivo | ID fornecido pode ser reassociado a outro cliente | Upsert sobrescreve `customer_id` | `server.js:1477-1487`; runtime `:1417-1422` | Bloqueio artificial por dispositivo | Impedir troca de dono e assinar o identificador |
| DB-12 | Media | Retencao | Cascata de perfil apaga historico | FKs de tickets/servicos usam `on delete cascade` | SQL `:79-82`, `:147-159` | Perda de historico e auditoria | Soft delete ou anonimizacao |
| BIZ-13 | Media | Fechamento | Setor fecha mesmo com senhas ativas | Update nao verifica fila antes de `closed` | `server.js:1879`; runtime `:557` | Senhas ficam presas | Bloquear ou exigir estrategia explicita |
| OPS-14 | Media | Jobs | Jobs dependem de requisicoes e coordenacao local | `scheduledJobsPromise` vale so por instancia | `supabase-runtime.js:1425-1518` | Atraso e corrida em multiplas instancias | Cron/worker e transicoes condicionais |
| PERF-15 | Media | Desempenho | N+1, agregacoes repetidas e limites silenciosos | DTO executa varias consultas; insights limitam 1000/2000 | `supabase-runtime.js:623-648`, `:1262-1275` | Latencia e relatorios incompletos | RPC/view agregada, lote e paginacao |
| WEB-16 | Media | Headers | Paginas Next na Vercel nao recebem os headers definidos no backend | `next.config.js` nao possui `headers()` | `next.config.js:1-4` | Protecao desigual das paginas | Configurar headers globais no Next |
| UX-17 | Media | Rede/idempotencia | Mutacoes nao possuem chave idempotente ou reconciliacao | `fetch` unico e sem retry controlado | `public/app.js:1879-1894` | Estado incerto apos perda de resposta | Idempotency key, bloqueio e reconciliacao |
| MAINT-18 | Media | Manutencao | Dominio duplicado e arquivos excessivamente grandes | Backends com 2771/1987 linhas; CSS com 5492 | `server/`, `public/app.js`, `styles.css` | Divergencia e regressao | Extrair dominio e adicionar lint/cobertura |
| FUNC-19 | Media | Gestor | Gerenciamento administrativo esta incompleto | Somente GET/POST de usuario e PUT de setor existente | `supabase-runtime.js:332-403` | Gestor nao cumpre todo o fluxo descrito | CRUD granular e auditado |
| A11Y-20 | Baixa | Acessibilidade | Tabs/label/modal e textos pequenos possuem lacunas | ARIA incompleto, label sem `for`, fontes 10-11px | `login.html:41`; `index.html:330`, `:398`; `styles.css` | Piora para teclado, leitor de tela e idosos | Semantica, foco e tipografia minima |
| API-21 | Baixa | Validacao | JSON invalido vira objeto vazio; mensagens/status divergem | `readJson` oculta erro e existem textos com mojibake | `supabase-runtime.js:1904`; `server.js:1754` | Diagnostico ruim | Responder 400 e normalizar UTF-8/HTTP |
| DB-22 | Baixa | Constraints | Faltam checks de intervalo e coerencia | Colunas numericas aceitam valores impossiveis pela service role | SQL `:51-63`, `:79-108`, `:183-194` | Corrupcao logica por erro interno | `CHECK`s e invariantes |
| PRIV-23 | Informativa | Arquitetura | Todas as consultas do runtime usam `service_role` | Chave administrativa e o padrao do helper | `supabase-runtime.js:1747-1757` | Falha de rota ganha alcance total | Usar JWT do usuario quando aplicavel |
| OBS-24 | Informativa | Operacao | Nao ha observabilidade estruturada | Somente `console.error` disperso | Backend inteiro | Deteccao e diagnostico lentos | Logs, request ID, metricas e alertas |
| PWA-25 | Informativa | Continuidade | Nao ha PWA ou estrategia offline | Ausencia de manifest/service worker/outbox | `app/`, `public/` | Sem instalacao e resiliencia offline | Planejar PWA sem operar estado obsoleto |
| AUTH-26 | Media | Autenticacao | Protecao contra senhas vazadas esta desativada no Supabase | Security Advisor do projeto ativo | Configuracao do Auth | Senhas conhecidas em vazamentos podem ser aceitas | Ativar leaked password protection no painel do Supabase |

## 5. Cenarios de negocio e concorrencia

| # | Comportamento atual | Esperado | Risco | Codigo envolvido | Correcao recomendada |
| - | ------------------ | -------- | ----- | ---------------- | -------------------- |
| 1 | SQLite serializa no processo; RPC bloqueia o setor | So uma chamada vencer | Baixo apos proteger RPC | `callNextTicket`, `call_next_ticket` | Manter lock e indice unico por setor |
| 2 | Retorna a senha ativa existente | Nao duplicar | Baixo; falta constraint de defesa | `createTicket`, `issue_ticket` | Indice unico parcial cliente/setor |
| 3 | Permite ate tres setores e usa espera inteligente | Permitir sem dupla chamada | Alto pelo BIZ-03 | `callNextTicket`, `releaseSmartWaitTicket` | Liberacao pela fila normal |
| 4 | Dois RPCs de setores diferentes podem nao enxergar o commit concorrente | Um chamado e outro em espera | Alto | `call_next_ticket` | Indice unico parcial por cliente + tratamento da colisao |
| 5 | Estado e recarregado do banco | Continuar chamada | Baixo | `/api/state`, polling | Manter e adicionar E2E |
| 6 | Estado do setor e recarregado | Continuar atendimento | Baixo | `/api/staff/state` | Manter e adicionar E2E |
| 7 | Tela fica desatualizada ate reconectar | Banco consistente e aviso de offline | Medio | `connectRealtime`, polling | Banner offline e reconciliacao |
| 8 | Chamada persiste e job pode mover para standby | Nao perder a chamada | Medio no Supabase sem trafego | jobs de ausencia | Cron confiavel |
| 9 | Emissao e quase idempotente; confirmacao Supabase nao | Mesma operacao produzir um efeito | Alto | rotas de mutacao | Idempotency key e compare-and-set |
| 10 | Alguns botoes bloqueiam, mas backend nao recebe chave da acao | Um efeito por intencao | Medio | scripts publicos e APIs | Bloqueio + idempotencia |
| 11 | Job pode ler `aguardando/chamado` e gravar estado obsoleto depois | Transicao atomica prevalecer | Alto | jobs `expire*` | Update condicional/RPC |
| 12 | Standby e elegivel, mas expiracao/chamada podem disputar no limite | Retorno antes do prazo vencer | Alto no runtime atual | standby jobs e `call_next_ticket` | Comparacao atomica com horario do banco |
| 13 | Validacao de status existe; duas requisicoes Supabase podem passar pela mesma leitura | Segunda deve falhar sem efeitos | Alto | `finishTicket` | RPC transacional |
| 14 | Candidato cancelado nao entra na consulta de chamada | Nunca chamar cancelado | Baixo | `CALL_ELIGIBLE_STATUSES` | Manter teste de regressao |
| 15 | Proxy redireciona e API retorna 403 | Cliente sem acesso | Baixo | `proxy.js`, `requireUser` | Manter testes dinamicos |
| 16 | `customerId` e sobrescrito pelo backend; ticket tem ownership; `deviceId` ainda e manipulavel | Ignorar identidade do cliente | Medio | rotas e `upsertSession` | Corrigir dono do dispositivo |
| 17 | Teste dinamico retornou 403 e estado so listou o setor autorizado | Atendente restrito | Baixo | `canAccessSector` | Manter testes por papel/setor |
| 18 | Depois de 999 o contador volta a 000 | Ciclo definido sem ambiguidade ativa | Medio em alto volume | `nextTicketNumber`, `issue_ticket` | Garantir que codigo ativo nao seja reutilizado |
| 19 | Pode haver codigo repetido no mesmo setor depois do ciclo | Nome principal e apoio inequivoco | Medio | contador e ausencia de unique | Regra de reutilizacao e restricao parcial |
| 20 | Nome e principal e codigo aparece como apoio | Diferenciar homonimos | Baixo | DTO e telas de atendente | Exibir nome + codigo sempre |
| 21 | Nao ha rota de exclusao; exclusao Auth cascata o historico | Resolver senhas e preservar historico | Medio | FKs e futuro CRUD | Soft delete e bloqueio com senha ativa |
| 22 | Setor pode fechar com senhas ativas | Decisao explicita | Medio | `updateSector` | Validacao e confirmacao administrativa |
| 23 | Countdown usa `Date.now()` do navegador apesar de receber `serverTime` | Usar relogio do servidor | Medio | `app.js:320`, `:353-357` | Calcular offset do servidor |
| 24 | Nao ha versao monotona; resposta antiga pode sobrescrever nova | Ignorar estado antigo | Medio | polling/SSE | Versao/event sequence |
| 25 | SQLite e sequencial; Supabase possui read-then-write | Uma aba vence, outra recebe conflito | Alto | transicoes do runtime | RPC/compare-and-set e teste concorrente |

## 6. Seguranca por classe

- Segredos: nenhum `.env` rastreado e nenhum segredo real encontrado no historico pesquisado.
- SQL injection: nao confirmada; SQLite usa statements preparados e parametros dinamicos do PostgREST sao codificados.
- XSS: nao confirmado. Ha uso de `innerHTML`, mas os valores dinamicos inspecionados passam por `escapeHtml`; os templates Next sao arquivos confiaveis do repositorio.
- CSRF: modelo de double-submit esta implementado. A falha API-06 esta no tratamento da ausencia de usuario.
- IDOR: ownership de senha, carrinho e papeis funcionou nos fluxos HTTP testados. O ID manipulavel de dispositivo permanece.
- CORS/SSRF/upload/command injection/path traversal: nao foram encontrados endpoints ou construcoes exploraveis no escopo atual.
- Dependencias: `npm audit --audit-level=low` reportou zero vulnerabilidades.

## 7. Qualidade, desempenho e interface

O maior risco de manutencao e a duplicacao das regras entre SQLite e Supabase. O runtime Supabase tambem apresenta consultas N+1 no DTO de senha e agregacoes sem paginacao real. A interface possui foco visivel e indicacao textual de prioridade, mas a semantica de tabs, associacao de label, foco de dialogo e tamanhos tipograficos precisam de trabalho.

A verificacao visual automatizada nao foi concluida: o plugin do navegador falhou durante a inicializacao com `Cannot redefine property: process`, inclusive apos reset. Nenhuma alegacao de validacao visual foi feita; os achados de interface sao provenientes de inspecao estatica de HTML/CSS/JS.

## 8. Testes e comandos executados antes das correcoes

- `npm run check`: passou.
- `npm test`: 16 de 16 testes passaram em aproximadamente 33 segundos.
- `npm run build`: passou; paginas e API foram compiladas.
- `npm audit --audit-level=low --json`: zero vulnerabilidades.
- Busca de segredos rastreados: nenhum segredo real encontrado.
- Testes HTTP isolados: redirecionamento das paginas e autorizacao por papel/setor passaram.
- Requisicao anonima de confirmacao: timeout reproduzido.
- Concorrencia de espera inteligente: duas senhas em `chamado` no mesmo setor reproduzidas.
- Na auditoria inicial, o Supabase real foi consultado somente para metadados e contagens; nenhum dado foi criado, alterado ou excluido e nenhum e-mail real foi enviado.

## 9. Verificacao somente-leitura do Supabase ativo

A verificacao do projeto `Fila_zero` confirmou que, antes da nova migration, `issue_ticket`, `call_next_ticket` e `handle_new_auth_user` eram `security definer` e podiam ser executadas por `PUBLIC`, `anon` e `authenticated`. A politica de atualizacao de `profiles` tambem limitava apenas a linha, sem limitar as colunas. Isso confirma SEC-01 e SEC-02 em ambiente real.

No instante da consulta nao havia duplicidade de chamada ativa por setor ou cliente, senha ativa duplicada por cliente/setor ou servico aberto duplicado. Essa ausencia de inconsistencias atuais nao substitui as restricoes adicionadas para impedir corridas futuras.

Os advisors tambem apontaram chaves estrangeiras sem indice e chamadas de `auth.uid()` sem initplan; a migration revisada inclui os indices e usa `(select auth.uid())`. O advisor de Auth indicou protecao contra senhas vazadas desativada, registrada como AUTH-26.

Em 2026-07-17, apos solicitacao explicita de implementacao dos P0, a migration foi aplicada ao projeto `Fila_zero` dentro de uma transacao. A verificacao posterior confirmou as ACLs restritas, as cinco invariantes unicas, zero violacoes de concorrencia e preservacao das configuracoes dos setores.

## 10. Cobertura faltante

- Testes de integracao contra PostgreSQL/Supabase local.
- Testes E2E em navegador para login, recarga, offline e acessibilidade.
- Testes de carga e concorrencia multi-instancia.
- Cobertura de codigo e mutation testing.
- Testes formais de RLS com `anon`, `authenticated` e `service_role`.

## 11. Correcoes implementadas

| IDs | Alteracao | Estado no repositorio |
| --- | --------- | --------------------- |
| SEC-01 | Revogacao do `UPDATE` amplo em `profiles` e concessao apenas de `UPDATE(name)` | Implementada |
| SEC-02 | RPCs de fila como `security invoker`, execucao revogada de `PUBLIC/anon/authenticated` e concedida a `service_role` | Implementada |
| BIZ-03 | Espera inteligente retorna a `aguardando` e disputa a chamada pelo fluxo normal | Implementada nos dois backends |
| DB-04 | RPCs transacionais de emissao, confirmacao e finalizacao; compare-and-set nos jobs; indices unicos parciais | Implementada na migration/runtime |
| SEC-05 | Presenca ativa por padrao em producao, QR validado no servidor e flags persistidas com o valor real | Implementada |
| API-06 | Mutacao anonima recebe `401` imediatamente | Implementada |

As mudancas tambem adicionam indices para as chaves estrangeiras apontadas pelo advisor, tornam o `search_path` das funcoes explicito, removem o QR da URL e guardam o check-in somente em `sessionStorage`.

## 12. Validacao depois das correcoes

- `npm run check`: passou.
- `npm test`: 22 de 22 testes passaram em 33,3 segundos.
- `npm run build`: passou com Next.js 16.2.6; seis paginas geradas e a rota dinamica de API compilada.
- `npm audit --audit-level=low --json`: zero vulnerabilidades em 52 dependencias.
- `git diff --check`: passou.
- Smoke HTTP da build de producao: `/` e `/admin` redirecionaram para login, `/api/config` respondeu e mutacao anonima retornou `401` sem timeout.
- Browser desktop e mobile: pagina com conteudo, sem overlay do Next e sem overflow horizontal; os controles principais apareceram na arvore de acessibilidade.
- O teste visual foi executado com `agent-browser`; os servidores e dados temporarios foram removidos ao final.
- A migration PostgreSQL foi aplicada ao projeto Supabase `Fila_zero` em uma transacao e verificada pela Data API e pelo catalogo PostgreSQL.
- Pela Data API, `anon` recebeu `401 permission_denied`; `service_role` executou a RPC e retornou `ticket_not_found` para um UUID inexistente, sem alterar dados.
- Os advisors nao apresentam mais os alertas criticos das RPCs/RLS. Permanecem apenas tabelas internas sem politica, protegidas por ausencia de grants, e a protecao contra senhas vazadas desativada.

## 13. Pendencias e decisoes

- Confirmar que a Vercel implantou a revisao da `main` com `PRESENCE_CHECK_ENABLED=1` e tokens QR longos e distintos.
- Ativar protecao contra senhas vazadas no Supabase Auth.
- Definir as regras operacionais de prioridade, fechamento de setor, retencao/anonimizacao e geolocalizacao.
- Implementar os itens medios e baixos descritos no plano, com prioridade para revogacao de sessao, recovery real, jobs duraveis e headers das paginas na Vercel.
