const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const webPush = require("web-push");
const {
  PushNotificationService,
  buildNotificationPayload,
  isAllowedPushEndpoint,
  normalizePreferences,
  safeNotificationPath,
  validatePushSubscription,
  validateVapidConfiguration
} = require("../server/push-notification-service");
const pwaUtils = require("../public/pwa-utils");

const ROOT = path.resolve(__dirname, "..");
const PORT = 3700 + Math.floor(Math.random() * 200);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ORIGIN = BASE_URL;
const credentials = {
  first: {
    name: "Cliente Push Um",
    email: `push-one-${crypto.randomUUID()}@example.invalid`,
    password: "SenhaPushForte2026",
    role: "customer",
    sectorIds: []
  },
  second: {
    name: "Cliente Push Dois",
    email: `push-two-${crypto.randomUUID()}@example.invalid`,
    password: "SenhaPushForte2027",
    role: "customer",
    sectorIds: []
  }
};
const vapidKeys = webPush.generateVAPIDKeys();
let server;
let dataDir;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fila-zero-pwa-"));
  server = spawn(process.execPath, ["--no-warnings", "server/server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: dataDir,
      API_ONLY: "1",
      SUPABASE_AUTH_ENABLED: "0",
      PRESENCE_CHECK_ENABLED: "0",
      DEMO_USERS_JSON: JSON.stringify([credentials.first, credentials.second]),
      AUTH_SECRET: crypto.randomBytes(32).toString("hex"),
      PUSH_NOTIFICATIONS_ENABLED: "1",
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: vapidKeys.publicKey,
      VAPID_PRIVATE_KEY: vapidKeys.privateKey,
      VAPID_SUBJECT: "mailto:pwa-tests@example.invalid",
      QR_TOKEN_ACOUGUE: crypto.randomBytes(24).toString("base64url"),
      QR_TOKEN_FRIOS: crypto.randomBytes(24).toString("base64url"),
      QR_TOKEN_PADARIA: crypto.randomBytes(24).toString("base64url")
    },
    stdio: "ignore"
  });
  await waitForServer();
});

