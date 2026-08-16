const crypto = require("node:crypto");

function validateProductionEnvironment(environment = process.env) {
  const errors = [];
  const warnings = [];
  const isProduction = environment.NODE_ENV === "production";

  if (!isProduction) {
    return { ok: true, mode: "non-production", errors, warnings };
  }

  requireValue(environment, "DATA_BACKEND", "supabase", errors);
  requireValue(environment, "SUPABASE_AUTH_ENABLED", "1", errors);
  requireHttpsUrl(environment.SUPABASE_URL, "SUPABASE_URL", errors);
  requireSecret(environment.SUPABASE_ANON_KEY, "SUPABASE_ANON_KEY", errors);
  requireSecret(environment.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY", errors);
  requireSecret(environment.AUTH_SECRET, "AUTH_SECRET", errors);
  requireSecret(environment.CRON_SECRET, "CRON_SECRET", errors);
  requireDatabaseUrl(environment.DATABASE_URL, errors);
  requireHttpsUrl(environment.PUBLIC_APP_URL, "PUBLIC_APP_URL", errors);
  requireValue(environment, "SUPABASE_AUTO_CONFIRM_CUSTOMERS", "0", errors);

  if (isTruthy(environment.ALLOW_DEMO_USERS)) {
    errors.push("ALLOW_DEMO_USERS precisa estar desativado em produção.");
  }
  if (hasDemoUsers(environment.DEMO_USERS_JSON)) {
    errors.push("DEMO_USERS_JSON não pode conter contas em produção.");
  }

  requireValue(environment, "KIOSK_ID", null, errors);
  requireSecret(environment.PRINT_AGENT_TOKEN, "PRINT_AGENT_TOKEN", errors);
  requireValue(environment, "KIOSK_PRINTER_PORT", null, errors);

  if (isTruthy(environment.PUSH_NOTIFICATIONS_ENABLED)) {
    requireValue(environment, "NEXT_PUBLIC_VAPID_PUBLIC_KEY", null, errors);
    requireValue(environment, "VAPID_PRIVATE_KEY", null, errors);
    requireVapidSubject(environment.VAPID_SUBJECT, errors);
    if (decodeBase64Url(environment.NEXT_PUBLIC_VAPID_PUBLIC_KEY)?.length !== 65) {
      errors.push("NEXT_PUBLIC_VAPID_PUBLIC_KEY precisa ser uma chave VAPID válida.");
    }
    if (decodeBase64Url(environment.VAPID_PRIVATE_KEY)?.length !== 32) {
      errors.push("VAPID_PRIVATE_KEY precisa ser uma chave VAPID válida.");
    }
  } else {
    warnings.push("Web Push está desativado; habilite somente após validar VAPID e dispositivos reais.");
  }

  return { ok: errors.length === 0, mode: "production", errors, warnings };
}

function requireValue(environment, name, expected, errors) {
  const value = String(environment[name] || "").trim();
  if (!value || isPlaceholder(value)) {
    errors.push(`${name} não está configurada.`);
    return;
  }
  if (expected !== null && value !== expected) {
    errors.push(`${name} precisa ter o valor seguro esperado.`);
  }
}

function requireSecret(value, name, errors) {
  const normalized = String(value || "").trim();
  if (normalized.length < 32 || isPlaceholder(normalized)) {
    errors.push(`${name} precisa ter ao menos 32 caracteres e não pode ser um placeholder.`);
  }
}

function requireHttpsUrl(value, name, errors) {
  const normalized = String(value || "").trim();
  try {
    const url = new URL(normalized);
    if (url.protocol !== "https:") throw new Error("protocol");
  } catch {
    errors.push(`${name} precisa ser uma URL HTTPS válida.`);
  }
}

function requireDatabaseUrl(value, errors) {
  const normalized = String(value || "").trim();
  if (!/^postgres(?:ql)?:\/\//i.test(normalized) || isPlaceholder(normalized)) {
    errors.push("DATABASE_URL precisa estar configurada com uma URL PostgreSQL válida.");
  }
}

function requireVapidSubject(value, errors) {
  const normalized = String(value || "").trim();
  if (/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(normalized)) return;
  try {
    const url = new URL(normalized);
    if (url.protocol === "https:") return;
  } catch {
    // Fall through to the same safe error.
  }
  errors.push("VAPID_SUBJECT precisa ser um e-mail mailto: ou uma URL HTTPS.");
}

function hasDemoUsers(value) {
  if (!value || value === "[]") return false;
  try {
    return Array.isArray(JSON.parse(value)) && JSON.parse(value).length > 0;
  } catch {
    return true;
  }
}

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function isPlaceholder(value) {
  const normalized = String(value || "").toLowerCase();
  return [
    "troque-por-um-segredo-longo-com-32-ou-mais-caracteres",
    "troque-por-um-segredo-longo-e-exclusivo-do-cron",
    "cole-o-mesmo-segredo-configurado-na-vercel",
    "seu-dominio.com",
    "example.invalid"
  ].some((placeholder) => normalized.includes(placeholder));
}

function decodeBase64Url(value) {
  try {
    const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(value || "").length / 4) * 4, "=");
    return Buffer.from(normalized, "base64");
  } catch {
    return null;
  }
}

function healthResponse(environment = process.env) {
  const readiness = validateProductionEnvironment(environment);
  return {
    status: readiness.ok ? "ok" : "unavailable",
    ok: readiness.ok
  };
}

function safeEnvironmentFingerprint(environment = process.env) {
  const keys = [
    "SUPABASE_URL",
    "DATABASE_URL",
    "PUBLIC_APP_URL",
    "KIOSK_ID",
    "PUSH_NOTIFICATIONS_ENABLED"
  ];
  return Object.fromEntries(keys.map((key) => [
    key,
    environment[key] ? crypto.createHash("sha256").update(String(environment[key])).digest("hex").slice(0, 12) : null
  ]));
}

module.exports = {
  healthResponse,
  safeEnvironmentFingerprint,
  validateProductionEnvironment
};
