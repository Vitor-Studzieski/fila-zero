const crypto = require("node:crypto");

const KIOSK_SESSION_SECONDS = 60 * 60 * 24 * 30;
const DEFAULT_KIOSK_ID = "totem-pompeia-01";
const DEFAULT_INSTALL_URL = "https://senhahub.vercel.app/instalar";
const DEFAULT_APP_URL = "https://senhahub.vercel.app";

function loadKioskConfiguration(env = process.env) {
  const appUrl = normalizeHttpsUrl(env.PUBLIC_APP_URL) || "https://senhahub.vercel.app";
  const mode = ["central", "sector"].includes(String(env.KIOSK_MODE || "").trim().toLowerCase())
    ? String(env.KIOSK_MODE).trim().toLowerCase()
    : "central";
  return {
    id: cleanId(env.KIOSK_ID) || DEFAULT_KIOSK_ID,
    name: cleanText(env.KIOSK_NAME, 120) || "Totem Supermercado Pompeia",
    appUrl: appUrl || DEFAULT_APP_URL,
    mode,
    sectorId: mode === "sector" ? cleanId(env.KIOSK_SECTOR_ID) : "",
    printerName: cleanText(env.KIOSK_PRINTER_NAME, 160) || "Bematech MP - 4200 TH",
    printerPort: cleanText(env.KIOSK_PRINTER_PORT, 40) || "COM3",
    paperWidthMm: Number(env.KIOSK_PAPER_WIDTH_MM) === 58 ? 58 : 80,
    installUrl: normalizeHttpsUrl(env.PUBLIC_INSTALL_URL)
      || `${appUrl.replace(/\/+$/, "")}/instalar`
      || DEFAULT_INSTALL_URL
  };
}

function createKioskSession(kioskId, secret, now = Date.now()) {
  const csrfToken = crypto.randomBytes(32).toString("hex");
  const payload = {
    kioskId: cleanId(kioskId),
    csrfToken,
    expiresAt: new Date(now + KIOSK_SESSION_SECONDS * 1000).toISOString()
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return {
    kioskId: payload.kioskId,
    token: `kiosk.${encoded}.${sign(encoded, secret)}`,
    csrfToken,
    expiresAt: payload.expiresAt
  };
}

function verifyKioskSession(token, secret, now = Date.now()) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts[0] !== "kiosk") return null;
  const [, encoded, signature] = parts;
  if (!safeEqual(signature, sign(encoded, secret))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!cleanId(payload.kioskId) || !payload.csrfToken) return null;
    if (new Date(payload.expiresAt).getTime() <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

function kioskCookies(session, production = false) {
  const secure = production ? "; Secure" : "";
  return [
    `senhahub_kiosk=${encodeURIComponent(session.token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${KIOSK_SESSION_SECONDS}${secure}`,
    `senhahub_kiosk_csrf=${encodeURIComponent(session.csrfToken)}; SameSite=Strict; Path=/; Max-Age=${KIOSK_SESSION_SECONDS}${secure}`
  ];
}

function clearKioskCookies(production = false) {
  const secure = production ? "; Secure" : "";
  return [
    `senhahub_kiosk=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`,
    `senhahub_kiosk_csrf=; SameSite=Strict; Path=/; Max-Age=0${secure}`
  ];
}

function verifyKioskRequest(headers, secret) {
  const cookieHeader = headerValue(headers, "cookie");
  const session = verifyKioskSession(getCookie(cookieHeader, "senhahub_kiosk"), secret);
  if (!session) return { error: "Totem nao vinculado.", status: 401 };
  const headerToken = headerValue(headers, "x-kiosk-csrf");
  const cookieToken = getCookie(cookieHeader, "senhahub_kiosk_csrf");
  if (!safeEqual(headerToken, session.csrfToken) || !safeEqual(cookieToken, session.csrfToken)) {
    return { error: "Token de seguranca do totem invalido.", status: 403 };
  }
  return session;
}

function verifyPrintAgentRequest(headers, env = process.env) {
  const configured = String(env.PRINT_AGENT_TOKEN || "");
  if (configured.length < 32) {
    return { error: "Agente de impressao nao configurado.", status: 503 };
  }
  const received = headerValue(headers, "x-print-agent-token");
  if (!safeEqual(received, configured)) {
    return { error: "Credencial do agente invalida.", status: 401 };
  }
  return { ok: true };
}

function validatePhysicalTicketInput(body = {}) {
  const sectorId = cleanId(body.sectorId);
  const idempotencyKey = String(body.idempotencyKey || "").trim();
  if (!sectorId) return { error: "Selecione um setor." };
  if (!/^[A-Za-z0-9_-]{16,160}$/.test(idempotencyKey)) {
    return { error: "Identificador da emissao invalido." };
  }
  return { sectorId, idempotencyKey };
}

function printJobDto(row) {
  // PostgREST can represent a NULL composite value returned by an RPC as an
  // empty object. It means there is no job to claim, not a printable job.
  if (!row || !row.id) return null;
  const payload = parsePayload(row.payload);
  return {
    id: row.id,
    ticketId: row.ticket_id,
    kioskId: row.kiosk_id,
    status: row.status,
    attempts: Number(row.attempts || 0),
    payload,
    claimedAt: row.claimed_at,
    printedAt: row.printed_at,
    failedAt: row.failed_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parsePayload(payload) {
  if (!payload) return {};
  if (typeof payload === "object") return payload;
  try {
    return JSON.parse(payload);
  } catch {
    return {};
  }
}

function getCookie(cookieHeader, name) {
  const item = String(cookieHeader || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : "";
}

function headerValue(headers, name) {
  if (typeof headers?.get === "function") return String(headers.get(name) || "");
  return String(headers?.[name] || headers?.[name.toLowerCase()] || "");
}

function normalizeHttpsUrl(value) {
  const input = String(value || "").trim();
  if (!input) return "";
  try {
    const url = new URL(input);
    return url.protocol === "https:" ? url.toString().replace(/\/+$/, "") : "";
  } catch {
    return "";
  }
}

function cleanId(value) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
}

function cleanText(value, maxLength) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function sign(value, secret) {
  return crypto.createHmac("sha256", String(secret || "")).update(value).digest("base64url");
}

function safeEqual(left, right) {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

module.exports = {
  clearKioskCookies,
  createKioskSession,
  kioskCookies,
  loadKioskConfiguration,
  printJobDto,
  validatePhysicalTicketInput,
  verifyKioskRequest,
  verifyKioskSession,
  verifyPrintAgentRequest
};
