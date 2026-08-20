import { revokeLocalSession } from "../../../../../server/local-auth.js";
import {
  authenticateLocalRequest,
  clearAuthCookies,
  hasValidCsrf
} from "../../../../../server/local-http-auth.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  if (process.env.DATA_BACKEND !== "local-postgres" || process.env.LOCAL_POSTGRES_ROUTES_ENABLED !== "1") {
    return Response.json({ error: "Rota PostgreSQL local desativada." }, { status: 404 });
  }

  const { session, sessionToken } = await authenticateLocalRequest(request);
  if (session && !hasValidCsrf(request, session)) {
    return Response.json({ error: "Token CSRF inválido." }, { status: 403 });
  }

  if (sessionToken) await revokeLocalSession(sessionToken);

  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8"
  });
  clearAuthCookies(headers);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}
