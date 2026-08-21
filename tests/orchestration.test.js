const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

const PORT = 3199;
const BASE_URL = `http://localhost:${PORT}`;
const TEST_DOMAIN = "example.invalid";
const testCredentials = createTestCredentials();
const printAgentToken = crypto.randomBytes(48).toString("base64url");
const cronSecret = crypto.randomBytes(48).toString("base64url");

let server;
let dataDir;
let adminCookie = "";

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "senhahub-test-"));
  server = spawn(process.execPath, ["--no-warnings", "server/server.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: dataDir,
      API_ONLY: "1",
      DATA_BACKEND: "sqlite",
      LOCAL_POSTGRES_APP_ENABLED: "0",
      LOCAL_POSTGRES_ROUTES_ENABLED: "0",
      SUPABASE_AUTH_ENABLED: "0",
      PRESENCE_CHECK_ENABLED: "0",
      DEMO_USERS_JSON: JSON.stringify(testCredentials.seedUsers),
      AUTH_SECRET: crypto.randomBytes(32).toString("hex"),
      PRINT_AGENT_TOKEN: printAgentToken,
      KIOSK_ID: "totem-pompeia-01",
      CRON_SECRET: cronSecret
    },
    stdio: "ignore"
  });
  await waitForServer();
  adminCookie = await login(testCredentials.manager.email, testCredentials.manager.password);
});

test("bloqueia paginas sensiveis, HTML legado e status do totem sem acesso", async () => {
  const protectedPaths = ["/", "/attendant", "/admin", "/admin/totens/", "/iccf", "/totem"];
  for (const pathname of protectedPaths) {
    const response = await fetch(`${BASE_URL}${pathname}`, { redirect: "manual" });
    assert.equal(response.status, 302, pathname);
    assert.match(response.headers.get("location") || "", /\/login\?next=/, pathname);
  }

  const legacy = await fetch(`${BASE_URL}/admin-totens.html`, { redirect: "manual" });
  assert.equal(legacy.status, 302);
  assert.equal(legacy.headers.get("location"), "/admin/totens");

  const kioskStatus = await fetch(`${BASE_URL}/api/kiosk/status`);
  assert.equal(kioskStatus.status, 401);
});

