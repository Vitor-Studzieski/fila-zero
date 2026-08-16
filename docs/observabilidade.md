# Observabilidade do SenhaHub

## O que foi implementado

- Cada requisição de API recebe ou preserva um `x-request-id` e devolve o mesmo valor na resposta.
- Os runtimes SQLite e Supabase registram logs JSON com evento, método, rota, status, duração e `requestId`.
- A rota protegida `/api/internal/jobs` registra início, fim, duração, resultado e erro de cada execução do Cron.
- Falhas do Cron e falhas de impressão geram um alerta estruturado. Um webhook opcional pode encaminhá-los para um canal operacional sem contratar um serviço adicional.
- Cada tentativa de impressão registra início, fim, duração, resultado e número da tentativa. Retomadas após timeout são marcadas como `reprocessed`.
- A rota administrativa `GET /api/observability` reúne execuções do Cron e contagens de impressão pendentes, em processamento, falhas, concluídas, reprocessadas e duração média/P95.

## Configuração

Mantenha estas variáveis somente no servidor:

```env
CRON_SECRET=um-segredo-longo-e-exclusivo
OBSERVABILITY_ALERT_WEBHOOK_URL=
```

O webhook é opcional. A aplicação envia um `POST` JSON com `event`, `severity`, `requestId`, horário e detalhes sanitizados. Sem webhook, o registro continua disponível no log da Vercel ou no terminal e na rota administrativa.

## Migration do Supabase

A estrutura nova está em:

`supabase/migrations/20260816204544_observability_metrics.sql`

Ela cria as tabelas internas `cron_executions` e `print_job_attempts`, com índices, RLS habilitado e acesso apenas para `service_role`. Como o histórico remoto de migrations já estava divergente do diretório local, não aplique essa migration cegamente por cima de todas as antigas. Primeiro reconcilie o histórico e, depois, aplique somente esta migration no projeto correto.

Depois da aplicação, valide:

```sql
select to_regclass('public.cron_executions'), to_regclass('public.print_job_attempts');
select relrowsecurity
from pg_class
where oid in ('public.cron_executions'::regclass, 'public.print_job_attempts'::regclass);
```

Se a migration ainda não tiver sido aplicada, o fluxo principal continua funcionando; o runtime registra um aviso estruturado de persistência, mas não transforma a observabilidade em ponto único de falha.

## Leitura operacional

Para acompanhar a operação, entre com um usuário `manager` ou `admin` e consulte:

```http
GET /api/observability
```

Os campos principais são:

- `cron.failuresLast24h`: falhas das últimas 24 horas;
- `cron.latestFailure`: última falha registrada, com código e mensagem sanitizados;
- `printing.pendingJobs`, `printing.printingJobs` e `printing.failedJobs`: situação atual da fila;
- `printing.reprocessedJobs`: trabalhos que precisaram de nova tentativa;
- `printing.averageDurationMs` e `printing.p95DurationMs`: tempo de impressão medido nas tentativas concluídas.

Não exponha as tabelas diretamente para `anon` ou `authenticated`. O acesso deve continuar passando pela autenticação administrativa da aplicação e pelo `service_role` no backend.

## Eventos de log

Os eventos mais importantes são:

- `request.started` e `request.finished`;
- `cron.started` e `cron.finished`;
- `operational.alert` e `operational.alert_delivered`;
- `print_job.failed`;
- `observability.persistence_failed`.

Exemplo reduzido:

```json
{"timestamp":"2026-08-16T20:45:00.000Z","level":"info","event":"cron.finished","requestId":"...","jobName":"internal_jobs","status":"succeeded","durationMs":184}
```

## Verificação em produção

1. Confirme `CRON_SECRET` no ambiente Production da Vercel e no cron configurado.
2. Faça um deploy com a migration aplicada.
3. Abra a rota administrativa e confirme uma execução recente do Cron.
4. Emita uma senha no Totem, deixe o agente concluir a impressão e confirme uma tentativa com duração.
5. Simule uma falha controlada do agente e confirme `print_job.failed`, a contagem de falhas e, se configurado, o webhook.
6. Confira os logs da Vercel pelo `requestId` retornado na resposta.
