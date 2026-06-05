const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const ROOT = path.resolve(__dirname, "..");
loadEnvFile(path.join(ROOT, ".env"));

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : process.env.VERCEL
    ? path.join(os.tmpdir(), "fila-zero-data")
    : path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "fila-zero.sqlite");
const dev = process.env.NODE_ENV !== "production";
const isStandaloneServer = require.main === module;
const apiOnly = process.env.API_ONLY === "1";
let nextHandler = null;

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
const sseClients = new Set();

const STORE_LOCATION = {
  latitude: -22.1064,
  longitude: -50.1746,
  radiusMeters: 50000
};
const QR_TOKENS = loadQrTokens();
const PRESENCE_CHECK_ENABLED = false;
const MAX_ACTIVE_TICKETS_PER_CUSTOMER = 3;
const AUTO_CALL_DELAY_SECONDS = 30;
const CALL_ABSENCE_SECONDS = 10 * 60;
const TICKET_MIN_NUMBER = 0;
const TICKET_MAX_NUMBER = 999;
const BUSINESS_TIME_ZONE = "America/Sao_Paulo";
const AUTH_ROLES = ["customer", "attendant", "manager", "admin"];
const CUSTOMER_ROLES = ["customer", "manager", "admin"];
const STAFF_ROLES = ["attendant", "manager", "admin"];
const ADMIN_ROLES = ["manager", "admin"];
const ACTIVE_STATUSES = ["aguardando", "proximo", "chamado", "em_atendimento", "espera_inteligente", "standby"];
const CALL_ELIGIBLE_STATUSES = ["aguardando", "proximo", "standby"];
const CALL_BLOCKING_STATUSES = ["chamado", "em_atendimento"];
const CUSTOMER_CANCELABLE_STATUSES = ["aguardando", "proximo", "chamado", "espera_inteligente", "standby"];
const PRIORITY_CATEGORIES = new Set([
  "deficiencia_ou_mobilidade_reduzida",
  "tea",
  "idoso_60_mais",
  "gestante_ou_lactante",
  "crianca_de_colo",
  "obesidade"
]);
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const CSRF_EXEMPT_PATHS = new Set(["/api/auth/login"]);
const AUTH_SECRET = authSecret();
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_ANON_KEY = String(process.env.SUPABASE_ANON_KEY || "");
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");

bootstrap();

if (isStandaloneServer) startStandaloneServer();

function startStandaloneServer() {
  if (apiOnly) {
    listen(createHttpServer());
    startBackgroundJobs();
    return;
  }

  const next = require("next");
  const nextApp = next({ dev, dir: ROOT });
  nextHandler = nextApp.getRequestHandler();
  nextApp.prepare().then(() => {
    listen(createHttpServer());
  });

  startBackgroundJobs();
}

function createHttpServer() {
  return http.createServer(async (req, res) => {
    try {
      applySecurityHeaders(req, res);
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname.startsWith("/api/")) {
        await handleApi(req, res, url);
        return;
      }
      await handlePage(req, res, url);
    } catch (error) {
      console.error(error);
      sendJson(res, 500, { error: "Erro interno do servidor." });
    }
  });
}

function listen(server) {
  server.listen(PORT, () => {
    console.log(`Fila Zero Next.js rodando em http://localhost:${PORT}`);
  });
}

function startBackgroundJobs() {
  setInterval(() => {
    runScheduledJobs();
  }, 1000);

  setInterval(() => {
    expireStaleActiveTickets();
    expireAbsentCalls();
  }, 15000);
}

function runScheduledJobs() {
  autoCallReadyTickets();
}

function syncQueueState() {
  runScheduledJobs();
  expireAbsentCalls();
}