test.after(async () => {
  server?.kill();
  await new Promise((resolve) => server?.once("exit", resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("orquestra espera inteligente e libera uma senha por vez", async () => {
  const { cookie, identity } = await createCustomer("cliente-teste");
  await api("/api/sessions", { method: "POST", cookie, body: identity });

  const first = await api("/api/tickets", { method: "POST", cookie, body: { ...identity, sectorId: "acougue" } });
  assert.equal(first.ticket.ticket, "A000");
  const calledFirst = await api("/api/sectors/acougue/call-next", { method: "POST", cookie: adminCookie });
  assert.equal(calledFirst.ticket.ticket, first.ticket.ticket);

  await api(`/api/tickets/${first.ticket.id}/confirm`, { method: "POST", cookie, body: identity });
  const second = await api("/api/tickets", { method: "POST", cookie, body: { ...identity, sectorId: "frios" } });
  assert.ok(second.ticket.ticket.startsWith("F"));

  await api("/api/sectors/frios/call-next", { method: "POST", cookie: adminCookie });
  let state = await api(`/api/state?customer_id=${identity.customerId}`, { cookie });
  assert.equal(state.tickets.find((ticket) => ticket.sectorId === "frios").status, "espera_inteligente");

  await api(`/api/tickets/${first.ticket.id}/finish`, { method: "POST", cookie, body: identity });
  state = await api(`/api/state?customer_id=${identity.customerId}`, { cookie });
  assert.equal(state.tickets.find((ticket) => ticket.sectorId === "frios").status, "chamado");
});

test("permite chamadas em setores com outras senhas ja chamadas", async () => {
  resetSectorTickets("acougue");
  resetSectorTickets("frios");
  try {
    const firstCustomer = await createCustomer("espera-setor-ocupado-a");
    const secondCustomer = await createCustomer("espera-setor-ocupado-b");

    const firstService = await api("/api/tickets", {
      method: "POST",
      cookie: firstCustomer.cookie,
      body: { ...firstCustomer.identity, sectorId: "acougue" }
    });
    await api("/api/sectors/acougue/call-next", { method: "POST", cookie: adminCookie });
    await api(`/api/tickets/${firstService.ticket.id}/confirm`, { method: "POST", cookie: adminCookie });

    const smartWait = await api("/api/tickets", {
      method: "POST",
      cookie: firstCustomer.cookie,
      body: { ...firstCustomer.identity, sectorId: "frios" }
    });
    await api("/api/sectors/frios/call-next", { method: "POST", cookie: adminCookie });

    const other = await api("/api/tickets", {
      method: "POST",
      cookie: secondCustomer.cookie,
      body: { ...secondCustomer.identity, sectorId: "frios" }
    });
    await api("/api/sectors/frios/call-next", { method: "POST", cookie: adminCookie });
    await api(`/api/tickets/${firstService.ticket.id}/finish`, { method: "POST", cookie: adminCookie });

    const staff = await api("/api/staff/state", { cookie: adminCookie });
    const frios = staff.sectors.find((sector) => sector.id === "frios");
    const activeCalls = frios.tickets.filter((ticket) => ["chamado", "em_atendimento"].includes(ticket.status));
    assert.equal(activeCalls.length, 2);
    assert.ok(activeCalls.some((ticket) => ticket.id === other.ticket.id));

    const customerState = await api(`/api/state?customer_id=${firstCustomer.identity.customerId}`, { cookie: firstCustomer.cookie });
    assert.equal(customerState.tickets.find((ticket) => ticket.id === smartWait.ticket.id).status, "chamado");
  } finally {
    resetSectorTickets("acougue");
    resetSectorTickets("frios");
  }
});

test("responde 401 para mutacao anonima em vez de manter a conexao aberta", async () => {
  const response = await fetch(`${BASE_URL}/api/tickets/inexistente/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(1500)
  });
  const payload = await response.json();
  assert.equal(response.status, 401);
  assert.match(payload.error, /autenticacao/i);
});

test("migration restringe papeis e funcoes privilegiadas do Supabase", () => {
  const migration = fs.readFileSync(path.resolve(__dirname, "../supabase/migrations/0001_initial_schema.sql"), "utf8");
  assert.match(migration, /revoke update on table public\.profiles from anon, authenticated/i);
  assert.match(migration, /grant update \(name\) on table public\.profiles to authenticated/i);
  assert.match(migration, /revoke execute on function public\.issue_ticket[\s\S]*from PUBLIC, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.confirm_ticket\(uuid\) to service_role/i);
  assert.match(migration, /grant execute on function public\.issue_verified_ticket[\s\S]*to service_role/i);
  assert.match(migration, /create unique index if not exists uq_tickets_active_call_customer/i);
  assert.match(migration, /create or replace function public\.call_next_ticket[\s\S]*security invoker/i);
  assert.match(migration, /insert into public\.sectors[\s\S]*on conflict \(id\) do nothing/i);
  assert.doesNotMatch(migration, /on conflict \(id\) do update set[\s\S]*queue_size = excluded\.queue_size/i);
});

test("migration do totem protege fila de impressao e funcoes do agente", () => {
  const migration = fs.readFileSync(
    path.resolve(__dirname, "../supabase/migrations/20260729154028_print_kiosk_jobs.sql"),
    "utf8"
  );
  assert.match(migration, /alter table public\.print_jobs enable row level security/i);
  assert.match(migration, /revoke all on table public\.print_jobs from PUBLIC, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.issue_physical_ticket[\s\S]*to service_role/i);
  assert.match(migration, /create or replace function public\.claim_next_print_job[\s\S]*for update skip locked/i);
  assert.match(migration, /idempotency_key text not null unique/i);
  assert.match(migration, /alter table public\.services alter column customer_id drop not null/i);
});

test("migration fixa o totem fisico na Loja 2", () => {
  const migration = fs.readFileSync(
    path.resolve(__dirname, "../supabase/migrations/20260821121101_kiosk_store_2.sql"),
    "utf8"
  );
  assert.match(migration, /update public\.print_kiosks/i);
  assert.match(migration, /where id = 'totem-pompeia-01'/i);
  assert.match(migration, /store_code = 'loja-2'/i);
});

test("emissao digital ignora configuracao antiga de QR e nao exige presenca", async () => {
  const port = 3400 + Math.floor(Math.random() * 300);
  const baseUrl = `http://127.0.0.1:${port}`;
  const isolatedDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "senhahub-presence-"));
  const email = `presence-${crypto.randomUUID()}@${TEST_DOMAIN}`;
  const password = strongPassword();
  const presenceServer = spawn(process.execPath, ["--no-warnings", "server/server.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: isolatedDataDir,
      API_ONLY: "1",
      DATA_BACKEND: "sqlite",
      LOCAL_POSTGRES_APP_ENABLED: "0",
      LOCAL_POSTGRES_ROUTES_ENABLED: "0",
      SUPABASE_AUTH_ENABLED: "0",
      PRESENCE_CHECK_ENABLED: "1",
      DEMO_USERS_JSON: JSON.stringify([{ name: "Cliente Presenca", email, password, role: "customer", sectorIds: [] }]),
      AUTH_SECRET: crypto.randomBytes(32).toString("hex"),
      QR_TOKEN_ACOUGUE: crypto.randomBytes(24).toString("base64url"),
      QR_TOKEN_FRIOS: crypto.randomBytes(24).toString("base64url"),
      QR_TOKEN_PADARIA: crypto.randomBytes(24).toString("base64url")
    },
    stdio: "ignore"
  });

  try {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const response = await fetch(`${baseUrl}/api/config`);
        if (response.ok) {
          assert.equal((await response.json()).presenceCheckEnabled, false);
          break;
        }
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (attempt === 99) throw new Error("Servidor de presenca nao iniciou.");
    }

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    assert.equal(loginResponse.status, 200);
    const setCookie = loginResponse.headers.get("set-cookie") || "";
    const cookie = `${setCookie.match(/senhahub_auth=[^;,]+/)?.[0]}; ${setCookie.match(/senhahub_csrf=[^;,]+/)?.[0]}`;
    const csrf = csrfHeader(cookie);

    const ticketResponse = await fetch(`${baseUrl}/api/tickets`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, ...csrf },
      body: JSON.stringify({ sectorId: "acougue", deviceId: `presence-${crypto.randomUUID()}` })
    });
    const payload = await ticketResponse.json();
    assert.equal(ticketResponse.status, 201);
    assert.equal(payload.ticket.qrVerified, false);
    assert.equal(payload.ticket.locationVerified, false);
  } finally {
    presenceServer.kill();
    if (presenceServer.exitCode === null) await new Promise((resolve) => presenceServer.once("exit", resolve));
    fs.rmSync(isolatedDataDir, { recursive: true, force: true });
  }
});

