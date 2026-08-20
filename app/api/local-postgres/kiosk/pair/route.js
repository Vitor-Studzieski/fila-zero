import { authenticateLocalRequest, hasValidCsrf } from "../../../../../server/local-http-auth.js";
import { getLocalKioskStatus, pairLocalKiosk } from "../../../../../server/local-kiosk.js";
import { kioskCookies } from "../../../../../server/print-kiosk-service.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  if (process.env.DATA_BACKEND !== "local-postgres" || process.env.LOCAL_POSTGRES_ROUTES_ENABLED !== "1") return Response.json({ error: "Rota PostgreSQL local desativada." }, { status: 404 });
  const { session } = await authenticateLocalRequest(request);
  if (!session) return Response.json({ error: "Sessao nao encontrada." }, { status: 401 });
  if (!["manager", "admin"].includes(session.user.role)) return Response.json({ error: "Acesso negado." }, { status: 403 });
  if (!hasValidCsrf(request, session)) return Response.json({ error: "Token CSRF invalido." }, { status: 403 });
  let body = {};
  try { body = await request.json(); } catch { /* body opcional */ }
  try {
    const kioskSession = await pairLocalKiosk(session.user, body);
    const payload = await getLocalKioskStatus(request, session.user, kioskSession);
    const headers = new Headers({ "cache-control": "no-store" });
    for (const cookie of kioskCookies(kioskSession, process.env.NODE_ENV === "production")) headers.append("set-cookie", cookie);
    return Response.json(payload, { status: 200, headers });
  } catch (error) {
    return Response.json({ error: error.message || "Nao foi possivel vincular o totem." }, { status: 400 });
  }
}