function bootstrap() {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      user_agent TEXT,
      last_seen_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS sectors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      prefix TEXT NOT NULL,
      counter_label TEXT NOT NULL,
      service_label TEXT NOT NULL,
      base_number INTEGER NOT NULL,
      current_number INTEGER NOT NULL,
      queue_size INTEGER NOT NULL,
      average_service_seconds INTEGER NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'open',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      sector_id TEXT NOT NULL,
      number INTEGER NOT NULL,
      code TEXT NOT NULL,
      status TEXT NOT NULL,
      queue_order INTEGER NOT NULL,
      smart_wait_reason TEXT,
      blocked_by_ticket_id TEXT,
      smart_wait_since TEXT,
      called_at TEXT,
      eligible_at TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      priority_reason TEXT,
      service_started_at TEXT,
      finished_at TEXT,
      canceled_at TEXT,
      expired_at TEXT,
      location_lat REAL,
      location_lng REAL,
      location_accuracy REAL,
      location_distance_meters REAL,
      location_verified INTEGER NOT NULL DEFAULT 0,
      qr_verified INTEGER NOT NULL DEFAULT 0,
      absence_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (sector_id) REFERENCES sectors(id)
    );

    CREATE TABLE IF NOT EXISTS calls (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      sector_id TEXT NOT NULL,
      action TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id)
    );

    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      sector_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id)
    );

    CREATE TABLE IF NOT EXISTS ratings (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      ticket_id TEXT,
      score TEXT NOT NULL,
      comment TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      customer_id TEXT,
      sector_id TEXT,
      payload TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ticket_counters (
      sector_id TEXT PRIMARY KEY,
      business_date TEXT NOT NULL,
      last_number INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (sector_id) REFERENCES sectors(id)
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      csrf_token TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS user_sector_permissions (
      user_id TEXT NOT NULL,
      sector_id TEXT NOT NULL,
      PRIMARY KEY (user_id, sector_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (sector_id) REFERENCES sectors(id)
    );

    CREATE TABLE IF NOT EXISTS cart_items (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      sector_name TEXT NOT NULL,
      price TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS login_attempts (
      attempt_key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      first_attempt_at INTEGER NOT NULL,
      locked_until INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);

  migrateSchema();

  const existing = db.prepare("SELECT COUNT(*) AS count FROM sectors").get().count;
  if (existing > 0) {
    seedDefaultUsers();
    return;
  }

  const insert = db.prepare(`
    INSERT INTO sectors (id, name, prefix, counter_label, service_label, base_number, current_number, queue_size, average_service_seconds, capacity, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const now = isoNow();
  [
    ["acougue", "Açougue", "A", "Balcão 1", "Carnes frescas e cortes especiais", 142, 138, 7, 42, 1, "open"],
    ["frios", "Frios e Laticínios", "F", "Balcão 2", "Queijos, embutidos e fatiados", 86, 83, 4, 36, 1, "open"],
    ["padaria", "Padaria", "P", "Balcão 3", "Pães, bolos e salgados frescos", 221, 216, 5, 34, 1, "open"]
  ].forEach((sector) => insert.run(...sector, now));

  seedDefaultUsers();
}

function migrateSchema() {
  const columns = db.prepare("PRAGMA table_info(tickets)").all().map((column) => column.name);
  const migrations = [
    ["expired_at", "ALTER TABLE tickets ADD COLUMN expired_at TEXT"],
    ["location_lat", "ALTER TABLE tickets ADD COLUMN location_lat REAL"],
    ["location_lng", "ALTER TABLE tickets ADD COLUMN location_lng REAL"],
    ["location_accuracy", "ALTER TABLE tickets ADD COLUMN location_accuracy REAL"],
    ["location_distance_meters", "ALTER TABLE tickets ADD COLUMN location_distance_meters REAL"],
    ["location_verified", "ALTER TABLE tickets ADD COLUMN location_verified INTEGER NOT NULL DEFAULT 0"],
    ["qr_verified", "ALTER TABLE tickets ADD COLUMN qr_verified INTEGER NOT NULL DEFAULT 0"],
    ["absence_count", "ALTER TABLE tickets ADD COLUMN absence_count INTEGER NOT NULL DEFAULT 0"],
    ["canceled_at", "ALTER TABLE tickets ADD COLUMN canceled_at TEXT"],
    ["eligible_at", "ALTER TABLE tickets ADD COLUMN eligible_at TEXT"],
    ["priority", "ALTER TABLE tickets ADD COLUMN priority INTEGER NOT NULL DEFAULT 0"],
    ["priority_reason", "ALTER TABLE tickets ADD COLUMN priority_reason TEXT"]
  ];
  migrations.forEach(([column, sql]) => {
    if (!columns.includes(column)) db.exec(sql);
  });

  const sessionColumns = db.prepare("PRAGMA table_info(auth_sessions)").all().map((column) => column.name);
  if (!sessionColumns.includes("csrf_token")) {
    db.exec("ALTER TABLE auth_sessions ADD COLUMN csrf_token TEXT");
  }
}

async function handleApi(req, res, url) {
  runScheduledJobs();

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readBody(req);
    const result = await loginUser(body, req);
    if (result.error) {
      sendJson(res, 401, result);
      return;
    }
    setAuthCookies(res, result.sessionId, result.csrfToken);
    sendJson(res, 200, { user: result.user, csrfToken: result.csrfToken });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    if (!verifyCsrf(req, res, getAuthUser(req))) return;
    logoutUser(req, res);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    const user = getAuthUser(req);
    sendJson(res, 200, { user, csrfToken: user ? getSessionForRequest(req)?.csrf_token || null : null });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/events") {
    const user = url.searchParams.get("scope") === "staff"
      ? requireAuth(req, res, STAFF_ROLES)
      : requireAuth(req, res, CUSTOMER_ROLES);
    if (!user) return;
    syncQueueState();
    if (!isStandaloneServer) {
      const data = url.searchParams.get("scope") === "staff" ? getStaffState(user) : getCustomerState(user.customerId);
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "close"
      });
      res.end(`event: state\ndata: ${JSON.stringify(data)}\n\n`);
      return;
    }
    openEventStream(req, res, url, user);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/sessions") {
    const user = requireAuth(req, res, CUSTOMER_ROLES);
    if (!user) return;
    if (!verifyCsrf(req, res, user)) return;
    const body = await readBody(req);
    const session = upsertSession({ ...body, customerId: user.customerId }, req.headers["user-agent"] || "");
    sendJson(res, 200, session);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    const user = requireAuth(req, res, CUSTOMER_ROLES);
    if (!user) return;
    syncQueueState();
    sendJson(res, 200, getCustomerState(user.customerId));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/history") {
    const user = requireAuth(req, res, CUSTOMER_ROLES);
    if (!user) return;
    sendJson(res, 200, getCustomerHistory(user.customerId));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/metrics") {
    if (!requireAuth(req, res, ADMIN_ROLES)) return;
    syncQueueState();
    sendJson(res, 200, getMetrics());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/staff/state") {
    const user = requireAuth(req, res, STAFF_ROLES);
    if (!user) return;
    syncQueueState();
    sendJson(res, 200, getStaffState(user));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/tickets") {
    const user = requireAuth(req, res, CUSTOMER_ROLES);
    if (!user) return;
    if (!verifyCsrf(req, res, user)) return;
    const body = await readBody(req);
    const result = createTicket({ ...body, customerId: user.customerId });
    broadcast();
    sendApiResult(res, 201, result);
    return;
  }

  const ticketConfirm = url.pathname.match(/^\/api\/tickets\/([^/]+)\/confirm$/);
  if (req.method === "POST" && ticketConfirm) {
    const user = getAuthUser(req);
    if (!verifyCsrf(req, res, user)) return;
    const body = await readBody(req);
    if (!canOperateOnTicket(user, ticketConfirm[1], body.customerId)) {
      sendJson(res, 401, { error: "Autenticação necessária." });
      return;
    }
    const result = confirmTicket(ticketConfirm[1]);
    broadcast();
    sendApiResult(res, 200, result);
    return;
  }

  const ticketFinish = url.pathname.match(/^\/api\/tickets\/([^/]+)\/finish$/);
  if (req.method === "POST" && ticketFinish) {
    const user = getAuthUser(req);
    if (!verifyCsrf(req, res, user)) return;
    const body = await readBody(req);
    if (!canOperateOnTicket(user, ticketFinish[1], body.customerId)) {
      sendJson(res, 401, { error: "Autenticação necessária." });
      return;
    }
    const result = finishTicket(ticketFinish[1]);
    broadcast();
    sendApiResult(res, 200, result);
    return;
  }

  const ticketCancel = url.pathname.match(/^\/api\/tickets\/([^/]+)\/cancel$/);
  if (req.method === "POST" && ticketCancel) {
    const user = requireAuth(req, res, CUSTOMER_ROLES);
    if (!user) return;
    if (!verifyCsrf(req, res, user)) return;
    const body = await readBody(req);
    const customerId = body.customerId || user.customerId;
    if (customerId !== user.customerId || !canCustomerAccessTicket(ticketCancel[1], user.customerId)) {
      sendJson(res, 401, { error: "AutenticaÃ§Ã£o necessÃ¡ria." });
      return;
    }
    const result = cancelTicket(ticketCancel[1], user.customerId);
    broadcast();
    sendApiResult(res, 200, result);
    return;
  }

  const callNext = url.pathname.match(/^\/api\/sectors\/([^/]+)\/call-next$/);
  if (req.method === "POST" && callNext) {
    const user = requireAuth(req, res, STAFF_ROLES);
    if (!user) return;
    if (!verifyCsrf(req, res, user)) return;
    if (!canAccessSector(user, callNext[1])) {
      sendJson(res, 403, { error: "Usuário sem permissão para este setor." });
      return;
    }
    const result = callNextTicket(callNext[1]);
    broadcast();
    sendApiResult(res, 200, result);
    return;
  }

  const sectorUpdate = url.pathname.match(/^\/api\/sectors\/([^/]+)$/);
  if (req.method === "PUT" && sectorUpdate) {
    const user = requireAuth(req, res, ADMIN_ROLES);
    if (!user) return;
    if (!verifyCsrf(req, res, user)) return;
    const body = await readBody(req);
    const result = updateSector(sectorUpdate[1], body);
    broadcast();
    sendApiResult(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/ratings") {
    const user = requireAuth(req, res, CUSTOMER_ROLES);
    if (!user) return;
    if (!verifyCsrf(req, res, user)) return;
    const body = await readBody(req);
    const result = createRating({ ...body, customerId: user.customerId });
    broadcast();
    sendApiResult(res, 201, result);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/cart") {
    const user = requireAuth(req, res, CUSTOMER_ROLES);
    if (!user) return;
    sendJson(res, 200, getCart(user.customerId));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/cart/items") {
    const user = requireAuth(req, res, CUSTOMER_ROLES);
    if (!user) return;
    if (!verifyCsrf(req, res, user)) return;
    const body = await readBody(req);
    const result = addCartItem({ ...body, customerId: user.customerId });
    broadcast();
    sendApiResult(res, 201, result);
    return;
  }

  const cartDelete = url.pathname.match(/^\/api\/cart\/items\/([^/]+)$/);
  if (req.method === "DELETE" && cartDelete) {
    const user = requireAuth(req, res, ["customer"]);
    if (!user) return;
    if (!verifyCsrf(req, res, user)) return;
    const result = removeCartItem(cartDelete[1], user.customerId);
    broadcast();
    sendApiResult(res, 200, result);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/users") {
    if (!requireAuth(req, res, ADMIN_ROLES)) return;
    sendJson(res, 200, { users: await listUsers() });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/users") {
    const user = requireAuth(req, res, ADMIN_ROLES);
    if (!user) return;
    if (!verifyCsrf(req, res, user)) return;
    const body = await readBody(req);
    const result = createUser(body);
    broadcast();
    sendApiResult(res, 201, result);
    return;
  }

  sendJson(res, 404, { error: "Rota não encontrada." });
}

async function handlePage(req, res, url) {
  const requested = normalizePagePath(url.pathname);
  const pageRoles = {
    "/": CUSTOMER_ROLES,
    "/attendant": STAFF_ROLES,
    "/admin": ADMIN_ROLES
  };
  if (pageRoles[requested]) {
    const user = getAuthUser(req);
    const required = pageRoles[requested];
    if (!user) {
      res.writeHead(302, { location: `/login?next=${encodeURIComponent(requested)}` });
      res.end();
      return;
    }
    if (!hasAnyRole(user, required)) {
      res.writeHead(302, { location: roleHome(user) });
      res.end();
      return;
    }
  }
  if (requested !== url.pathname) req.url = `${requested}${url.search}`;
  if (!nextHandler) {
    sendJson(res, 404, { error: "Pagina nao disponivel neste processo." });
    return;
  }
  await nextHandler(req, res);
}

function normalizePagePath(pathname) {
  if (pathname === "/index.html") return "/";
  if (pathname === "/attendant.html") return "/attendant";
  if (pathname === "/admin.html") return "/admin";
  if (pathname === "/login.html") return "/login";
  return pathname;
}

function openEventStream(req, res, url, user = getAuthUser(req)) {
  const client = {
    res,
    customerId: hasAnyRole(user, CUSTOMER_ROLES) ? user.customerId : url.searchParams.get("customer_id") || null,
    scope: url.searchParams.get("scope") || "customer",
    user
  };

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no"
  });
  res.write("\n");
  sseClients.add(client);
  sendSse(client);

  req.on("close", () => {
    sseClients.delete(client);
  });
}

function broadcast() {
  for (const client of sseClients) sendSse(client);
}

function sendSse(client) {
  const data = client.scope === "staff" ? getStaffState(client.user) : getCustomerState(client.customerId);
  client.res.write(`event: state\n`);
  client.res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function seedDefaultUsers() {
  deactivateLegacySeedUsers();

  const configuredDemoUsers = parseJsonEnv("DEMO_USERS_JSON");
  if (Array.isArray(configuredDemoUsers) && configuredDemoUsers.length) {
    configuredDemoUsers.forEach(seedUser);
    return;
  }

  if (!dev && process.env.ALLOW_DEMO_USERS !== "1") {
    seedProductionBootstrapUser();
    return;
  }

  seedProductionBootstrapUser();
}

function seedProductionBootstrapUser() {
  const hasActiveUser = db.prepare("SELECT 1 FROM users WHERE status = 'active' LIMIT 1").get();
  if (hasActiveUser) return;

  const email = String(process.env.BOOTSTRAP_ADMIN_EMAIL || "").trim().toLowerCase();
  const password = String(process.env.BOOTSTRAP_ADMIN_PASSWORD || "");
  if (!email || password.length < 12) {
    console.warn("Nenhum usuario inicial foi criado. Configure BOOTSTRAP_ADMIN_EMAIL e BOOTSTRAP_ADMIN_PASSWORD com ao menos 12 caracteres.");
    return;
  }

  createUser({
    name: process.env.BOOTSTRAP_ADMIN_NAME || "Gestor Inicial",
    email,
    password,
    role: "manager",
    sectorIds: []
  });
}

function deactivateLegacySeedUsers() {
  const legacyPatterns = parseJsonEnv("LEGACY_USER_EMAIL_PATTERNS");
  if (!Array.isArray(legacyPatterns) || !legacyPatterns.length) return;

  const placeholders = legacyPatterns.map(() => "email LIKE ?").join(" OR ");
  db.prepare(`
    UPDATE users
    SET status = ?, updated_at = ?
    WHERE ${placeholders}
  `).run("inactive", isoNow(), ...legacyPatterns);
}

function seedUser(user) {
  const email = String(user.email || "").trim().toLowerCase();
  if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) return;
  createUser({ ...user, email });
}

function isLoginLocked(key) {
  const now = Date.now();
  const entry = db.prepare("SELECT * FROM login_attempts WHERE attempt_key = ?").get(key);
  if (!entry) return false;
  if (entry.locked_until && entry.locked_until > now) return true;
  if (entry.locked_until && entry.locked_until <= now) clearLoginFailures(key);
  return false;
}

function registerLoginFailure(key) {
  const now = Date.now();
  const entry = db.prepare("SELECT * FROM login_attempts WHERE attempt_key = ?").get(key);
  const attempts = entry && now - entry.first_attempt_at <= LOGIN_ATTEMPT_WINDOW_MS
    ? entry.count + 1
    : 1;
  const firstAttemptAt = entry && now - entry.first_attempt_at <= LOGIN_ATTEMPT_WINDOW_MS ? entry.first_attempt_at : now;
  const lockedUntil = attempts >= LOGIN_ATTEMPT_LIMIT ? now + LOGIN_LOCK_MS : 0;
  db.prepare(`
    INSERT INTO login_attempts (attempt_key, count, first_attempt_at, locked_until, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(attempt_key) DO UPDATE SET
      count = excluded.count,
      first_attempt_at = excluded.first_attempt_at,
      locked_until = excluded.locked_until,
      updated_at = excluded.updated_at
  `).run(key, attempts, firstAttemptAt, lockedUntil, isoNow());
}

function clearLoginFailures(key) {
  db.prepare("DELETE FROM login_attempts WHERE attempt_key = ?").run(key);
}

async function loginUser(body, req) {
  if (isSupabaseConfigured()) return loginSupabaseUser(body, req);
  return loginLocalUser(body, req);
}

function loginLocalUser(body, req) {
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const attemptKey = `${clientIp(req)}:${email || "unknown"}`;
  if (isLoginLocked(attemptKey)) {
    return { error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." };
  }
  const user = db.prepare("SELECT * FROM users WHERE email = ? AND status = ?").get(email, "active");
  if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
    registerLoginFailure(attemptKey);
    return { error: "E-mail ou senha inválidos." };
  }
  clearLoginFailures(attemptKey);

  const sessionId = `auth-${crypto.randomUUID()}`;
  const csrfToken = crypto.randomBytes(32).toString("hex");
  const now = isoNow();
  const expiresAt = new Date(Date.now() + 1000 * SESSION_TTL_SECONDS).toISOString();
  db.prepare("INSERT INTO auth_sessions (id, user_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .run(sessionId, user.id, csrfToken, now, expiresAt);
  const sessionToken = signSessionToken({
    email: user.email,
    user: userDto(user),
    csrfToken,
    expiresAt
  });
  registerEvent("login", "user", user.id, null, null, { email: user.email, role: user.role });
  return { sessionId: sessionToken, csrfToken, user: userDto(user) };
}

async function loginSupabaseUser(body, req) {
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const attemptKey = `${clientIp(req)}:${email || "unknown"}`;
  if (isLoginLocked(attemptKey)) {
    return { error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." };
  }

  const auth = await supabaseFetch("/auth/v1/token?grant_type=password", {
    method: "POST",
    apiKey: SUPABASE_ANON_KEY,
    bearer: SUPABASE_ANON_KEY,
    body: { email, password }
  });

  if (auth.error || !auth.user?.id) {
    registerLoginFailure(attemptKey);
    return { error: "E-mail ou senha invalidos." };
  }

  const profile = await getSupabaseProfile(auth.user.id, auth.user.email);
  if (!profile || profile.status !== "active") {
    registerLoginFailure(attemptKey);
    return { error: "Usuario sem perfil ativo no sistema." };
  }

  clearLoginFailures(attemptKey);
  const csrfToken = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 1000 * SESSION_TTL_SECONDS).toISOString();
  const sessionToken = signSessionToken({
    provider: "supabase",
    email: profile.email,
    user: profile,
    csrfToken,
    expiresAt
  });

  return { sessionId: sessionToken, csrfToken, user: profile };
}

function logoutUser(req, res) {
  const sessionId = getCookie(req, "fz_auth");
  if (sessionId) db.prepare("DELETE FROM auth_sessions WHERE id = ?").run(sessionId);
  res.setHeader("set-cookie", "fz_auth=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  appendCookie(res, "fz_csrf=; SameSite=Lax; Path=/; Max-Age=0");
}

function getAuthUser(req) {
  const session = getSessionForRequest(req);
  return session ? userDto(session) : null;
}

function getSessionForRequest(req) {
  const sessionId = getCookie(req, "fz_auth");
  if (!sessionId) return null;
  const statelessSession = verifySessionToken(sessionId);
  if (statelessSession) {
    if (statelessSession.user) {
      return { ...statelessSession.user, csrf_token: statelessSession.csrfToken };
    }
    const user = db.prepare("SELECT * FROM users WHERE email = ? AND status = ?").get(statelessSession.email, "active");
    return user ? { ...user, csrf_token: statelessSession.csrfToken } : null;
  }
  return db.prepare(`
    SELECT users.*, auth_sessions.csrf_token AS csrf_token FROM auth_sessions
    JOIN users ON users.id = auth_sessions.user_id
    WHERE auth_sessions.id = ? AND auth_sessions.expires_at > ? AND users.status = 'active'
  `).get(sessionId, isoNow());
}

function verifyCsrf(req, res, user) {
  if (!user || !["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return Boolean(user);
  const session = getSessionForRequest(req);
  const headerToken = String(req.headers["x-csrf-token"] || "");
  const cookieToken = getCookie(req, "fz_csrf") || "";
  const expected = session?.csrf_token || "";
  if (safeEqual(headerToken, expected) && safeEqual(cookieToken, expected)) return true;
  sendJson(res, 403, { error: "Token de seguranca invalido. Recarregue a pagina e tente novamente." });
  return false;
}

function requireAuth(req, res, roles) {
  const user = getAuthUser(req);
  if (!user) {
    sendJson(res, 401, { error: "Autenticação necessária." });
    return null;
  }
  if (!hasAnyRole(user, roles)) {
    sendJson(res, 403, { error: "Acesso negado." });
    return null;
  }
  return user;
}

function setAuthCookies(res, sessionId, csrfToken) {
  const secure = dev ? "" : "; Secure";
  res.setHeader("set-cookie", `fz_auth=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secure}`);
  appendCookie(res, `fz_csrf=${csrfToken}; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secure}`);
}

function appendCookie(res, cookie) {
  const current = res.getHeader?.("set-cookie");
  if (!current) {
    res.setHeader("set-cookie", cookie);
    return;
  }
  res.setHeader("set-cookie", Array.isArray(current) ? [...current, cookie] : [current, cookie]);
}

function signSessionToken(payload) {
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const signature = signValue(encoded);
  return `session.${encoded}.${signature}`;
}

function verifySessionToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts[0] !== "session") return null;
  const [, encoded, signature] = parts;
  if (!safeEqual(signature, signValue(encoded))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!payload.email || !payload.csrfToken || new Date(payload.expiresAt).getTime() <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function signValue(value) {
  return crypto.createHmac("sha256", AUTH_SECRET).update(value).digest("base64url");
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function authSecret() {
  if (process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32) return process.env.AUTH_SECRET;
  if (dev || process.env.ALLOW_DEMO_USERS === "1") return "fila-zero-demo-auth-secret-change-before-production";
  console.warn("AUTH_SECRET nao configurado. Defina um segredo com ao menos 32 caracteres em producao.");
  return crypto.randomBytes(32).toString("hex");
}

function isSupabaseConfigured() {
  if (process.env.SUPABASE_AUTH_ENABLED === "0") return false;
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);
}

async function supabaseFetch(pathname, options = {}) {
  const headers = {
    "content-type": "application/json",
    apikey: options.apiKey || SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${options.bearer || SUPABASE_SERVICE_ROLE_KEY}`,
    ...(options.headers || {})
  };
  const response = await fetch(`${SUPABASE_URL}${pathname}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    return { error: payload?.error_description || payload?.message || response.statusText, status: response.status };
  }
  return payload;
}

async function getSupabaseProfile(userId, fallbackEmail = "") {
  const profileRows = await supabaseFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,name,email,role,status,created_at`);
  if (profileRows.error) return null;
  const profile = profileRows[0];
  if (!profile) return null;

  const permissionRows = await supabaseFetch(`/rest/v1/profile_sector_permissions?profile_id=eq.${encodeURIComponent(userId)}&select=sector_id`);
  const sectorIds = Array.isArray(permissionRows) ? permissionRows.map((item) => item.sector_id) : [];
  return {
    id: profile.id,
    customerId: profile.id,
    name: profile.name,
    email: profile.email || fallbackEmail,
    role: normalizeRole(profile.role),
    status: profile.status,
    sectorIds,
    createdAt: profile.created_at
  };
}

async function listSupabaseUsers() {
  const profileRows = await supabaseFetch("/rest/v1/profiles?select=id,name,email,role,status,created_at&order=created_at.asc");
  if (profileRows.error || !Array.isArray(profileRows)) return [];
  const permissionRows = await supabaseFetch("/rest/v1/profile_sector_permissions?select=profile_id,sector_id");
  const permissionsByProfile = new Map();
  if (Array.isArray(permissionRows)) {
    permissionRows.forEach((item) => {
      const current = permissionsByProfile.get(item.profile_id) || [];
      current.push(item.sector_id);
      permissionsByProfile.set(item.profile_id, current);
    });
  }

  return profileRows.map((profile) => ({
    id: profile.id,
    customerId: profile.id,
    name: profile.name,
    email: profile.email,
    role: normalizeRole(profile.role),
    status: profile.status,
    sectorIds: permissionsByProfile.get(profile.id) || [],
    createdAt: profile.created_at
  }));
}

function createUser(body) {
  if (isSupabaseConfigured()) {
    return fail("Crie usuarios em Supabase > Authentication > Users. O app apenas le os perfis do Supabase.");
  }

  const role = AUTH_ROLES.includes(body.role) ? body.role : "attendant";
  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.name || "").trim();
  const password = String(body.password || "");
  if (!email || !name || password.length < 6) return fail("Informe nome, e-mail e senha com ao menos 6 caracteres.");

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) return fail("Já existe um usuário com este e-mail.");

  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPassword(password, salt);
  const id = `user-${crypto.randomUUID()}`;
  const now = isoNow();
  db.prepare(`
    INSERT INTO users (id, name, email, role, password_hash, password_salt, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, email, role, hash, salt, "active", now, now);

  setUserSectorPermissions(id, Array.isArray(body.sectorIds) ? body.sectorIds : []);
  registerEvent("usuario_criado", "user", id, null, null, { email, role });
  return { user: userDto(db.prepare("SELECT * FROM users WHERE id = ?").get(id)) };
}

async function listUsers() {
  if (isSupabaseConfigured()) return listSupabaseUsers();
  return db.prepare("SELECT * FROM users WHERE status = 'active' ORDER BY created_at ASC").all().map(userDto);
}

function userDto(row) {
  if (Array.isArray(row.sectorIds)) {
    return {
      id: row.id,
      customerId: row.customerId || row.id,
      name: row.name,
      email: row.email,
      role: normalizeRole(row.role),
      status: row.status,
      sectorIds: row.sectorIds,
      createdAt: row.createdAt || row.created_at || null
    };
  }

  const sectorIds = db.prepare("SELECT sector_id FROM user_sector_permissions WHERE user_id = ? ORDER BY sector_id").all(row.id).map((item) => item.sector_id);
  const role = normalizeRole(row.role);
  return {
    id: row.id,
    customerId: row.id,
    name: row.name,
    email: row.email,
    role,
    status: row.status,
    sectorIds,
    createdAt: row.created_at
  };
}

function setUserSectorPermissions(userId, sectorIds) {
  db.prepare("DELETE FROM user_sector_permissions WHERE user_id = ?").run(userId);
  const insert = db.prepare("INSERT OR IGNORE INTO user_sector_permissions (user_id, sector_id) VALUES (?, ?)");
  sectorIds.filter((sectorId) => getSector(sectorId)).forEach((sectorId) => insert.run(userId, sectorId));
}

function canAccessSector(user, sectorId) {
  if (hasAnyRole(user, ADMIN_ROLES)) return true;
  if (Array.isArray(user?.sectorIds)) return user.sectorIds.includes(sectorId);
  return db.prepare("SELECT 1 FROM user_sector_permissions WHERE user_id = ? AND sector_id = ?").get(user.id, sectorId);
}

function canOperateOnTicket(user, ticketId, customerId) {
  if (user && hasAnyRole(user, STAFF_ROLES)) return true;
  if (hasAnyRole(user, CUSTOMER_ROLES)) return canCustomerAccessTicket(ticketId, user.customerId);
  return canCustomerAccessTicket(ticketId, customerId);
}

function canCustomerAccessTicket(ticketId, customerId) {
  if (!customerId) return false;
  return Boolean(db.prepare("SELECT 1 FROM tickets WHERE id = ? AND customer_id = ?").get(ticketId, customerId));
}

function normalizeRole(role) {
  return role === "admin" ? "manager" : role;
}

function hasAnyRole(user, roles) {
  if (!user) return false;
  return roles.includes(normalizeRole(user.role));
}

function roleHome(user) {
  if (hasAnyRole(user, ["attendant"])) return "/attendant";
  return "/";
}

function applySecurityHeaders(req, res) {
  const connectSrc = dev ? "'self' ws: http://localhost:*" : "'self'";
  const scriptSrc = dev ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self'";
  res.setHeader("content-security-policy", [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: https://source.unsplash.com https://images.unsplash.com",
    `connect-src ${connectSrc}`,
    "font-src 'self' https://fonts.gstatic.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join("; "));
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "same-origin");
  res.setHeader("permissions-policy", "camera=(), microphone=(), payment=(), usb=()");
  res.setHeader("cross-origin-opener-policy", "same-origin");
  if (req.url?.startsWith("/login") || req.url?.startsWith("/api/auth")) {
    res.setHeader("cache-control", "no-store");
  }
}

function validatePresence(body, sectorId) {
  if (!PRESENCE_CHECK_ENABLED) {
    return { ok: true, qrVerified: false, locationVerified: false, location: null, distanceMeters: null };
  }

  const token = String(body.qrToken || "");
  const qrVerified = token && QR_TOKENS[sectorId] === token;
  const location = normalizeLocation(body.location);
  const distanceMeters = location ? distanceBetweenMeters(location.latitude, location.longitude, STORE_LOCATION.latitude, STORE_LOCATION.longitude) : null;
  const locationVerified = Boolean(location && distanceMeters <= STORE_LOCATION.radiusMeters);

  if (qrVerified || locationVerified) {
    return { ok: true, qrVerified, locationVerified, location, distanceMeters };
  }

  if (!location && !token) {
    return { ok: false, error: "Autorize a localização ou use o QR Code do setor para solicitar senha." };
  }

  if (location && !locationVerified) {
    return { ok: false, error: "Você precisa estar dentro ou perto da loja para solicitar senha." };
  }

  return { ok: false, error: "QR Code do setor inválido." };
}

function normalizePriority(body = {}) {
  const requested = body.priority === true || body.preferential === true || body.isPriority === true;
  const reason = cleanPriorityReason(body.priorityReason || body.preferentialReason || body.priorityCategory);
  if (!requested && !reason) return { enabled: false, reason: null };
  if (!reason) return { enabled: false, reason: null };
  return { enabled: true, reason };
}

function cleanPriorityReason(value) {
  const reason = cleanId(value);
  return PRIORITY_CATEGORIES.has(reason) ? reason : null;
}

function loadQrTokens() {
  const fromJson = parseJsonEnv("QR_TOKENS");
  const tokens = fromJson && typeof fromJson === "object" ? fromJson : {
    acougue: process.env.QR_TOKEN_ACOUGUE,
    frios: process.env.QR_TOKEN_FRIOS,
    padaria: process.env.QR_TOKEN_PADARIA
  };

  return {
    acougue: tokens.acougue || "",
    frios: tokens.frios || "",
    padaria: tokens.padaria || ""
  };
}

function parseJsonEnv(name) {
  if (!process.env[name]) return null;
  try {
    return JSON.parse(process.env[name]);
  } catch {
    console.warn(`${name} nao contem JSON valido.`);
    return null;
  }
}

function normalizeLocation(location) {
  if (!location) return null;
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  const accuracy = Number(location.accuracy || 0);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude, accuracy };
}

function distanceBetweenMeters(latA, lngA, latB, lngB) {
  const earthRadius = 6371000;
  const toRad = (value) => (value * Math.PI) / 180;
  const deltaLat = toRad(latB - latA);
  const deltaLng = toRad(lngB - lngA);
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(toRad(latA)) * Math.cos(toRad(latB)) * Math.sin(deltaLng / 2) ** 2;
  return Math.round(earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function upsertSession(body, userAgent) {
  const now = isoNow();
  const customerId = cleanId(body.customerId) || `cliente-${crypto.randomUUID()}`;
  const deviceId = cleanId(body.deviceId) || `device-${crypto.randomUUID()}`;

  db.prepare("INSERT OR IGNORE INTO customers (id, created_at) VALUES (?, ?)").run(customerId, now);
  db.prepare(`
    INSERT INTO devices (id, customer_id, user_agent, last_seen_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET customer_id = excluded.customer_id, user_agent = excluded.user_agent, last_seen_at = excluded.last_seen_at
  `).run(deviceId, customerId, userAgent, now);

  return { customerId, deviceId };
}

function createTicket(body) {
  expireStaleActiveTickets();

  const sector = getSector(body.sectorId);
  if (!sector) return fail("Setor não encontrado.");
  if (sector.status !== "open") return fail("Setor fechado para novas senhas.");

  const session = upsertSession(body, "");
  const activeTotal = db.prepare(`
    SELECT COUNT(*) AS total FROM tickets
    WHERE customer_id = ? AND status IN (${placeholders(ACTIVE_STATUSES)})
  `).get(session.customerId, ...ACTIVE_STATUSES).total;
  if (activeTotal >= MAX_ACTIVE_TICKETS_PER_CUSTOMER) return fail(`Limite de ${MAX_ACTIVE_TICKETS_PER_CUSTOMER} senhas ativas por cliente atingido.`);

  const existing = db.prepare(`
    SELECT * FROM tickets
    WHERE customer_id = ? AND sector_id = ? AND status IN (${placeholders(ACTIVE_STATUSES)})
    ORDER BY created_at DESC LIMIT 1
  `).get(session.customerId, sector.id, ...ACTIVE_STATUSES);

  if (existing) return { ticket: ticketDto(existing), alreadyExists: true };

  const presence = validatePresence(body, sector.id);
  if (!presence.ok) return fail(presence.error);
  const priority = normalizePriority(body);

  const ticket = runInTransaction(() => {
    const now = isoNow();
    const nextNumber = nextTicketNumber(sector.id, now);
    const queueOrder = nextQueueOrder(sector.id);
    const nextTicket = {
      id: `ticket-${crypto.randomUUID()}`,
      customerId: session.customerId,
      deviceId: session.deviceId,
      sectorId: sector.id,
      number: nextNumber,
      code: formatTicket(sector.prefix, nextNumber),
      status: "aguardando",
      queueOrder,
      priority: priority.enabled ? 1 : 0,
      priorityReason: priority.reason,
      eligibleAt: new Date(Date.now() + AUTO_CALL_DELAY_SECONDS * 1000).toISOString(),
      createdAt: now
    };

    db.prepare(`
      INSERT INTO tickets (
        id, customer_id, device_id, sector_id, number, code, status, queue_order,
        eligible_at, priority, priority_reason,
        location_lat, location_lng, location_accuracy, location_distance_meters, location_verified, qr_verified,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      nextTicket.id,
      nextTicket.customerId,
      nextTicket.deviceId,
      nextTicket.sectorId,
      nextTicket.number,
      nextTicket.code,
      nextTicket.status,
      nextTicket.queueOrder,
      nextTicket.eligibleAt,
      nextTicket.priority,
      nextTicket.priorityReason,
      presence.location?.latitude || null,
      presence.location?.longitude || null,
      presence.location?.accuracy || null,
      presence.distanceMeters || null,
      presence.locationVerified ? 1 : 0,
      presence.qrVerified ? 1 : 0,
      nextTicket.createdAt,
      nextTicket.createdAt
    );

    registerEvent("senha_emitida", "ticket", nextTicket.id, nextTicket.customerId, nextTicket.sectorId, { code: nextTicket.code, presence, priority });
    return nextTicket;
  });

  return { ticket: ticketDto(getTicket(ticket.id)), alreadyExists: false };
}