test("duas emissoes paralelas no mesmo setor retornam a mesma senha", async () => {
  resetSectorTickets("padaria");
  try {
    const customer = await createCustomer("emissao-paralela");
    const request = () => api("/api/tickets", {
      method: "POST",
      cookie: customer.cookie,
      body: { ...customer.identity, sectorId: "padaria" }
    });
    const [first, second] = await Promise.all([request(), request()]);
    assert.equal(first.ticket.id, second.ticket.id);
  } finally {
    resetSectorTickets("padaria");
  }
});

test("duas chamadas paralelas registram duas senhas distintas sem duplicar uma senha", async () => {
  resetSectorTickets("acougue");
  try {
    const firstCustomer = await createCustomer("chamada-paralela-a");
    const secondCustomer = await createCustomer("chamada-paralela-b");
    const first = await api("/api/tickets", { method: "POST", cookie: firstCustomer.cookie, body: { ...firstCustomer.identity, sectorId: "acougue" } });
    const second = await api("/api/tickets", { method: "POST", cookie: secondCustomer.cookie, body: { ...secondCustomer.identity, sectorId: "acougue" } });

    const call = () => fetch(`${BASE_URL}/api/sectors/acougue/call-next`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie, ...csrfHeader(adminCookie) }
    });
    const responses = await Promise.all([call(), call()]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 200]);

    const staff = await api("/api/staff/state", { cookie: adminCookie });
    const sector = staff.sectors.find((item) => item.id === "acougue");
    const calledTestTickets = sector.tickets.filter((ticket) => [first.ticket.id, second.ticket.id].includes(ticket.id));
    assert.equal(calledTestTickets.length, 2);
    assert.ok(calledTestTickets.every((ticket) => ["chamado", "em_atendimento"].includes(ticket.status)));
    const testCalls = sector.recentCalls.filter((call) => [first.ticket.ticket, second.ticket.ticket].includes(call.ticket));
    assert.equal(new Set(testCalls.map((call) => call.ticket)).size, 2);
  } finally {
    resetSectorTickets("acougue");
  }
});

test("permite senha sem presenca durante testes controlados", async () => {
  const { cookie, identity } = await createCustomer("sem-presenca");
  const result = await api("/api/tickets", {
    method: "POST",
    cookie,
    body: { ...identity, sectorId: "padaria" }
  });
  assert.equal(result.ticket.sectorId, "padaria");
  assert.equal(result.ticket.locationVerified, false);
  assert.equal(result.ticket.qrVerified, false);
});

test("bloqueia acoes autenticadas sem token CSRF", async () => {
  const { cookie, identity } = await createCustomer("sem-csrf");
  const response = await fetch(`${BASE_URL}/api/cart/items`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie
    },
    body: JSON.stringify({
      ...identity,
      productId: "picanha",
      productName: "Picanha Bovina",
      sectorName: "Acougue",
      price: "R$ 59,90"
    })
  });
  const payload = await response.json();
  assert.equal(response.status, 403);
  assert.match(payload.error, /seguranca/i);
});

test("bloqueia login apos muitas tentativas invalidas", async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: testCredentials.lockedCustomer.email, password: crypto.randomUUID() })
    });
    assert.equal(response.status, 401);
  }

  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: testCredentials.lockedCustomer.email, password: testCredentials.lockedCustomer.password })
  });
  const payload = await response.json();
  assert.equal(response.status, 401);
  assert.match(payload.error, /Muitas tentativas/i);
});

test("rota interna de jobs exige o segredo do cron", async () => {
  const unauthorized = await fetch(`${BASE_URL}/api/internal/jobs`);
  assert.equal(unauthorized.status, 401);

  const authorized = await fetch(`${BASE_URL}/api/internal/jobs`, {
    headers: {
      authorization: `Bearer ${cronSecret}`,
      "x-request-id": "observability-cron-test"
    }
  });
  assert.equal(authorized.status, 200);
  assert.equal(authorized.headers.get("x-request-id"), "observability-cron-test");
  const payload = await authorized.json();
  assert.equal(payload.ok, true);

  const observabilityResponse = await fetch(`${BASE_URL}/api/observability`, { headers: { cookie: adminCookie } });
  assert.equal(observabilityResponse.status, 200);
  const observability = await observabilityResponse.json();
  assert.ok(observability.cron.executionsLast24h >= 1);
  assert.equal(observability.cron.latest.status, "succeeded");
  assert.equal(typeof observability.printing.pendingJobs, "number");
});

test("logout revoga a sessao imediatamente", async () => {
  const { cookie } = await createCustomer("logout-revoga-sessao");
  await api("/api/auth/logout", { method: "POST", cookie });

  const response = await fetch(`${BASE_URL}/api/auth/me`, { headers: { cookie } });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.user, null);
});

