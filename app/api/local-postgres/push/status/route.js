import { authenticateLocalRequest } from "../../../../../server/local-http-auth.js";
import { getLocalPushStatus } from "../../../../../server/local-push.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  if (process.env.DATA_BACKEND !== "local-postgres" || process.env.LOCAL_POSTGRES_ROUTES_ENABLED !== "1") return Response.json({ error: "Rota PostgreSQL local desativada." }, { status: 404 });
  const { session } = await authenticateLocalRequest(request);
  if (!session) return Response.json({ error: "Sessao nao encontrada." }, { status: 401 });
  if (!["customer", "manager", "admin"].includes(session.user.role)) return Response.json({ error: "Acesso negado." }, { status: 403 });
  return Response.json(await getLocalPushStatus(session.user.id, process.env.NODE_ENV !== "production" || ["manager", "admin"].includes(session.user.role)));
}