function nextTicketNumber(sectorId, now = isoNow()) {
  const businessDate = businessDateFor(now);
  const current = db.prepare("SELECT * FROM ticket_counters WHERE sector_id = ?").get(sectorId);
  const shouldReset = !current || current.business_date !== businessDate || Number(current.last_number) >= TICKET_MAX_NUMBER;
  const nextNumber = shouldReset ? TICKET_MIN_NUMBER : Number(current.last_number) + 1;

  db.prepare(`
    INSERT INTO ticket_counters (sector_id, business_date, last_number, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(sector_id) DO UPDATE SET
      business_date = excluded.business_date,
      last_number = excluded.last_number,
      updated_at = excluded.updated_at
  `).run(sectorId, businessDate, nextNumber, now);

  return nextNumber;
}

function nextQueueOrder(sectorId) {
  return db.prepare("SELECT COALESCE(MAX(queue_order), 0) + 1 AS next_order FROM tickets WHERE sector_id = ?").get(sectorId).next_order;
}

function callNextTicket(sectorId, options = {}) {
  const sector = getSector(sectorId);
  if (!sector) return fail("Setor não encontrado.");
  if (sector.status !== "open") return fail("Setor fechado.");
  const active = getActiveSectorTicket(sectorId);
  if (active) return fail(`Finalize a senha ${active.code} antes de chamar a proxima.`);

  const eligibilityClause = options.requireEligible ? "AND COALESCE(eligible_at, created_at) <= ?" : "";
  const params = options.requireEligible
    ? [sectorId, ...CALL_ELIGIBLE_STATUSES, isoNow()]
    : [sectorId, ...CALL_ELIGIBLE_STATUSES];
  const queue = db.prepare(`
    SELECT * FROM tickets
    WHERE sector_id = ? AND status IN (${placeholders(CALL_ELIGIBLE_STATUSES)})
    ${eligibilityClause}
    ORDER BY priority DESC, queue_order ASC
  `).all(...params);

  for (const candidate of queue) {
    const conflict = getBlockingTicket(candidate);
    if (conflict) {
      const now = isoNow();
      db.prepare(`
        UPDATE tickets
        SET status = ?, smart_wait_reason = ?, blocked_by_ticket_id = ?, smart_wait_since = ?, updated_at = ?
        WHERE id = ?
      `).run("espera_inteligente", `Cliente já possui a senha ${conflict.code} em atendimento ou chamada.`, conflict.id, now, now, candidate.id);
      registerEvent("espera_inteligente_iniciada", "ticket", candidate.id, candidate.customer_id, candidate.sector_id, { blockedByTicketId: conflict.id });
      continue;
    }

    const now = isoNow();
    db.prepare("UPDATE tickets SET status = ?, called_at = ?, updated_at = ? WHERE id = ?").run("chamado", now, now, candidate.id);
    db.prepare("INSERT INTO calls (id, ticket_id, sector_id, action, created_at) VALUES (?, ?, ?, ?, ?)").run(`call-${crypto.randomUUID()}`, candidate.id, sectorId, "senha_chamada", now);
    registerEvent("senha_chamada", "ticket", candidate.id, candidate.customer_id, candidate.sector_id, { code: candidate.code });
    return { ticket: ticketDto(getTicket(candidate.id)) };
  }

  return { ticket: null, message: "Nenhuma senha elegível para chamada." };
}

