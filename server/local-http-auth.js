const crypto = require("node:crypto");
const { getLocalSession } = require("./local-auth");

const AUTH_COOKIE = "senhahub_local_auth";
const CSRF_COOKIE = "senhahub_local_csrf";
const LEGACY_CSRF_COOKIE = "senhahub_csrf";

function clientIp(request) {
  if (process.env.TRUST_PROXY_HEADERS !== "1") return "unknown";
  const forwarded = request.headers.get("cf-connecting-ip")
    || request.headers.get("x-forwarded-for")
    || request.headers.get("x-real-ip");
  return String(forwarded || "unknown").split(",")[0].trim() || "unknown";
}

function getCookie(request, name) {
  const cookieHeader = request.headers.get("cookie") || "";
  for (const chunk of cookieHeader.split(";")) {
    const separator = chunk.indexOf("=");
    if (separator <= 0) continue;

    const key = chunk.slice(0, separator).trim();
    if (key !== name) continue;

    const rawValue = chunk.slice(separator + 1).trim();
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }
  return null;
}

async function authenticateLocalRequest(request) {
  const sessionToken = getCookie(request, AUTH_COOKIE);
  const session = await getLocalSession(sessionToken);
  return { session, sessionToken };
}

function hasValidCsrf(request, session) {
  if (!session?.csrfToken) return false;

  const cookieToken = getCookie(request, CSRF_COOKIE) || getCookie(request, LEGACY_CSRF_COOKIE);
  const headerToken = request.headers.get("x-csrf-token") || "";
  return safeEqual(session.csrfToken, cookieToken) && safeEqual(session.csrfToken, headerToken);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  if (leftBuffer.length === 0 || leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function clearAuthCookies(headers) {
  headers.append("set-cookie", `${AUTH_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  headers.append("set-cookie", `${CSRF_COOKIE}=; SameSite=Strict; Path=/; Max-Age=0`);
  headers.append("set-cookie", `${LEGACY_CSRF_COOKIE}=; SameSite=Strict; Path=/; Max-Age=0`);
}

module.exports = {
  AUTH_COOKIE,
  CSRF_COOKIE,
  authenticateLocalRequest,
  clientIp,
  clearAuthCookies,
  getCookie,
  hasValidCsrf
};