test("atendente consegue sair e o runtime Supabase aceita todos os perfis autenticados", async () => {
  const cookie = await createStaffUser("logout-atendente", "attendant", ["acougue"]);
  await api("/api/auth/logout", { method: "POST", cookie });

  const response = await fetch(`${BASE_URL}/api/auth/me`, { headers: { cookie } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user, null);

  const runtime = fs.readFileSync(path.resolve(__dirname, "../server/supabase-runtime.js"), "utf8");
  const logoutStart = runtime.indexOf("async function logout(request)");
  const meStart = runtime.indexOf("async function me(request)");
  assert.ok(logoutStart >= 0 && meStart > logoutStart);
  assert.match(runtime.slice(logoutStart, meStart), /requireUser\(request, AUTHENTICATED_ROLES\)/);
});

test("permite alterar senha informando senha atual", async () => {
  const email = `troca-senha-${crypto.randomUUID()}@${TEST_DOMAIN}`;
  const password = strongPassword();
  const nextPassword = strongPassword();
  await api("/api/users", {
    method: "POST",
    cookie: adminCookie,
    body: { name: "troca senha", email, password, role: "customer", sectorIds: [] }
  });

  const changed = await api("/api/auth/change-password", {
    method: "POST",
    body: { email, currentPassword: password, newPassword: nextPassword }
  });
  assert.equal(changed.ok, true);
  await login(email, nextPassword);
});

test("cadastro publico cria apenas conta de cliente", async () => {
  const email = `cadastro-publico-${crypto.randomUUID()}@${TEST_DOMAIN}`;
  const password = strongPassword();
  const created = await api("/api/auth/register", {
    method: "POST",
    body: { name: "Cadastro Publico", email, password, role: "manager", sectorIds: ["acougue"] }
  });

  assert.equal(created.user.role, "customer");
  assert.deepEqual(created.user.sectorIds, []);
  await login(email, password);
});

test("totem emite senha fisica na fila unica e conclui a impressao sem duplicar", async () => {
  resetSectorTickets("frios");
  const pairResponse = await fetch(`${BASE_URL}/api/kiosk/pair`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: adminCookie,
      ...csrfHeader(adminCookie)
    },
    body: JSON.stringify({ kioskId: "totem-pompeia-01" })
  });
  assert.equal(pairResponse.status, 200);
  const setCookie = pairResponse.headers.get("set-cookie") || "";
  const kioskAuth = setCookie.match(/senhahub_kiosk=[^;,]+/)?.[0];
  const kioskCsrf = setCookie.match(/senhahub_kiosk_csrf=[^;,]+/)?.[0];
  assert.ok(kioskAuth);
  assert.ok(kioskCsrf);
  const kioskCookie = `${kioskAuth}; ${kioskCsrf}`;
  const kioskCsrfToken = kioskCsrf.slice("senhahub_kiosk_csrf=".length);
  const idempotencyKey = crypto.randomUUID();

  const issue = () => fetch(`${BASE_URL}/api/kiosk/tickets`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: kioskCookie,
      "x-kiosk-csrf": kioskCsrfToken
    },
    body: JSON.stringify({ sectorId: "frios", idempotencyKey, priority: true, priorityReason: "tea" })
  });
  const firstResponse = await issue();
  const first = await firstResponse.json();
  assert.equal(firstResponse.status, 201);
  assert.equal(first.ticket.source, "physical");
  assert.equal(first.ticket.sectorId, "frios");
  assert.equal(first.ticket.priority, true);
  assert.equal(first.ticket.priorityReason, "tea");
  assert.equal(first.printJob.status, "pending");
  assert.equal(first.printJob.payload.paperWidthMm, 80);
  assert.equal(first.printJob.payload.installUrl, "https://senhahub.vercel.app/instalar");
  assert.match(first.printJob.payload.trackUrl, /\/acompanhar\/[A-Za-z0-9_-]+$/);

  const trackingToken = new URL(first.printJob.payload.trackUrl).pathname.split("/").pop();
  const trackingResponse = await fetch(`${BASE_URL}/api/tickets/track/${trackingToken}`);
  const tracking = await trackingResponse.json();
  assert.equal(trackingResponse.status, 200);
  assert.equal(tracking.ticket.ticket, first.ticket.ticket);
  assert.ok("current" in tracking.ticket);
  assert.equal(typeof tracking.ticket.secondsToCall, "number");
  assert.ok(tracking.ticket.estimatedCallAt);
  assert.equal(tracking.ticket.priority, true);
  assert.equal(Object.hasOwn(tracking.ticket, "priorityReason"), false);

  const duplicateResponse = await issue();
  const duplicate = await duplicateResponse.json();
  assert.equal(duplicateResponse.status, 201);
  assert.equal(duplicate.ticket.id, first.ticket.id);
  assert.equal(duplicate.printJob.id, first.printJob.id);
  assert.equal(duplicate.alreadyExists, true);

  const staff = await api("/api/staff/state", { cookie: adminCookie });
  const sector = staff.sectors.find((item) => item.id === "frios");
  assert.ok(sector.tickets.some((ticket) => ticket.id === first.ticket.id));

  const unauthorizedClaim = await fetch(`${BASE_URL}/api/print/jobs/claim`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-print-agent-token": "invalid" },
    body: JSON.stringify({ kioskId: "totem-pompeia-01" })
  });
  assert.equal(unauthorizedClaim.status, 401);

  const claimResponse = await fetch(`${BASE_URL}/api/print/jobs/claim`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-print-agent-token": printAgentToken,
      "x-print-agent-kiosk-id": "totem-pompeia-01"
    },
    body: JSON.stringify({ kioskId: "totem-pompeia-01" })
  });
  const claimed = await claimResponse.json();
  assert.equal(claimResponse.status, 200);
  assert.equal(claimed.job.id, first.printJob.id);
  assert.equal(claimed.job.status, "printing");

  const finishResponse = await fetch(`${BASE_URL}/api/print/jobs/${encodeURIComponent(claimed.job.id)}/finish`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-print-agent-token": printAgentToken,
      "x-print-agent-kiosk-id": "totem-pompeia-01"
    },
    body: JSON.stringify({ kioskId: "totem-pompeia-01", success: true })
  });
  const finished = await finishResponse.json();
  assert.equal(finishResponse.status, 200);
  assert.equal(finished.job.status, "printed");

  const observabilityResponse = await fetch(`${BASE_URL}/api/observability`, { headers: { cookie: adminCookie } });
  const observability = await observabilityResponse.json();
  assert.equal(observabilityResponse.status, 200);
  assert.ok(observability.printing.completedAttempts >= 1);
  assert.ok(observability.printing.averageDurationMs >= 0);

  const statusResponse = await fetch(`${BASE_URL}/api/kiosk/print-jobs/${encodeURIComponent(claimed.job.id)}`, {
    headers: { cookie: kioskCookie }
  });
  const status = await statusResponse.json();
  assert.equal(statusResponse.status, 200);
  assert.equal(status.job.status, "printed");

  const unpairResponse = await fetch(`${BASE_URL}/api/kiosk/unpair`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: adminCookie, ...csrfHeader(adminCookie) },
    body: "{}"
  });
  assert.equal(unpairResponse.status, 200);
  const revokedStatus = await fetch(`${BASE_URL}/api/kiosk/print-jobs/${encodeURIComponent(claimed.job.id)}`, {
    headers: { cookie: kioskCookie }
  });
  assert.equal(revokedStatus.status, 404);

  const called = await api("/api/sectors/frios/call-next", { method: "POST", cookie: adminCookie });
  assert.equal(called.ticket.id, first.ticket.id);
  const confirmed = await api(`/api/tickets/${first.ticket.id}/confirm`, { method: "POST", cookie: adminCookie });
  assert.equal(confirmed.ticket.status, "em_atendimento");
  const completed = await api(`/api/tickets/${first.ticket.id}/finish`, { method: "POST", cookie: adminCookie });
  assert.equal(completed.finishedTicket.status, "atendido");
});