function autoCallReadyTickets() {
  expireStaleActiveTickets({ broadcast: false });
  let changed = false;
  for (const sector of getSectors()) {
    if (sector.status !== "open") continue;
    const active = db.prepare(`
      SELECT 1 FROM tickets
      WHERE sector_id = ? AND status IN ('chamado', 'em_atendimento')
      LIMIT 1
    `).get(sector.id);
    if (active) continue;

    const result = callNextTicket(sector.id, { requireEligible: true });
    changed = changed || Boolean(result.ticket);
  }
  if (changed) broadcast();
}

function expireAbsentCalls() {
  const cutoff = new Date(Date.now() - CALL_ABSENCE_SECONDS * 1000).toISOString();
  const expired = db.prepare("SELECT * FROM tickets WHERE status = ? AND called_at < ?").all("chamado", cutoff);
  if (!expired.length) return;

  const now = isoNow();
  expired.forEach((ticket) => {
    const absenceCount = Number(ticket.absence_count || 0) + 1;
    const nextStatus = absenceCount >= 2 ? "expirado" : "standby";
    db.prepare(`
      UPDATE tickets
      SET status = ?, absence_count = ?, expired_at = ?, called_at = NULL, queue_order = queue_order + 1000, updated_at = ?
      WHERE id = ?
    `).run(nextStatus, absenceCount, now, now, ticket.id);
    registerEvent(nextStatus === "expirado" ? "senha_expirada_por_ausencia" : "senha_em_standby_por_ausencia", "ticket", ticket.id, ticket.customer_id, ticket.sector_id, { absenceCount });
  });
  broadcast();
}

