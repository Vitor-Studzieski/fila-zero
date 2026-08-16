import { NextResponse } from "next/server";

const protectedPages = new Set([
  "/",
  "/attendant",
  "/admin",
  "/admin/operacao",
  "/admin/setores",
  "/admin/totens",
  "/admin/usuarios",
  "/iccf"
]);
const pageRoles = {
  "/": ["customer", "manager", "admin"],
  "/attendant": ["attendant", "manager", "admin"],
  "/admin": ["manager", "admin"],
  "/admin/operacao": ["manager", "admin"],
  "/admin/setores": ["manager", "admin"],
  "/admin/totens": ["manager", "admin"],
  "/admin/usuarios": ["manager", "admin"],
  "/iccf": ["manager", "admin"]
};

export async function proxy(request) {
  const { pathname } = request.nextUrl;
  if (!protectedPages.has(pathname)) return NextResponse.next();

  // The signed cookie is only a bearer credential. The role is read again
  // through the protected API so a role/status change is not accepted until
  // the next long-lived cookie refresh.
  const user = await loadCurrentUser(request);
  if (user && pageRoles[pathname]?.includes(normalizeRole(user.role))) return NextResponse.next();
  if (user) return NextResponse.redirect(new URL(roleHome(user), request.url));

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

async function loadCurrentUser(request) {
  try {
    const response = await fetch(new URL("/api/auth/me", request.url), {
      headers: { cookie: request.headers.get("cookie") || "" },
      cache: "no-store"
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload?.user || null;
  } catch {
    return null;
  }
}

async function verifySessionToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts[0] !== "session") return null;
  const [, encoded, signature] = parts;
  const expected = await signValue(encoded);
  if (!safeEqual(signature, expected)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encoded)));
    if (!payload.email || !payload.csrfToken || new Date(payload.expiresAt).getTime() <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

async function signValue(value) {
  const secret = authSecret();
  if (!secret) return "";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

function authSecret() {
  const secret = process.env.AUTH_SECRET || "";
  if (secret.length >= 32) return secret;
  if (process.env.NODE_ENV !== "production") return "senhahub-demo-auth-secret-change-before-production";
  return "";
}

function safeEqual(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

function base64UrlToBytes(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bytesToBase64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function normalizeRole(role) {
  return role === "admin" ? "manager" : role;
}

function roleHome(user) {
  return normalizeRole(user.role) === "attendant" ? "/attendant" : "/";
}

export const config = {
  matcher: [
    "/",
    "/attendant",
    "/admin",
    "/admin/operacao",
    "/admin/setores",
    "/admin/totens",
    "/admin/usuarios",
    "/iccf"
  ]
};