test("totem agrupa duas senhas no mesmo trabalho de impressao", async () => {
  resetSectorTickets("acougue");
  resetSectorTickets("frios");
  const pairResponse = await fetch(`${BASE_URL}/api/kiosk/pair`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: adminCookie, ...csrfHeader(adminCookie) },
    body: JSON.stringify({ kioskId: "totem-pompeia-01" })
  });
  assert.equal(pairResponse.status, 200);
  const setCookie = pairResponse.headers.get("set-cookie") || "";
  const kioskAuth = setCookie.match(/senhahub_kiosk=[^;,]+/)?.[0];
  const kioskCsrf = setCookie.match(/senhahub_kiosk_csrf=[^;,]+/)?.[0];
  assert.ok(kioskAuth && kioskCsrf);
  const kioskCookie = `${kioskAuth}; ${kioskCsrf}`;
  const kioskCsrfToken = kioskCsrf.slice("senhahub_kiosk_csrf=".length);
  const idempotencyKey = crypto.randomUUID();

  const issueResponse = await fetch(`${BASE_URL}/api/kiosk/tickets`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: kioskCookie,
      "x-kiosk-csrf": kioskCsrfToken
    },
    body: JSON.stringify({
      sectorIds: ["acougue", "frios"],
      idempotencyKey,
      priority: false
    })
  });
  const issued = await issueResponse.json();
  assert.equal(issueResponse.status, 201);
  assert.equal(issued.tickets.length, 2);
  assert.equal(issued.printJob.payload.tickets.length, 2);
  assert.equal(issued.printJob.payload.ticketIds.length, 2);
  assert.match(issued.printJob.payload.trackUrl, /\/acompanhar\/[A-Za-z0-9_-]+$/);
  const trackingToken = new URL(issued.printJob.payload.trackUrl).pathname.split("/").pop();
  const trackingResponse = await fetch(`${BASE_URL}/api/tickets/track/${trackingToken}`);
  const tracked = await trackingResponse.json();
  assert.equal(trackingResponse.status, 200);
  assert.equal(tracked.tickets.length, 2);
  assert.deepEqual(tracked.tickets.map((ticket) => ticket.sector).sort(), ["Açougue", "Frios e Laticínios"].sort());

  const duplicateResponse = await fetch(`${BASE_URL}/api/kiosk/tickets`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: kioskCookie,
      "x-kiosk-csrf": kioskCsrfToken
    },
    body: JSON.stringify({ sectorIds: ["acougue", "frios"], idempotencyKey, priority: false })
  });
  const duplicate = await duplicateResponse.json();
  assert.equal(duplicateResponse.status, 201);
  assert.equal(duplicate.alreadyExists, true);
  assert.equal(duplicate.tickets.length, 2);
  assert.equal(duplicate.printJob.id, issued.printJob.id);

  const claimResponse = await fetch(`${BASE_URL}/api/print/jobs/claim`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-print-agent-token": printAgentToken,
      "x-print-agent-kiosk-id": "totem-pompeia-01"
    },
    body: JSON.stringify({ kioskId: "totem-pompeia-01" })
  });
  const claimed = await claimResponse.json();
  assert.equal(claimResponse.status, 200);
  assert.equal(claimed.job.id, issued.printJob.id);
  assert.equal(claimed.job.payload.tickets.length, 2);

  const finishResponse = await fetch(`${BASE_URL}/api/print/jobs/${encodeURIComponent(claimed.job.id)}/finish`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-print-agent-token": printAgentToken,
      "x-print-agent-kiosk-id": "totem-pompeia-01"
    },
    body: JSON.stringify({ kioskId: "totem-pompeia-01", success: true })
  });
  assert.equal(finishResponse.status, 200);

  resetSectorTickets("acougue");
  resetSectorTickets("frios");
  const unpairResponse = await fetch(`${BASE_URL}/api/kiosk/unpair`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: adminCookie, ...csrfHeader(adminCookie) },
    body: "{}"
  });
  assert.equal(unpairResponse.status, 200);
});

