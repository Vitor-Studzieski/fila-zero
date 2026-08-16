const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createRequestContext,
  createRequestId,
  durationMs,
  summarizePrintAttempts
} = require("../server/observability");

test("preserva um request ID válido e rejeita cabeçalhos inseguros", () => {
  assert.equal(createRequestId({ "x-request-id": "req-123_abc" }), "req-123_abc");
  assert.match(createRequestId({ "x-request-id": "valor com espaco" }), /^[0-9a-f-]{36}$/);
});

test("usa x-vercel-id quando não há request ID da aplicação", () => {
  assert.equal(createRequestId({ "x-vercel-id": "gru1::deployment-abc" }), "gru1::deployment-abc");
});

test("cria contexto com rota, método e relógio de início", () => {
  const context = createRequestContext({
    method: "GET",
    path: "/api/observability",
    headers: { "x-request-id": "admin-check-1" }
  });
  assert.equal(context.requestId, "admin-check-1");
  assert.equal(context.method, "GET");
  assert.equal(context.path, "/api/observability");
  assert.ok(Number.isFinite(context.startedAt));
});

test("calcula duração e resumo das tentativas de impressão", () => {
  assert.equal(durationMs("2026-08-16T10:00:00.000Z", "2026-08-16T10:00:00.250Z"), 250);
  const summary = summarizePrintAttempts([
    { job_id: "job-1", attempt_number: 1, duration_ms: 100, status: "failed" },
    { job_id: "job-1", attempt_number: 2, duration_ms: 200, status: "printed" },
    { job_id: "job-2", attempt_number: 1, duration_ms: 300, status: "printed" },
    { job_id: "job-3", attempt_number: 1, duration_ms: null, status: "printing" }
  ]);
  assert.deepEqual(summary, {
    totalAttempts: 4,
    completedAttempts: 3,
    reprocessedJobs: 1,
    averageDurationMs: 200,
    p95DurationMs: 300
  });
});
