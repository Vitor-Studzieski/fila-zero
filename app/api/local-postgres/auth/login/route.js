import { consumeLocalRateLimit, loginLocalUser } from "../../../../../server/local-auth.js";
import { clientIp } from "../../../../../server/local-http-auth.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SESSION_TTL_SECONDS = 12 * 60 * 60;

export async function POST(request) {
  if (process.env.DATA_BACKEND !== "local-postgres" || process.env.LOCAL_POSTGRES_ROUTES_ENABLED !== "1") {
    return Response.json({ error: "Rota PostgreSQL local desativada." }, { status: 404 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "O corpo da requisição precisa ser um JSON válido." }, { status: 400 });
  }

  const email = String(body?.email || "").trim().toLowerCase();
  const requestIp = clientIp(request);
  if (!await consumeLocalRateLimit("local-login-ip", requestIp, 60, 15 * 60)) {
    return Response.json({ error: "Muitas tentativas. Aguarde alguns minutos." }, { status: 429 });
  }
  const result = await loginLocalUser({
    email,
    password: body?.password,
    attemptKey: `${requestIp}:${email || "unknown"}`
  });

  if (result.error) {
    return Response.json({ error: result.error }, { status: 401 });
  }

  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8"
  });
  const forwardedProtocol = String(request.headers.get("x-forwarded-proto") || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  const requestProtocol = forwardedProtocol || new URL(request.url).protocol;
  const secure = requestProtocol === "https:" ? "; Secure" : "";
  headers.append(
    "set-cookie",
    `senhahub_local_auth=${encodeURIComponent(result.sessionToken)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secure}`
  );
  headers.append(
    "set-cookie",
    `senhahub_local_csrf=${encodeURIComponent(result.csrfToken)}; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secure}`
  );
  headers.append(
    "set-cookie",
    `senhahub_csrf=${encodeURIComponent(result.csrfToken)}; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secure}`
  );

  return new Response(JSON.stringify({
    user: result.user,
    csrfToken: result.csrfToken,
    expiresAt: result.expiresAt
  }), { status: 200, headers });
}