test("mantem tempo estimado baseado na posicao real da fila", async () => {
  resetSectorTickets("padaria");
  const firstCustomer = await createCustomer("tempo-primeiro");
  const secondCustomer = await createCustomer("tempo-segundo");

  await api("/api/tickets", { method: "POST", cookie: firstCustomer.cookie, body: { ...firstCustomer.identity, sectorId: "padaria" } });
  const second = await api("/api/tickets", { method: "POST", cookie: secondCustomer.cookie, body: { ...secondCustomer.identity, sectorId: "padaria" } });
  assert.equal(second.ticket.position, 2);
  assert.ok(second.ticket.secondsToCall > 0);
  assert.ok(second.ticket.estimatedCallAt);

  await new Promise((resolve) => setTimeout(resolve, 1200));
  const state = await api(`/api/state?customer_id=${secondCustomer.identity.customerId}`, { cookie: secondCustomer.cookie });
  assert.equal(state.tickets[0].position, 2);
  assert.ok(state.tickets[0].secondsToCall <= second.ticket.secondsToCall);
  assert.ok(state.tickets[0].estimatedCallAt);
});

test("senha sem ninguem na frente aguarda a chamada explicita do atendente", async () => {
  resetSectorTickets("acougue");
  const { cookie, identity } = await createCustomer("auto-chamada");
  const created = await api("/api/tickets", { method: "POST", cookie, body: { ...identity, sectorId: "acougue" } });
  assert.equal(created.ticket.position, 1);
  assert.ok(created.ticket.secondsToCall <= 30);
  assert.ok(created.ticket.secondsToCall > 0);

  const state = await api(`/api/state?customer_id=${identity.customerId}`, { cookie });
  assert.equal(state.tickets[0].status, "aguardando");
});

test("atendente chama varias senhas em sequencia sem finalizar a anterior", async () => {
  resetSectorTickets("acougue");
  const firstCustomer = await createCustomer("fila-real-primeiro");
  const secondCustomer = await createCustomer("fila-real-segundo");

  const first = await api("/api/tickets", { method: "POST", cookie: firstCustomer.cookie, body: { ...firstCustomer.identity, sectorId: "acougue" } });
  const second = await api("/api/tickets", { method: "POST", cookie: secondCustomer.cookie, body: { ...secondCustomer.identity, sectorId: "acougue" } });
  assert.equal(second.ticket.position, 2);

  await api("/api/sectors/acougue/call-next", { method: "POST", cookie: adminCookie });
  const calledSecond = await api("/api/sectors/acougue/call-next", { method: "POST", cookie: adminCookie });
  assert.equal(calledSecond.ticket.ticket, second.ticket.ticket);

  const secondState = await api(`/api/state?customer_id=${secondCustomer.identity.customerId}`, { cookie: secondCustomer.cookie });
  assert.equal(secondState.tickets[0].status, "chamado");
});

test("atendente nao opera senha fora do setor permitido", async () => {
  resetSectorTickets("acougue");
  const attendantCookie = await createStaffUser("atendente-padaria", "attendant", ["padaria"]);
  const customer = await createCustomer("setor-restrito");
  const created = await api("/api/tickets", {
    method: "POST",
    cookie: customer.cookie,
    body: { ...customer.identity, sectorId: "acougue" }
  });

  await api("/api/sectors/acougue/call-next", { method: "POST", cookie: adminCookie });
  const blocked = await api(`/api/tickets/${created.ticket.id}/confirm`, { method: "POST", cookie: attendantCookie, ok: false });
  assert.match(blocked.error, /Acesso negado|Autentica/i);
});

test("senha em atendimento nao entra em standby automatico", async () => {
  resetSectorTickets("padaria");
  const customer = await createCustomer("atendimento-nao-expira");
  const created = await api("/api/tickets", {
    method: "POST",
    cookie: customer.cookie,
    body: { ...customer.identity, sectorId: "padaria" }
  });

  await api("/api/sectors/padaria/call-next", { method: "POST", cookie: adminCookie });
  await api(`/api/tickets/${created.ticket.id}/confirm`, { method: "POST", cookie: adminCookie });
  forceTicketCalledAt(created.ticket.id, new Date(Date.now() - 11 * 60 * 1000).toISOString());

  const state = await api(`/api/state?customer_id=${customer.identity.customerId}`, { cookie: customer.cookie });
  assert.equal(state.tickets[0].status, "em_atendimento");
});