function expireStaleActiveTickets(options = {}) {
  const today = businessDateFor();
  const active = db.prepare(`
    SELECT * FROM tickets
    WHERE status IN (${placeholders(ACTIVE_STATUSES)})
  `).all(...ACTIVE_STATUSES);
  const stale = active.filter((ticket) => businessDateFor(ticket.created_at) !== today);
  if (!stale.length) return;

  const now = isoNow();
  runInTransaction(() => {
    stale.forEach((ticket) => {
      db.prepare(`
        UPDATE tickets
        SET status = ?, expired_at = ?, called_at = NULL, smart_wait_reason = NULL,
            blocked_by_ticket_id = NULL, smart_wait_since = NULL, updated_at = ?
        WHERE id = ?
      `).run("expirado", now, now, ticket.id);
      registerEvent("senha_expirada_por_reset_diario", "ticket", ticket.id, ticket.customer_id, ticket.sector_id, { code: ticket.code });
    });
  });
  if (options.broadcast !== false) broadcast();
}

function confirmTicket(ticketId) {
  const ticket = getTicket(ticketId);
  if (!ticket) return fail("Senha não encontrada.");
  if (ticket.status !== "chamado") return fail("A senha precisa estar chamada para iniciar atendimento.");

  const blocking = db.prepare(`
    SELECT * FROM tickets
    WHERE id <> ? AND customer_id = ? AND status = ?
    LIMIT 1
  `).get(ticket.id, ticket.customer_id, "em_atendimento");

  if (blocking) return fail("Cliente já possui outro atendimento em andamento.");

  const now = isoNow();
  db.prepare("UPDATE tickets SET status = ?, service_started_at = ?, updated_at = ? WHERE id = ?").run("em_atendimento", now, now, ticket.id);
  db.prepare("INSERT INTO services (id, ticket_id, sector_id, customer_id, started_at) VALUES (?, ?, ?, ?, ?)").run(`service-${crypto.randomUUID()}`, ticket.id, ticket.sector_id, ticket.customer_id, now);
  registerEvent("atendimento_iniciado", "ticket", ticket.id, ticket.customer_id, ticket.sector_id, { code: ticket.code });
  return { ticket: ticketDto(getTicket(ticket.id)) };
}

