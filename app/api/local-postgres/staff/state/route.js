import { authenticateLocalRequest } from "../../../../../server/local-http-auth.js";
import { getLocalStaffState } from "../../../../../server/local-repository.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  if (process.env.DATA_BACKEND !== "local-postgres" || process.env.LOCAL_POSTGRES_ROUTES_ENABLED !== "1") {
    return Response.json({ error: "Rota PostgreSQL local desativada." }, { status: 404 });
  }
  const { session } = await authenticateLocalRequest(request);
  if (!session) return Response.json({ error: "Sessão não encontrada." }, { status: 401 });
  if (!["attendant", "manager", "admin"].includes(session.user.role)) {
    return Response.json({ error: "Acesso negado." }, { status: 403 });
  }

  try {
    return Response.json({ source: "postgres-local", ...(await getLocalStaffState(session.user)) }, {
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    console.error("Falha ao consultar o painel de atendimento local:", error.message);
    return Response.json({ error: "Não foi possível consultar o painel de atendimento." }, { status: 500 });
  }
}