test("fila preferencial e chamada antes da fila comum", async () => {
  resetSectorTickets("frios");
  const commonCustomer = await createCustomer("fila-comum");
  const priorityCustomer = await createCustomer("fila-preferencial");

  await api("/api/tickets", { method: "POST", cookie: commonCustomer.cookie, body: { ...commonCustomer.identity, sectorId: "frios" } });
  const priority = await api("/api/tickets", {
    method: "POST",
    cookie: priorityCustomer.cookie,
    body: {
      ...priorityCustomer.identity,
      sectorId: "frios",
      priority: true,
      priorityReason: "idoso_60_mais"
    }
  });

  assert.equal(priority.ticket.priority, true);
  assert.equal(priority.ticket.position, 1);

  const called = await api("/api/sectors/frios/call-next", { method: "POST", cookie: adminCookie });
  assert.equal(called.ticket.ticket, priority.ticket.ticket);
});

test("fila segue duas preferenciais e uma comum, preservando a ordem de chegada", async () => {
  resetSectorTickets("frios");
  const firstCommonCustomer = await createCustomer("ciclo-comum-1");
  const firstPriorityCustomer = await createCustomer("ciclo-preferencial-1");
  const secondPriorityCustomer = await createCustomer("ciclo-preferencial-2");
  const secondCommonCustomer = await createCustomer("ciclo-comum-2");

  const firstCommon = await api("/api/tickets", {
    method: "POST",
    cookie: firstCommonCustomer.cookie,
    body: { ...firstCommonCustomer.identity, sectorId: "frios" }
  });
  const firstPriority = await api("/api/tickets", {
    method: "POST",
    cookie: firstPriorityCustomer.cookie,
    body: { ...firstPriorityCustomer.identity, sectorId: "frios", priority: true, priorityReason: "idoso_60_mais" }
  });
  const secondPriority = await api("/api/tickets", {
    method: "POST",
    cookie: secondPriorityCustomer.cookie,
    body: { ...secondPriorityCustomer.identity, sectorId: "frios", priority: true, priorityReason: "gestante_ou_lactante" }
  });
  const secondCommon = await api("/api/tickets", {
    method: "POST",
    cookie: secondCommonCustomer.cookie,
    body: { ...secondCommonCustomer.identity, sectorId: "frios" }
  });

  const calls = [];
  for (let index = 0; index < 4; index += 1) {
    calls.push((await api("/api/sectors/frios/call-next", { method: "POST", cookie: adminCookie })).ticket.ticket);
  }
  assert.deepEqual(calls, [firstPriority.ticket.ticket, secondPriority.ticket.ticket, firstCommon.ticket.ticket, secondCommon.ticket.ticket]);
});

test("atendente so pula senha com justificativa e registra historico", async () => {
  resetSectorTickets("padaria");
  const customer = await createCustomer("pular-com-motivo");
  const created = await api("/api/tickets", {
    method: "POST",
    cookie: customer.cookie,
    body: { ...customer.identity, sectorId: "padaria" }
  });

  const blocked = await api(`/api/tickets/${created.ticket.id}/skip`, { method: "POST", cookie: adminCookie, body: {}, ok: false });
  assert.match(blocked.error, /motivo/i);

  const skipped = await api(`/api/tickets/${created.ticket.id}/skip`, {
    method: "POST",
    cookie: adminCookie,
    body: { reason: "cliente_ausente" }
  });
  assert.equal(skipped.skippedTicket.status, "standby");

  const staff = await api("/api/staff/state", { cookie: adminCookie });
  const padaria = staff.sectors.find((sector) => sector.id === "padaria");
  assert.ok(padaria.recentCalls.some((call) => call.action === "senha_pulada:cliente_ausente"));
});

test("senha ausente entra em standby e volta apos o proximo atendimento", async () => {
  resetSectorTickets("acougue");
  const firstCustomer = await createCustomer("standby-ausente");
  const secondCustomer = await createCustomer("standby-proximo");

  const first = await api("/api/tickets", { method: "POST", cookie: firstCustomer.cookie, body: { ...firstCustomer.identity, sectorId: "acougue" } });
  const second = await api("/api/tickets", { method: "POST", cookie: secondCustomer.cookie, body: { ...secondCustomer.identity, sectorId: "acougue" } });
  await api("/api/sectors/acougue/call-next", { method: "POST", cookie: adminCookie });

  forceTicketCalledAt(first.ticket.id, new Date(Date.now() - 11 * 60 * 1000).toISOString());

  let firstState = await api(`/api/state?customer_id=${firstCustomer.identity.customerId}`, { cookie: firstCustomer.cookie });
  assert.equal(firstState.tickets[0].status, "standby");
  assert.ok(firstState.tickets[0].standbySecondsRemaining > 0);

  const calledSecond = await api("/api/sectors/acougue/call-next", { method: "POST", cookie: adminCookie });
  assert.equal(calledSecond.ticket.ticket, second.ticket.ticket);

  await api(`/api/tickets/${second.ticket.id}/confirm`, { method: "POST", cookie: adminCookie });
  const finished = await api(`/api/tickets/${second.ticket.id}/finish`, { method: "POST", cookie: adminCookie });
  assert.equal(finished.nextTicket.ticket, first.ticket.ticket);

  firstState = await api(`/api/state?customer_id=${firstCustomer.identity.customerId}`, { cookie: firstCustomer.cookie });
  assert.equal(firstState.tickets[0].status, "chamado");
});