function cancelTicket(ticketId, customerId) {
  const ticket = getTicket(ticketId);
  if (!ticket || ticket.customer_id !== customerId) return fail("Senha nÃ£o encontrada.");
  if (!CUSTOMER_CANCELABLE_STATUSES.includes(ticket.status)) {
    return fail("Esta senha nÃ£o pode mais ser cancelada pelo cliente.");
  }

  const released = runInTransaction(() => {
    const now = isoNow();
    db.prepare(`
      UPDATE tickets
      SET status = ?, canceled_at = ?, called_at = NULL, smart_wait_reason = NULL,
          blocked_by_ticket_id = NULL, smart_wait_since = NULL, updated_at = ?
      WHERE id = ?
    `).run("cancelado", now, now, ticket.id);
    registerEvent("senha_cancelada_pelo_cliente", "ticket", ticket.id, ticket.customer_id, ticket.sector_id, { code: ticket.code, previousStatus: ticket.status });

    if (CALL_BLOCKING_STATUSES.includes(ticket.status)) {
      return releaseSmartWaitTicket(ticket.customer_id);
    }
    return null;
  });

  return {
    canceledTicket: ticketDto(getTicket(ticket.id)),
    releasedTicket: released ? ticketDto(released) : null
  };
}

function finishTicket(ticketId) {
  const ticket = getTicket(ticketId);
  if (!ticket) return fail("Senha não encontrada.");
  if (ticket.status !== "em_atendimento") return fail("A senha precisa estar em atendimento para finalizar pedido.");

  return runInTransaction(() => {
    const now = isoNow();
    db.prepare("UPDATE tickets SET status = ?, finished_at = ?, updated_at = ? WHERE id = ?").run("atendido", now, now, ticket.id);
    db.prepare("UPDATE services SET finished_at = ? WHERE ticket_id = ? AND finished_at IS NULL").run(now, ticket.id);
    db.prepare("UPDATE sectors SET current_number = MAX(current_number, ?), updated_at = ? WHERE id = ?").run(ticket.number, now, ticket.sector_id);
    registerEvent("pedido_finalizado", "ticket", ticket.id, ticket.customer_id, ticket.sector_id, { code: ticket.code });

    const released = releaseSmartWaitTicket(ticket.customer_id);
    const nextInSector = callNextTicket(ticket.sector_id);
    return {
      finishedTicket: ticketDto(getTicket(ticket.id)),
      releasedTicket: released ? ticketDto(released) : null,
      nextTicket: nextInSector?.ticket || null
    };
  });
}

