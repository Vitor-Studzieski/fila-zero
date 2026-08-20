import { authenticateLocalRequest, hasValidCsrf } from "../../../../../server/local-http-auth.js";
import { unpairLocalKiosk } from "../../../../../server/local-kiosk.js";
import { clearKioskCookies } from "../../../../../server/print-kiosk-service.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  if (process.env.DATA_BACKEND !== "local-postgres" || process.env.LOCAL_POSTGRES_ROUTES_ENABLED !== "1") return Response.json({ error: "Rota PostgreSQL local desativada." }, { status: 404 });
  const { session } = await authenticateLocalRequest(request);
  if (!session) return Response.json({ error: "Sessao nao encontrada." }, { status: 401 });
  if (!["manager", "admin"].includes(session.user.role)) return Response.json({ error: "Acesso negado." }, { status: 403 });
  if (!hasValidCsrf(request, session)) return Response.json({ error: "Token CSRF invalido." }, { status: 403 });
  try {
    await unpairLocalKiosk(session.user);
    const headers = new Headers();
    for (const cookie of clearKioskCookies(false)) headers.append("set-cookie", cookie);
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    return Response.json({ error: error.message || "Nao foi possivel desvincular o totem." }, { status: 400 });
  }
}
