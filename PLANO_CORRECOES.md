# Plano de Correcoes - Fila Zero

Data: 2026-07-16

Atualizado em: 2026-07-17

## Correcoes imediatas

| Prioridade | Itens | Dependencias | Risco da alteracao | Arquivos | Testes | Criterio de aceite | Estado |
| ---------- | ----- | ----------- | ------------------ | -------- | ------ | ------------------ | ------ |
| P0 | SEC-01: impedir alteracao de `role/status` | Reaplicar migration no Supabase | Baixo | migration SQL | Teste SQL por papel | Cliente so consegue alterar `name` | Concluida |
| P0 | SEC-02: fechar RPCs `security definer` | Reaplicar migration | Baixo | migration SQL | Teste de grants | `anon/authenticated` recebem permission denied; service role executa | Concluida |
| P0 | BIZ-03: corrigir espera inteligente | Nenhuma | Medio | dois backends | Regressao com setor ocupado | Nunca existem duas senhas chamadas/atendidas por setor ou cliente | Concluida |
| P0 | DB-04: tornar transicoes atomicas | Novas RPCs/indices | Medio/alto | migration e runtime Supabase | Duplicacao e concorrencia | Duas confirmacoes/finalizacoes produzem um unico efeito | Concluida |
| P0 | SEC-05: validar presenca de verdade | QR tokens validos no ambiente | Medio | frontend, backends e migration | QR ausente/invalido/valido | Producao rejeita emissao sem presenca e grava flags reais | Concluida |
| P0 | API-06: finalizar resposta anonima | Nenhuma | Baixo | backend SQLite | Endpoint anonimo | Resposta `401` em tempo finito | Concluida |

## Correcoes de curto prazo

| Prioridade | Itens | Dependencias | Risco | Arquivos | Testes | Criterio de aceite |
| ---------- | ----- | ----------- | ----- | -------- | ------ | ------------------ |
| P1 | AUTH-07/08/09: revogacao, recovery e antiabuso | Decisao de e-mail/CAPTCHA | Medio | auth, login, schema | Sessao antiga, recovery, rate limit | Senha revoga sessoes e recovery funciona sem senha atual |
| P1 | AUTH-26: bloquear senhas vazadas | Configuracao do Supabase Auth | Baixo | painel Supabase | Cadastro com senha comprometida | Supabase rejeita senha presente em base de vazamentos |
| P1 | BIZ-10/13: prioridade e fechamento | Decisoes operacionais | Medio | APIs e paineis | Preferencial e setor com fila | Nenhuma prioridade/fechamento sem regra explicita |
| P1 | DB-11/12/22: dispositivos, retencao e checks | Politica de retencao | Medio | schema/backends | Ownership e constraints | Historico preservado e dados impossiveis rejeitados |
| P1 | OPS-14: jobs duraveis | Cron/worker | Medio | backend/deploy | Tempo e concorrencia | Jobs rodam sem depender de acesso e uma vez por janela |
| P1 | WEB-16/API-21 | Nenhuma | Baixo | Next/runtime | Headers e JSON invalido | Todas as paginas tem headers; JSON invalido retorna 400 |
| P1 | A11Y-20 | Verificacao em navegador | Baixo | HTML/CSS/JS | Teclado e axe | Fluxos operaveis por teclado e labels anunciados |

## Melhorias futuras

| Prioridade | Itens | Dependencias | Risco | Arquivos | Testes | Criterio de aceite |
| ---------- | ----- | ----------- | ----- | -------- | ------ | ------------------ |
| P2 | PERF-15: agregacoes e paginacao | Volume de referencia | Medio | SQL/runtime | Benchmark | Latencia e numero de consultas dentro do SLO |
| P2 | MAINT-18: modulo de dominio comum | Suite ampliada | Alto | server/public | Cobertura de regressao | Uma implementacao de regras para os dois adaptadores |
| P2 | FUNC-19: CRUD administrativo | Requisitos de negocio | Medio | admin/API/schema | Autorizacao por acao | Gestor gerencia recursos com auditoria |
| P2 | UX-17/PWA-25 | Estrategia offline | Medio | frontend | Falhas de rede/E2E | Interface reconcilia operacoes sem duplicar estado |
| P2 | OBS-24 | Plataforma de observabilidade | Baixo | backend/deploy | Teste de alertas | Incidentes possuem request ID, metricas e alerta |

## Ordem de implementacao desta auditoria

1. Restringir RLS e grants das RPCs.
2. Adicionar invariantes e transicoes atomicas no PostgreSQL.
3. Corrigir a liberacao da espera inteligente nos dois backends.
4. Ativar e validar presenca com configuracao segura.
5. Corrigir a resposta `401` e adicionar regressao.
6. Executar check, testes, build e auditoria de dependencias novamente.

## Decisoes de negocio pendentes

- Como o estabelecimento comprovara a prioridade declarada pelo cliente.
- Se o fechamento de setor deve bloquear, transferir ou cancelar senhas ativas.
- Coordenadas e raio corretos da loja, caso geolocalizacao seja aceita alem do QR.
- Prazo legal de retencao e forma de anonimizar historico.
- Provedor de e-mail e CAPTCHA para recovery/cadastro.

## Resultado desta rodada

Os seis itens P0 foram implementados no repositorio e aplicados ao projeto Supabase `Fila_zero` em 2026-07-17. A migration foi executada em uma transacao e validada por grants, ACLs, indices e invariantes: `anon/authenticated` nao executam as RPCs de fila, `service_role` executa, clientes so possuem `UPDATE(name)` e nao ha duplicidades ativas.

`npm run check`, os 22 testes, `npm run build`, `npm audit` e o smoke visual/HTTP da build de producao foram concluidos com sucesso. Esta revisao reune o schema, os backends e o frontend que devem ser implantados juntos pela `main`.