test.after(async () => {
  server?.kill();
  if (server?.exitCode === null) await new Promise((resolve) => server.once("exit", resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("converte a chave VAPID publica para 65 bytes", () => {
  const bytes = pwaUtils.urlBase64ToUint8Array(vapidKeys.publicKey);
  assert.equal(bytes.length, 65);
  assert.throws(() => pwaUtils.urlBase64ToUint8Array("chave+invalida"), /invalida/i);
});

test("valida a configuracao VAPID sem expor a chave privada", () => {
  assert.doesNotThrow(() => validateVapidConfiguration({
    publicKey: vapidKeys.publicKey,
    privateKey: vapidKeys.privateKey,
    subject: "mailto:push@example.invalid"
  }));
  assert.throws(() => validateVapidConfiguration({
    publicKey: vapidKeys.publicKey,
    privateKey: "invalida",
    subject: "mailto:push@example.invalid"
  }), /VAPID_PRIVATE_KEY/);
});

test("aceita apenas assinaturas Web Push bem formadas e provedores conhecidos", () => {
  const subscription = validSubscription();
  assert.deepEqual(validatePushSubscription(subscription), {
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth
  });
  assert.equal(isAllowedPushEndpoint("http://127.0.0.1/push"), false);
  assert.equal(isAllowedPushEndpoint("https://malicious.example/push"), false);
  assert.match(validatePushSubscription({ ...subscription, endpoint: "https://malicious.example/push" }).error, /endpoint/i);
  assert.match(validatePushSubscription({ ...subscription, keys: { ...subscription.keys, auth: "curta" } }).error, /auth/i);
});

test("constroi payload minimo e restringe o destino a telas internas", () => {
  const payload = buildNotificationPayload("queue_called", {
    customerName: "Vitor Correia",
    sector: "Frios e Laticínios",
    counterLabel: "Balcão 2",
    ticketId: "ticket-seguro",
    eventId: "evento-unico",
    url: "https://externo.example/roubo"
  });
  assert.equal(payload.title, "Vitor, é a sua vez!");
  assert.match(payload.body, /Frios e Laticínios/);
  assert.equal(payload.url, "/?view=status");
  assert.equal(safeNotificationPath("/?view=account"), "/?view=account");
  assert.equal(safeNotificationPath("/admin"), "/?view=status");
  assert.equal(pwaUtils.safeAppUrl("https://externo.example", "https://fila-zero.example"), null);
});

test("mantem consentimentos operacionais separados das promocoes", () => {
  assert.deepEqual(normalizePreferences({ promotions: true, queueCalled: false }), {
    queueNear: true,
    queueCalled: false,
    standby: true,
    queueChanges: true,
    promotions: true
  });
});

test("envia uma unica vez e revoga assinatura expirada", async () => {
  const repository = fakeRepository();
  const senderCalls = [];
  const service = new PushNotificationService({
    repository,
    configuration: {
      enabled: true,
      publicKey: vapidKeys.publicKey,
      privateKey: vapidKeys.privateKey,
      subject: "mailto:push@example.invalid"
    },
    sender: async (subscription, payload) => {
      senderCalls.push({ subscription, payload });
      if (subscription.id === "expired") {
        const error = new Error("gone");
        error.statusCode = 410;
        throw error;
      }
    },
    logger: { info() {}, warn() {} }
  });
  const event = {
    type: "queue_called",
    eventKey: "ticket-1:queue_called:absence-0:v1",
    userId: "user-1",
    ticketId: "ticket-1",
    context: {
      customerName: "Cliente Teste",
      sector: "Padaria",
      counterLabel: "Balcão 3"
    }
  };

  const first = await service.sendBusinessEvent(event);
  const duplicate = await service.sendBusinessEvent(event);
  assert.equal(first.status, "partial");
  assert.equal(first.sent, 1);
  assert.equal(first.failed, 1);
  assert.equal(duplicate.status, "duplicate");
  assert.equal(senderCalls.length, 2);
  assert.deepEqual(repository.invalidSubscriptions, ["expired"]);
  assert.equal(repository.events.get(event.eventKey).status, "partial");
});

test("nao envia um evento desativado nas preferencias", async () => {
  const repository = fakeRepository({ queueNear: false });
  let sends = 0;
  const service = new PushNotificationService({
    repository,
    configuration: { enabled: true },
    sender: async () => {
      sends += 1;
    },
    logger: { info() {}, warn() {} }
  });
  const result = await service.sendBusinessEvent({
    type: "queue_near",
    eventKey: "ticket-2:queue_near:ahead-2:v1",
    userId: "user-1",
    ticketId: "ticket-2",
    context: { sector: "Açougue", ahead: 2 }
  });
  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "preference_disabled");
  assert.equal(sends, 0);
});

test("rotas cadastram, atualizam e removem apenas o dispositivo do usuario autenticado", async () => {
  const first = await login(credentials.first);
  const second = await login(credentials.second);
  const subscription = validSubscription();

  const initial = await api("/api/push/status", { cookie: first.cookie });
  assert.equal(initial.status, 200);
  assert.equal(initial.payload.configured, true);
  assert.equal(initial.payload.devices.length, 0);

  const created = await api("/api/push/subscribe", {
    method: "POST",
    cookie: first.cookie,
    csrf: first.csrf,
    body: {
      subscription,
      device: { deviceName: "Chrome de teste", platform: "macos" },
      preferences: { queueNear: true, queueCalled: true, standby: true, queueChanges: true, promotions: false }
    }
  });
  assert.equal(created.status, 201);
  assert.equal(created.payload.subscription.deviceName, "Chrome de teste");

  const updated = await api("/api/push/subscribe", {
    method: "POST",
    cookie: first.cookie,
    csrf: first.csrf,
    body: {
      subscription: { ...subscription, keys: { ...subscription.keys, auth: crypto.randomBytes(16).toString("base64url") } },
      device: { deviceName: "Chrome atualizado", platform: "macos" }
    }
  });
  assert.equal(updated.status, 201);
  const firstStatus = await api("/api/push/status", { cookie: first.cookie });
  assert.equal(firstStatus.payload.devices.length, 1);
  assert.equal(firstStatus.payload.devices[0].deviceName, "Chrome atualizado");

  const otherStatus = await api("/api/push/status", { cookie: second.cookie });
  assert.equal(otherStatus.payload.devices.length, 0);

  const preferences = await api("/api/push/preferences", {
    method: "PATCH",
    cookie: first.cookie,
    csrf: first.csrf,
    body: { preferences: { promotions: true, queueCalled: false } }
  });
  assert.equal(preferences.status, 200);
  assert.equal(preferences.payload.preferences.promotions, true);
  assert.equal(preferences.payload.preferences.queueCalled, false);

  const removed = await api("/api/push/unsubscribe", {
    method: "DELETE",
    cookie: first.cookie,
    csrf: first.csrf,
    body: { endpoint: subscription.endpoint }
  });
  assert.equal(removed.status, 200);
  assert.equal((await api("/api/push/status", { cookie: first.cookie })).payload.devices.length, 0);
});

test("rotas de Push bloqueiam origem externa e payload invalido", async () => {
  const session = await login(credentials.first);
  const external = await api("/api/push/subscribe", {
    method: "POST",
    cookie: session.cookie,
    csrf: session.csrf,
    origin: "https://externo.example",
    body: { subscription: validSubscription() }
  });
  assert.equal(external.status, 403);

  const invalid = await api("/api/push/subscribe", {
    method: "POST",
    cookie: session.cookie,
    csrf: session.csrf,
    body: {
      subscription: {
        endpoint: "https://malicious.example/push",
        keys: { p256dh: "x", auth: "y" }
      }
    }
  });
  assert.equal(invalid.status, 400);
});

test("Service Worker possui ciclo, estrategias seguras e handlers de notificacao", () => {
  const worker = fs.readFileSync(path.join(ROOT, "public/sw.js"), "utf8");
  const cache = fs.readFileSync(path.join(ROOT, "public/sw/cache.js"), "utf8");
  const client = fs.readFileSync(path.join(ROOT, "public/pwa.js"), "utf8");
  assert.match(worker, /addEventListener\("install"/);
  assert.match(worker, /addEventListener\("activate"/);
  assert.match(worker, /addEventListener\("fetch"/);
  assert.match(worker, /addEventListener\("push"/);
  assert.match(worker, /addEventListener\("notificationclick"/);
  assert.match(worker, /addEventListener\("notificationclose"/);
  assert.match(worker, /SKIP_WAITING/);
  assert.match(cache, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(cache, /request\.method !== "GET"/);
  assert.match(cache, /networkFirstNavigation/);
  assert.match(cache, /cache: "no-store"/);
  assert.match(cache, /staleWhileRevalidate/);
  assert.match(cache, /cacheFirst/);
  assert.doesNotMatch(cache, /cache\.put\(request[\s\S]*\/api\//);
  assert.match(client, /document\.readyState === "complete"[\s\S]*scheduleServiceWorkerRegistration\(\)/);
  assert.match(client, /blockOfflineAction/);
});

test("migration protege assinaturas com RLS e RPCs exclusivas do service_role", () => {
  const migration = fs.readFileSync(
    path.join(ROOT, "supabase/migrations/20260724182303_pwa_push_notifications.sql"),
    "utf8"
  );
  assert.match(migration, /create table if not exists public\.web_push_subscriptions/i);
  assert.match(migration, /endpoint text not null unique/i);
  assert.match(migration, /alter table public\.web_push_subscriptions enable row level security/i);
  assert.match(migration, /using \(\(select auth\.uid\(\)\) = user_id\)/i);
  assert.match(migration, /create or replace function public\.claim_push_notification_event/i);
  assert.match(migration, /on conflict \(event_key\) do nothing/i);
  assert.match(migration, /revoke execute on function public\.claim_push_notification_event[\s\S]*from PUBLIC, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.consume_push_rate_limit[\s\S]*to service_role/i);
});

function fakeRepository(preferences = {}) {
  const claimed = new Set();
  const events = new Map();
  const invalidSubscriptions = [];
  return {
    events,
    invalidSubscriptions,
    claimEvent(event) {
      if (claimed.has(event.eventKey)) return null;
      claimed.add(event.eventKey);
      const row = { id: `event-${claimed.size}`, ...event, status: "processing" };
      events.set(event.eventKey, row);
      return row;
    },
    getPreferences() {
      return normalizePreferences(preferences);
    },
    getEnabledSubscriptions() {
      return [
        { id: "valid", endpoint: validSubscription().endpoint, p256dh: validSubscription().keys.p256dh, auth: validSubscription().keys.auth, failure_count: 0 },
        { id: "expired", endpoint: validSubscription().endpoint, p256dh: validSubscription().keys.p256dh, auth: validSubscription().keys.auth, failure_count: 2 }
      ];
    },
    completeEvent(id, result) {
      const row = [...events.values()].find((event) => event.id === id);
      Object.assign(row, result);
    },
    markSubscriptionSuccess() {},
    markSubscriptionFailure(id, failure) {
      if (failure.invalid) invalidSubscriptions.push(id);
    }
  };
}

function validSubscription() {
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/${crypto.randomUUID()}`,
    keys: {
      p256dh: crypto.randomBytes(65).toString("base64url"),
      auth: crypto.randomBytes(16).toString("base64url")
    }
  };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${BASE_URL}/api/config`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error("Servidor de testes PWA nao iniciou.");
}

async function login(user) {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ email: user.email, password: user.password })
  });
  assert.equal(response.status, 200);
  const setCookie = response.headers.get("set-cookie") || "";
  const auth = setCookie.match(/fz_auth=[^;,]+/)?.[0];
  const csrfCookie = setCookie.match(/fz_csrf=[^;,]+/)?.[0];
  const csrf = csrfCookie?.slice("fz_csrf=".length);
  assert.ok(auth && csrfCookie && csrf);
  return { cookie: `${auth}; ${csrfCookie}`, csrf };
}

async function api(pathname, options = {}) {
  const method = options.method || "GET";
  const headers = {
    "content-type": "application/json",
    origin: options.origin || ORIGIN
  };
  if (options.cookie) headers.cookie = options.cookie;
  if (options.csrf) headers["x-csrf-token"] = options.csrf;
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  return {
    status: response.status,
    payload: await response.json()
  };
}
