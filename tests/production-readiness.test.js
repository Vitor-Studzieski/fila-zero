const assert = require("node:assert/strict");
const test = require("node:test");

const { healthResponse, validateProductionEnvironment } = require("../server/production-readiness");

function productionEnvironment(overrides = {}) {
  return {
    NODE_ENV: "production",
    DATA_BACKEND: "supabase",
    SUPABASE_AUTH_ENABLED: "1",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_ANON_KEY: "a".repeat(40),
    SUPABASE_SERVICE_ROLE_KEY: "b".repeat(40),
    AUTH_SECRET: "c".repeat(40),
    CRON_SECRET: "d".repeat(40),
    DATABASE_URL: "postgresql://user:password@db.example.com:5432/postgres",
    PUBLIC_APP_URL: "https://senhahub.vercel.app",
    SUPABASE_AUTO_CONFIRM_CUSTOMERS: "0",
    ALLOW_DEMO_USERS: "0",
    DEMO_USERS_JSON: "[]",
    KIOSK_ID: "totem-pompeia-01",
    PRINT_AGENT_TOKEN: "e".repeat(40),
    KIOSK_PRINTER_PORT: "COM3",
    PUSH_NOTIFICATIONS_ENABLED: "0",
    ...overrides
  };
}

function localPostgresEnvironment(overrides = {}) {
  return {
    NODE_ENV: "production",
    DATA_BACKEND: "local-postgres",
    SUPABASE_AUTH_ENABLED: "0",
    LOCAL_POSTGRES_ROUTES_ENABLED: "1",
    LOCAL_POSTGRES_APP_ENABLED: "1",
    LOCAL_DATABASE_URL: "postgresql://senhahub_service:password@127.0.0.1:5432/senhahub_local_teste",
    AUTH_SECRET: "a".repeat(40),
    CRON_SECRET: "b".repeat(40),
    PUBLIC_APP_URL: "https://senhahub.example",
    ALLOW_DEMO_USERS: "0",
    DEMO_USERS_JSON: "[]",
    KIOSK_ID: "totem-pompeia-01",
    PRINT_AGENT_TOKEN: "c".repeat(40),
    KIOSK_PRINTER_PORT: "COM5",
    LOCAL_PUBLIC_REGISTRATION_ENABLED: "0",
    PUSH_NOTIFICATIONS_ENABLED: "0",
    ...overrides
  };
}

test("aprova o ambiente mínimo de produção sem expor segredos", () => {
  const result = validateProductionEnvironment(productionEnvironment());
  assert.equal(result.ok, true);
  assert.deepEqual(healthResponse(productionEnvironment()), { status: "ok", ok: true });
});

test("reprova produção quando cadastro automático ou contas demo estão ativos", () => {
  const result = validateProductionEnvironment(productionEnvironment({
    SUPABASE_AUTO_CONFIRM_CUSTOMERS: "1",
    ALLOW_DEMO_USERS: "1"
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("SUPABASE_AUTO_CONFIRM_CUSTOMERS")));
  assert.ok(result.errors.some((error) => error.includes("ALLOW_DEMO_USERS")));
});

test("exige VAPID completo quando Web Push está habilitado", () => {
  const result = validateProductionEnvironment(productionEnvironment({ PUSH_NOTIFICATIONS_ENABLED: "1" }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("NEXT_PUBLIC_VAPID_PUBLIC_KEY")));
  assert.ok(result.errors.some((error) => error.includes("VAPID_PRIVATE_KEY")));
});

test("aprova produção usando PostgreSQL local sem exigir credenciais Supabase", () => {
  const result = validateProductionEnvironment(localPostgresEnvironment());
  assert.equal(result.ok, true);
  assert.deepEqual(healthResponse(localPostgresEnvironment()), { status: "ok", ok: true });
});

test("reprova PostgreSQL local quando as rotas de produção não estão habilitadas", () => {
  const result = validateProductionEnvironment(localPostgresEnvironment({ LOCAL_POSTGRES_APP_ENABLED: "0" }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("LOCAL_POSTGRES_APP_ENABLED")));
});

test("reprova fallback legado do PostgreSQL local em produção", () => {
  const result = validateProductionEnvironment(localPostgresEnvironment({ LOCAL_POSTGRES_ALLOW_LEGACY_FALLBACK: "1" }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("LOCAL_POSTGRES_ALLOW_LEGACY_FALLBACK")));
});
