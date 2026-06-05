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

let server;
let dataDir;
let adminCookie = "";

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fila-zero-test-"));
  server = spawn(process.execPath, ["--no-warnings", "server/server.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: dataDir,
      API_ONLY: "1",
      SUPABASE_AUTH_ENABLED: "0",
      DEMO_USERS_JSON: JSON.stringify(testCredentials.seedUsers),
      AUTH_SECRET: crypto.randomBytes(32).toString("hex"),
      QR_TOKEN_ACOUGUE: testCredentials.qrTokens.acougue,
      QR_TOKEN_FRIOS: testCredentials.qrTokens.frios,
      QR_TOKEN_PADARIA: testCredentials.qrTokens.padaria
    },
    stdio: "ignore"
  });
  await waitForServer();
  adminCookie = await login(testCredentials.manager.email, testCredentials.manager.password);
});

test.after(async () => {
  server?.kill();
  await new Promise((resolve) => server?.once("exit", resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("orquestra espera inteligente e libera uma senha por vez", async () => {
  const { cookie, identity } = await createCustomer("cliente-teste");
  await api("/api/sessions", { method: "POST", cookie, body: identity });

  const first = await api("/api/tickets", { method: "POST", cookie, body: { ...identity, sectorId: "acougue", qrToken: qrToken("acougue") } });
  assert.equal(first.ticket.ticket, "A000");
  const calledFirst = await api("/api/sectors/acougue/call-next", { method: "POST", cookie: adminCookie });
  assert.equal(calledFirst.ticket.ticket, first.ticket.ticket);

  await api(`/api/tickets/${first.ticket.id}/confirm`, { method: "POST", cookie, body: identity });
  const second = await api("/api/tickets", { method: "POST", cookie, body: { ...identity, sectorId: "frios", qrToken: qrToken("frios") } });
  assert.ok(second.ticket.ticket.startsWith("F"));

  await api("/api/sectors/frios/call-next", { method: "POST", cookie: adminCookie });
  let state = await api(`/api/state?customer_id=${identity.customerId}`, { cookie });
  assert.equal(state.tickets.find((ticket) => ticket.sectorId === "frios").status, "espera_inteligente");

  await api(`/api/tickets/${first.ticket.id}/finish`, { method: "POST", cookie, body: identity });
  state = await api(`/api/state?customer_id=${identity.customerId}`, { cookie });
  assert.equal(state.tickets.find((ticket) => ticket.sectorId === "frios").status, "chamado");
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

test("mantem tempo estimado baseado na posicao real da fila", async () => {
  resetSectorTickets("padaria");
  const firstCustomer = await createCustomer("tempo-primeiro");
  const secondCustomer = await createCustomer("tempo-segundo");

  await api("/api/tickets", { method: "POST", cookie: firstCustomer.cookie, body: { ...firstCustomer.identity, sectorId: "padaria", qrToken: qrToken("padaria") } });
  const second = await api("/api/tickets", { method: "POST", cookie: secondCustomer.cookie, body: { ...secondCustomer.identity, sectorId: "padaria", qrToken: qrToken("padaria") } });
  assert.equal(second.ticket.position, 2);
  assert.ok(second.ticket.secondsToCall > 0);
  assert.ok(second.ticket.estimatedCallAt);

  await new Promise((resolve) => setTimeout(resolve, 1200));
  const state = await api(`/api/state?customer_id=${secondCustomer.identity.customerId}`, { cookie: secondCustomer.cookie });
  assert.equal(state.tickets[0].position, 2);
  assert.ok(state.tickets[0].secondsToCall <= second.ticket.secondsToCall);
  assert.ok(state.tickets[0].estimatedCallAt);
});

test("senha sem ninguem na frente conta 30 segundos e chama automaticamente", async () => {
  const { cookie, identity } = await createCustomer("auto-chamada");
  const created = await api("/api/tickets", { method: "POST", cookie, body: { ...identity, sectorId: "acougue", qrToken: qrToken("acougue") } });
  assert.equal(created.ticket.position, 1);
  assert.ok(created.ticket.secondsToCall <= 30);
  assert.ok(created.ticket.secondsToCall > 0);

  await new Promise((resolve) => setTimeout(resolve, 31000));
  const state = await api(`/api/state?customer_id=${identity.customerId}`, { cookie });
  assert.equal(state.tickets[0].status, "chamado");
});

test("setor chama a proxima senha somente depois de finalizar o atendimento atual", async () => {
  resetSectorTickets("acougue");
  const firstCustomer = await createCustomer("fila-real-primeiro");
  const secondCustomer = await createCustomer("fila-real-segundo");

  const first = await api("/api/tickets", { method: "POST", cookie: firstCustomer.cookie, body: { ...firstCustomer.identity, sectorId: "acougue", qrToken: qrToken("acougue") } });
  const second = await api("/api/tickets", { method: "POST", cookie: secondCustomer.cookie, body: { ...secondCustomer.identity, sectorId: "acougue", qrToken: qrToken("acougue") } });
  assert.equal(second.ticket.position, 2);

  await api("/api/sectors/acougue/call-next", { method: "POST", cookie: adminCookie });
  await api(`/api/tickets/${first.ticket.id}/confirm`, { method: "POST", cookie: adminCookie });

  const blocked = await api("/api/sectors/acougue/call-next", { method: "POST", cookie: adminCookie, ok: false });
  assert.match(blocked.error, /Finalize a senha/i);

  const finished = await api(`/api/tickets/${first.ticket.id}/finish`, { method: "POST", cookie: adminCookie });
  assert.equal(finished.nextTicket.ticket, second.ticket.ticket);

  const secondState = await api(`/api/state?customer_id=${secondCustomer.identity.customerId}`, { cookie: secondCustomer.cookie });
  assert.equal(secondState.tickets[0].status, "chamado");
});

test("fila preferencial e chamada antes da fila comum", async () => {
  resetSectorTickets("frios");
  const commonCustomer = await createCustomer("fila-comum");
  const priorityCustomer = await createCustomer("fila-preferencial");

  await api("/api/tickets", { method: "POST", cookie: commonCustomer.cookie, body: { ...commonCustomer.identity, sectorId: "frios", qrToken: qrToken("frios") } });
  const priority = await api("/api/tickets", {
    method: "POST",
    cookie: priorityCustomer.cookie,
    body: {
      ...priorityCustomer.identity,
      sectorId: "frios",
      qrToken: qrToken("frios"),
      priority: true,
      priorityReason: "idoso_60_mais"
    }
  });

  assert.equal(priority.ticket.priority, true);
  assert.equal(priority.ticket.position, 1);

  const called = await api("/api/sectors/frios/call-next", { method: "POST", cookie: adminCookie });
  assert.equal(called.ticket.ticket, priority.ticket.ticket);
});

test("cliente cancela senha ativa e libera o setor para outra senha", async () => {
  resetSectorTickets("frios");
  const { cookie, identity } = await createCustomer("cancelar-cliente");
  const created = await api("/api/tickets", { method: "POST", cookie, body: { ...identity, sectorId: "frios", qrToken: qrToken("frios") } });

  const canceled = await api(`/api/tickets/${created.ticket.id}/cancel`, { method: "POST", cookie, body: identity });
  assert.equal(canceled.canceledTicket.status, "cancelado");

  const state = await api(`/api/state?customer_id=${identity.customerId}`, { cookie });
  assert.equal(state.tickets.length, 0);

  const recreated = await api("/api/tickets", { method: "POST", cookie, body: { ...identity, sectorId: "frios", qrToken: qrToken("frios") } });
  assert.equal(recreated.ticket.position, 1);
});

test("contador de senha usa 000 a 999 e reinicia depois do limite", async () => {
  const database = new DatabaseSync(path.join(dataDir, "fila-zero.sqlite"));
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
    body: { ...firstCustomer.identity, sectorId: "padaria", qrToken: qrToken("padaria") }
  });
  const second = await api("/api/tickets", {
    method: "POST",
    cookie: secondCustomer.cookie,
    body: { ...secondCustomer.identity, sectorId: "padaria", qrToken: qrToken("padaria") }
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
  const auth = setCookie.match(/fz_auth=[^;,]+/)?.[0];
  const csrf = setCookie.match(/fz_csrf=[^;,]+/)?.[0];
  assert.ok(auth, "Cookie de autenticacao ausente.");
  assert.ok(csrf, "Cookie CSRF ausente.");
  return `${auth}; ${csrf}`;
}

async function createCustomer(slug) {
  const email = `${slug}-${crypto.randomUUID()}@${TEST_DOMAIN}`;
  const password = crypto.randomBytes(18).toString("base64url");
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

function createTestCredentials() {
  const password = () => crypto.randomBytes(18).toString("base64url");
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
    qrTokens: {
      acougue: crypto.randomBytes(18).toString("base64url"),
      frios: crypto.randomBytes(18).toString("base64url"),
      padaria: crypto.randomBytes(18).toString("base64url")
    },
    seedUsers: [manager, lockedCustomer]
  };
}

function qrToken(sectorId) {
  return testCredentials.qrTokens[sectorId];
}

function resetSectorTickets(sectorId) {
  const database = new DatabaseSync(path.join(dataDir, "fila-zero.sqlite"));
  database.prepare(`
    UPDATE tickets
    SET status = 'expirado', expired_at = ?, updated_at = ?
    WHERE sector_id = ? AND status IN ('aguardando', 'proximo', 'chamado', 'em_atendimento', 'espera_inteligente', 'standby')
  `).run(new Date().toISOString(), new Date().toISOString(), sectorId);
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
  const token = String(cookie).match(/fz_csrf=([^;]+)/)?.[1];
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