test("cliente cancela senha ativa e libera o setor para outra senha", async () => {
  resetSectorTickets("frios");
  const { cookie, identity } = await createCustomer("cancelar-cliente");
  const created = await api("/api/tickets", { method: "POST", cookie, body: { ...identity, sectorId: "frios" } });

  const canceled = await api(`/api/tickets/${created.ticket.id}/cancel`, { method: "POST", cookie, body: identity });
  assert.equal(canceled.canceledTicket.status, "cancelado");

  const state = await api(`/api/state?customer_id=${identity.customerId}`, { cookie });
  assert.equal(state.tickets.length, 0);

  const recreated = await api("/api/tickets", { method: "POST", cookie, body: { ...identity, sectorId: "frios" } });
  assert.equal(recreated.ticket.position, 1);
});

test("contador de senha usa 000 a 999 e reinicia depois do limite", async () => {
  const database = new DatabaseSync(path.join(dataDir, "senhahub.sqlite"));
  database.prepare(`
    INSERT INTO ticket_counters (sector_id, business_date, last_number, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(sector_id) DO UPDATE SET business_date = excluded.business_date, last_number = excluded.last_number, updated_at = excluded.updated_at
  `).run("padaria", businessDateFor(), 998, new Date().toISOString());
  database.close();

  const firstCustomer = await createCustomer("limite-999-a");
  const secondCustomer = await createCustomer("limite-999-b");
  const first = await api("/api/tickets", {
    method: "POST",
    cookie: firstCustomer.cookie,
    body: { ...firstCustomer.identity, sectorId: "padaria" }
  });
  const second = await api("/api/tickets", {
    method: "POST",
    cookie: secondCustomer.cookie,
    body: { ...secondCustomer.identity, sectorId: "padaria" }
  });

  assert.equal(first.ticket.ticket, "P999");
  assert.equal(second.ticket.ticket, "P000");
});

async function login(email, password) {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  assert.ok(response.ok, response.statusText);
  const setCookie = response.headers.get("set-cookie") || "";
  const auth = setCookie.match(/senhahub_auth=[^;,]+/)?.[0];
  const csrf = setCookie.match(/senhahub_csrf=[^;,]+/)?.[0];
  assert.ok(auth, "Cookie de autenticacao ausente.");
  assert.ok(csrf, "Cookie CSRF ausente.");
  return `${auth}; ${csrf}`;
}

async function createCustomer(slug) {
  const email = `${slug}-${crypto.randomUUID()}@${TEST_DOMAIN}`;
  const password = strongPassword();
  const result = await api("/api/users", {
    method: "POST",
    cookie: adminCookie,
    body: { name: slug, email, password, role: "customer", sectorIds: [] }
  });
  const cookie = await login(email, password);
  return {
    cookie,
    identity: { customerId: result.user.customerId, deviceId: `device-${slug}` }
  };
}

async function createStaffUser(slug, role, sectorIds) {
  const email = `${slug}-${crypto.randomUUID()}@${TEST_DOMAIN}`;
  const password = strongPassword();
  await api("/api/users", {
    method: "POST",
    cookie: adminCookie,
    body: { name: slug, email, password, role, sectorIds }
  });
  return login(email, password);
}

function createTestCredentials() {
  const password = () => strongPassword();
  const manager = {
    name: "Gestor Teste",
    email: `manager-${crypto.randomUUID()}@${TEST_DOMAIN}`,
    password: password(),
    role: "manager",
    sectorIds: []
  };
  const lockedCustomer = {
    name: "Cliente Bloqueio",
    email: `customer-${crypto.randomUUID()}@${TEST_DOMAIN}`,
    password: password(),
    role: "customer",
    sectorIds: []
  };
  return {
    manager,
    lockedCustomer,
    seedUsers: [manager, lockedCustomer]
  };
}

function strongPassword() {
  return `Aa1-${crypto.randomBytes(18).toString("base64url")}`;
}

function resetSectorTickets(sectorId) {
  const database = new DatabaseSync(path.join(dataDir, "senhahub.sqlite"));
  database.prepare(`
    UPDATE tickets
    SET status = 'expirado', expired_at = ?, updated_at = ?
    WHERE sector_id = ? AND status IN ('aguardando', 'proximo', 'chamado', 'em_atendimento', 'espera_inteligente', 'standby')
  `).run(new Date().toISOString(), new Date().toISOString(), sectorId);
  database.prepare("UPDATE ticket_counters SET preferential_streak = 0 WHERE sector_id = ?").run(sectorId);
  database.close();
}

function forceTicketCalledAt(ticketId, calledAt) {
  const database = new DatabaseSync(path.join(dataDir, "senhahub.sqlite"));
  database.prepare("UPDATE tickets SET called_at = ? WHERE id = ?").run(calledAt, ticketId);
  database.close();
}

async function api(pathname, options = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method: options.method || "GET",
    headers: {
      "content-type": "application/json",
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...csrfHeader(options.cookie)
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json();
  if (options.ok === false) return payload;
  assert.ok(response.ok, payload.error || response.statusText);
  return payload;
}

function csrfHeader(cookie = "") {
  const token = String(cookie).match(/senhahub_csrf=([^;]+)/)?.[1];
  return token ? { "x-csrf-token": token } : {};
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${BASE_URL}/api/auth/me`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Servidor de teste nao iniciou.");
}

function businessDateFor(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);
  const part = (type) => parts.find((item) => item.type === type).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
