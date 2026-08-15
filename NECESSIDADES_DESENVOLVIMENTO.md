# Necessidades de Desenvolvimento - Fila Zero

Atualizado em: 2026-08-05

Este documento transforma as pendencias do relatorio de auditoria em backlog tecnico. Os itens marcados como **em desenvolvimento** ja possuem implementacao iniciada neste ciclo.

## Prioridade 1 - Jobs duraveis

**Objetivo:** manter chamadas automaticas, expiracao de senhas, notificacoes e processamento de tarefas funcionando mesmo quando nao houver usuarios navegando no sistema.

### Entregas

- [x] Criar uma rota interna protegida por `CRON_SECRET` para executar as rotinas agendadas.
- [x] Configurar o cron da Vercel para chamar a rota a cada minuto.
- [x] Manter as rotinas existentes idempotentes e protegidas contra chamadas concorrentes.
- [ ] Criar monitoramento de falha e alerta para execucoes do cron.
- [ ] Evoluir o processamento de `print_jobs` para worker persistente quando houver volume real de impressao.
- [ ] Registrar inicio, fim, duracao e resultado de cada execucao em uma tabela de observabilidade.

## Prioridade 2 - Autenticacao completa

**Objetivo:** permitir recuperacao segura de senha e revogar sessoes imediatamente, sem depender da expiracao do cookie.

### Entregas

- [x] Registrar sessoes da aplicacao no Supabase com hash do token CSRF.
- [x] Validar a sessao no servidor em cada requisicao autenticada.
- [x] Revogar a sessao no logout.
- [x] Revogar as sessoes existentes depois de troca ou recuperacao de senha.
- [x] Criar endpoint de solicitacao de recuperacao de senha usando o Supabase Auth.
- [x] Criar endpoint de troca de senha usando o token temporario de recuperacao.
- [x] Adicionar a interface de recuperacao de senha no login.
- [x] Aplicar senha forte com minimo de 12 caracteres no fluxo de recuperacao.
- [ ] Ativar Leaked Password Protection no painel do Supabase.
- [ ] Configurar e validar SMTP de producao e os redirects de recuperacao.
- [ ] Adicionar MFA para perfis administrativos em uma etapa posterior.

## Prioridade 3 - Confiabilidade da API

- [ ] Aplicar idempotencia a todas as mutacoes digitais, nao somente ao totem.
- [ ] Padronizar codigos HTTP e mensagens de erro.
- [ ] Rejeitar JSON invalido com resposta `400`, em vez de tratar o corpo como vazio.
- [ ] Adicionar constraints e invariantes restantes no schema legado.

## Prioridade 4 - Gestor e regras de negocio

- [ ] Completar CRUD granular de setores e permissoes.
- [ ] Impedir fechamento de setor com fila ativa ou exigir estrategia explicita.
- [ ] Validar prioridade com regra operacional e auditoria.
- [ ] Expandir o ICCF com filtros, periodo e exportacao.

## Prioridade 5 - Observabilidade e qualidade

- [ ] Adicionar `request ID`, logs estruturados, metricas e alertas.
- [ ] Criar testes E2E autenticados para PWA em Safari/iPhone e Android.
- [ ] Executar teste de concorrencia contra Supabase.
- [ ] Testar o agente com impressora desconectada e retomada da fila.
- [ ] Executar auditoria de acessibilidade.
- [ ] Reduzir a duplicacao entre os backends SQLite e Supabase.

## Variaveis novas

Cadastre no ambiente local e na Vercel:

```text
CRON_SECRET=segredo-longo-e-exclusivo-para-o-cron
```

O valor nunca deve ser colocado no Git ou exposto no frontend. A migration `20260805131014_auth_session_revocation.sql` precisa ser executada no Supabase antes de publicar o fluxo de sessoes revogaveis.