function releaseSmartWaitTicket(customerId) {
  const next = db.prepare(`
    SELECT * FROM tickets
    WHERE customer_id = ? AND status = ?
    ORDER BY COALESCE(smart_wait_since, created_at) ASC
    LIMIT 1
  `).get(customerId, "espera_inteligente");

  if (!next) return null;

  const now = isoNow();
  db.prepare(`
    UPDATE tickets
    SET status = ?, called_at = ?, smart_wait_reason = NULL, blocked_by_ticket_id = NULL, smart_wait_since = NULL, updated_at = ?
    WHERE id = ?
  `).run("chamado", now, now, next.id);
  db.prepare("INSERT INTO calls (id, ticket_id, sector_id, action, created_at) VALUES (?, ?, ?, ?, ?)").run(`call-${crypto.randomUUID()}`, next.id, next.sector_id, "senha_chamada", now);
  registerEvent("espera_inteligente_liberada", "ticket", next.id, next.customer_id, next.sector_id, { code: next.code });
  registerEvent("senha_chamada", "ticket", next.id, next.customer_id, next.sector_id, { code: next.code, source: "fim_do_pedido_anterior" });
  return getTicket(next.id);
}

function updateSector(sectorId, body) {
  const sector = getSector(sectorId);
  if (!sector) return fail("Setor não encontrado.");

  const next = {
    name: String(body.name || sector.name).trim(),
    counterLabel: String(body.counterLabel || sector.counter_label).trim(),
    serviceLabel: String(body.serviceLabel || sector.service_label).trim(),
    queueSize: toPositiveInt(body.queueSize, sector.queue_size),
    averageServiceSeconds: toPositiveInt(body.averageServiceSeconds, sector.average_service_seconds),
    capacity: toPositiveInt(body.capacity, sector.capacity),
    status: ["open", "paused", "closed"].includes(body.status) ? body.status : sector.status
  };

  db.prepare(`
    UPDATE sectors
    SET name = ?, counter_label = ?, service_label = ?, queue_size = ?, average_service_seconds = ?, capacity = ?, status = ?, updated_at = ?
    WHERE id = ?
  `).run(next.name, next.counterLabel, next.serviceLabel, next.queueSize, next.averageServiceSeconds, next.capacity, next.status, isoNow(), sectorId);
  registerEvent("setor_atualizado", "sector", sectorId, null, sectorId, next);
  return { sector: sectorDto(getSector(sectorId)) };
}

function createRating(body) {
  const id = `rating-${crypto.randomUUID()}`;
  const now = isoNow();
  db.prepare("INSERT INTO ratings (id, customer_id, ticket_id, score, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, cleanId(body.customerId) || "anonymous", cleanId(body.ticketId), String(body.score || "sem_nota"), String(body.comment || ""), now);
  registerEvent("avaliacao_recebida", "rating", id, cleanId(body.customerId), null, { score: body.score });
  return { id, createdAt: now };
}

function getCart(customerId) {
  if (!customerId) return { items: [] };
  const items = db.prepare("SELECT * FROM cart_items WHERE customer_id = ? ORDER BY created_at ASC").all(customerId).map(cartItemDto);
  return { items };
}

function addCartItem(body) {
  const customerId = cleanId(body.customerId);
  const productId = cleanId(body.productId);
  if (!customerId || !productId) return fail("Cliente e produto são obrigatórios.");

  const existing = db.prepare("SELECT * FROM cart_items WHERE customer_id = ? AND product_id = ?").get(customerId, productId);
  const now = isoNow();
  if (existing) {
    db.prepare("UPDATE cart_items SET quantity = quantity + 1, updated_at = ? WHERE id = ?").run(now, existing.id);
    registerEvent("carrinho_item_incrementado", "cart_item", existing.id, customerId, null, { productId });
    return { item: cartItemDto(db.prepare("SELECT * FROM cart_items WHERE id = ?").get(existing.id)) };
  }

  const id = `cart-${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO cart_items (id, customer_id, product_id, product_name, sector_name, price, quantity, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, customerId, productId, String(body.productName || "Produto"), String(body.sectorName || "Oferta"), String(body.price || ""), 1, now, now);
  registerEvent("carrinho_item_adicionado", "cart_item", id, customerId, null, { productId });
  return { item: cartItemDto(db.prepare("SELECT * FROM cart_items WHERE id = ?").get(id)) };
}

function removeCartItem(itemId, customerId) {
  const item = db.prepare("SELECT * FROM cart_items WHERE id = ? AND customer_id = ?").get(itemId, customerId);
  if (!item) return fail("Item não encontrado.");
  db.prepare("DELETE FROM cart_items WHERE id = ?").run(itemId);
  registerEvent("carrinho_item_removido", "cart_item", itemId, customerId, null, { productId: item.product_id });
  return { ok: true };
}

function getCustomerHistory(customerId) {
  if (!customerId) return { tickets: [], ratings: [] };
  const tickets = db.prepare(`
    SELECT * FROM tickets
    WHERE customer_id = ? AND status NOT IN (${placeholders(ACTIVE_STATUSES)})
    ORDER BY COALESCE(finished_at, expired_at, updated_at) DESC
    LIMIT 30
  `).all(customerId, ...ACTIVE_STATUSES).map(ticketDto);
  const ratings = db.prepare("SELECT * FROM ratings WHERE customer_id = ? ORDER BY created_at DESC LIMIT 30").all(customerId);
  return { tickets, ratings };
}

function getMetrics() {
  const sectors = getSectors().map((sector) => {
    const finished = db.prepare("SELECT COUNT(*) AS total FROM tickets WHERE sector_id = ? AND status = 'atendido'").get(sector.id).total;
    const abandoned = db.prepare("SELECT COUNT(*) AS total FROM tickets WHERE sector_id = ? AND status IN ('expirado', 'cancelado')").get(sector.id).total;
    const smartWaitRows = db.prepare("SELECT smart_wait_since, called_at FROM tickets WHERE sector_id = ? AND smart_wait_since IS NOT NULL").all(sector.id);
    const avgSmartWaitSeconds = average(smartWaitRows.map((row) => secondsBetween(row.smart_wait_since, row.called_at || isoNow())));
    const serviceRows = db.prepare("SELECT service_started_at, finished_at FROM tickets WHERE sector_id = ? AND service_started_at IS NOT NULL AND finished_at IS NOT NULL").all(sector.id);
    const avgServiceSeconds = average(serviceRows.map((row) => secondsBetween(row.service_started_at, row.finished_at)));
    return {
      id: sector.id,
      name: sector.name,
      finished,
      abandoned,
      avgServiceSeconds,
      avgSmartWaitSeconds
    };
  });
  const ratings = db.prepare("SELECT score FROM ratings").all();
  return {
    sectors,
    satisfaction: satisfactionSummary(ratings),
    generatedAt: isoNow()
  };
}

function getCustomerState(customerId) {
  expireStaleActiveTickets({ broadcast: false });
  const sectors = getSectors().map(sectorDto);
  const tickets = customerId
    ? db.prepare(`
        SELECT * FROM tickets
        WHERE customer_id = ? AND status IN (${placeholders(ACTIVE_STATUSES)})
        ORDER BY created_at ASC
      `).all(customerId, ...ACTIVE_STATUSES).map(ticketDto)
    : [];

  return { serverTime: isoNow(), sectors, tickets };
}

function getStaffState(user = null) {
  expireStaleActiveTickets({ broadcast: false });
  const visibleSectors = getSectors().filter((sector) => !user || canAccessSector(user, sector.id));
  const sectors = visibleSectors.map((sector) => {
    const tickets = db.prepare(`
      SELECT * FROM tickets
      WHERE sector_id = ? AND status IN (${placeholders(ACTIVE_STATUSES)})
      ORDER BY priority DESC, queue_order ASC
    `).all(sector.id, ...ACTIVE_STATUSES).map(ticketDto);
    return { ...sectorDto(sector), tickets };
  });

  return { serverTime: isoNow(), sectors };
}

function ticketDto(row) {
  if (!row) return null;
  const sector = getSector(row.sector_id);
  const ahead = countAhead(row);
  const isWaiting = CALL_ELIGIBLE_STATUSES.includes(row.status);
  const position = isWaiting ? ahead + 1 : 1;
  const averageSeconds = effectiveAverageServiceSeconds(sector);
  const activeDelay = isWaiting ? activeServiceDelaySeconds(sector.id, averageSeconds) : 0;
  const eligibleDelay = isWaiting ? secondsUntil(row.eligible_at || row.created_at) : 0;
  const secondsToCall = isWaiting ? Math.max(eligibleDelay, activeDelay + ahead * averageSeconds) : 0;
  const estimatedCallAt = isWaiting
    ? new Date(Date.now() + secondsToCall * 1000).toISOString()
    : null;
  const countdownTotalSeconds = isWaiting
    ? Math.max(secondsToCall, secondsBetween(row.created_at, estimatedCallAt))
    : 0;

  return {
    id: row.id,
    customerId: row.customer_id,
    deviceId: row.device_id,
    sectorId: row.sector_id,
    sector: sector.name,
    ticket: row.code,
    current: currentCode(sector),
    counterLabel: sector.counter_label,
    serviceLabel: sector.service_label,
    status: row.status,
    priority: Boolean(row.priority),
    priorityReason: row.priority_reason,
    position,
    ahead,
    secondsToCall,
    countdownTotalSeconds,
    estimatedCallAt,
    progress: progressFor(row.status, position),
    smartWaitReason: row.smart_wait_reason,
    locationVerified: Boolean(row.location_verified),
    qrVerified: Boolean(row.qr_verified),
    locationDistanceMeters: row.location_distance_meters,
    absenceCount: row.absence_count || 0,
    calledAt: row.called_at,
    eligibleAt: row.eligible_at,
    serviceStartedAt: row.service_started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at
  };
}

function sectorDto(row) {
  const averageServiceSeconds = effectiveAverageServiceSeconds(row);
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    counterLabel: row.counter_label,
    serviceLabel: row.service_label,
    queueSize: row.queue_size,
    averageServiceSeconds,
    capacity: row.capacity,
    status: row.status,
    current: currentCode(row)
  };
}

function cartItemDto(row) {
  return {
    id: row.id,
    customerId: row.customer_id,
    productId: row.product_id,
    productName: row.product_name,
    sectorName: row.sector_name,
    price: row.price,
    quantity: row.quantity,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function getSectors() {
  return db.prepare("SELECT * FROM sectors ORDER BY rowid ASC").all();
}

function getSector(id) {
  return db.prepare("SELECT * FROM sectors WHERE id = ?").get(id);
}

function getTicket(id) {
  return db.prepare("SELECT * FROM tickets WHERE id = ?").get(id);
}

function getBlockingTicket(candidate) {
  return db.prepare(`
    SELECT * FROM tickets
    WHERE id <> ? AND (customer_id = ? OR device_id = ?) AND status IN (${placeholders(CALL_BLOCKING_STATUSES)})
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(candidate.id, candidate.customer_id, candidate.device_id, ...CALL_BLOCKING_STATUSES);
}

function getActiveSectorTicket(sectorId) {
  return db.prepare(`
    SELECT * FROM tickets
    WHERE sector_id = ? AND status IN (${placeholders(CALL_BLOCKING_STATUSES)})
    ORDER BY COALESCE(service_started_at, called_at, updated_at) DESC
    LIMIT 1
  `).get(sectorId, ...CALL_BLOCKING_STATUSES);
}

function countAhead(ticket) {
  if (!CALL_ELIGIBLE_STATUSES.includes(ticket.status)) return 0;
  return db.prepare(`
    SELECT COUNT(*) AS total FROM tickets
    WHERE sector_id = ?
      AND status IN (${placeholders(CALL_ELIGIBLE_STATUSES)})
      AND (
        priority > ?
        OR (priority = ? AND queue_order < ?)
      )
  `).get(ticket.sector_id, ...CALL_ELIGIBLE_STATUSES, Number(ticket.priority || 0), Number(ticket.priority || 0), ticket.queue_order).total;
}

function activeServiceDelaySeconds(sectorId, averageSeconds) {
  const active = db.prepare(`
    SELECT * FROM tickets
    WHERE sector_id = ? AND status IN ('em_atendimento', 'chamado')
    ORDER BY COALESCE(service_started_at, called_at, updated_at) DESC
    LIMIT 1
  `).get(sectorId);

  if (!active) return 0;
  const startedAt = active.service_started_at || active.called_at || active.updated_at;
  const elapsed = secondsBetween(startedAt, isoNow());
  const limit = active.status === "chamado" ? CALL_ABSENCE_SECONDS : averageSeconds;
  return Math.max(0, limit - elapsed);
}

function effectiveAverageServiceSeconds(sector) {
  const rows = db.prepare(`
    SELECT service_started_at, finished_at FROM tickets
    WHERE sector_id = ? AND service_started_at IS NOT NULL AND finished_at IS NOT NULL
    ORDER BY finished_at DESC
    LIMIT 20
  `).all(sector.id);
  const measured = average(rows.map((row) => secondsBetween(row.service_started_at, row.finished_at)));
  return measured || sector.average_service_seconds;
}

function currentCode(sector) {
  const active = db.prepare(`
    SELECT code FROM tickets
    WHERE sector_id = ? AND status IN ('em_atendimento', 'chamado')
    ORDER BY COALESCE(service_started_at, called_at, updated_at) DESC
    LIMIT 1
  `).get(sector.id);
  const counter = db.prepare("SELECT * FROM ticket_counters WHERE sector_id = ?").get(sector.id);
  const currentNumber = counter?.business_date === businessDateFor() ? Number(counter.last_number) : TICKET_MIN_NUMBER;
  return active?.code || formatTicket(sector.prefix, currentNumber);
}

function progressFor(status, position) {
  if (status === "em_atendimento") return 100;
  if (status === "chamado") return 95;
  if (status === "espera_inteligente") return 92;
  if (status === "standby") return 48;
  if (status === "proximo") return 82;
  return Math.max(14, Math.min(76, 80 - position * 7));
}

function registerEvent(type, entityType, entityId, customerId, sectorId, payload = {}) {
  db.prepare(`
    INSERT INTO events (id, type, entity_type, entity_id, customer_id, sector_id, payload, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(`event-${crypto.randomUUID()}`, type, entityType, entityId, customerId, sectorId, JSON.stringify(payload), isoNow());
}

function formatTicket(prefix, number) {
  return `${prefix}${String(number).padStart(3, "0")}`;
}

function isoNow() {
  return new Date().toISOString();
}

function businessDateFor(value = isoNow()) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function runInTransaction(work) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function cleanId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toPositiveInt(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function secondsBetween(start, end) {
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return 0;
  return Math.max(0, Math.round((endTime - startTime) / 1000));
}

function secondsUntil(value) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, Math.ceil((time - Date.now()) / 1000));
}

function average(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (!clean.length) return 0;
  return Math.round(clean.reduce((sum, value) => sum + value, 0) / clean.length);
}

function satisfactionSummary(rows) {
  const scoreMap = { Ruim: 1, Regular: 2, "Ótima": 3, "Ã“tima": 3 };
  const scores = rows.map((row) => scoreMap[row.score]).filter(Boolean);
  return {
    count: scores.length,
    average: scores.length ? Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2)) : 0
  };
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
}

function verifyPassword(password, salt, expectedHash) {
  const actualHash = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(actualHash, "hex"), Buffer.from(expectedHash, "hex"));
}

function safeEqual(left, right) {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function getCookie(req, name) {
  const cookies = String(req.headers.cookie || "").split(";").map((item) => item.trim());
  const match = cookies.find((item) => item.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "local").split(",")[0].trim();
}

function placeholders(values) {
  return values.map(() => "?").join(", ");
}

function fail(message) {
  return { error: message };
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendApiResult(res, status, payload) {
  sendJson(res, payload?.error ? 400 : status, payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Payload muito grande."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) return;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  });
}

module.exports = {
  applySecurityHeaders,
  handleApi
};
