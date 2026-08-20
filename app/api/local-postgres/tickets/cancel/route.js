import { cancelTicket } from "../../../../../server/local-repository.js";
import {
  authenticateLocalRequest,
  hasValidCsrf
} from "../../../../../server/local-http-auth.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  if (process.env.DATA_BACKEND !== "local-postgres" || process.env.LOCAL_POSTGRES_ROUTES_ENABLED !== "1") {
    return Response.json({ error: "Rota PostgreSQL local desativada." }, { status: 404 });
  }

  const { session } = await authenticateLocalRequest(request);
  if (!session) return Response.json({ error: "Sessão não encontrada." }, { status: 401 });
  if (!hasValidCsrf(request, session)) {
    return Response.json({ error: "Token CSRF inválido." }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "O corpo da requisição precisa ser um JSON válido." }, { status: 400 });
  }

  try {
    const result = await cancelTicket(body?.ticketId, session.user.customerId);
    return Response.json({ source: "postgres-local", ticket: result.ticket }, { status: 200 });
  } catch (error) {
    const message = String(error?.message || "Não foi possível cancelar a senha.");
    return Response.json({ error: message }, { status: 400 });
  }
}
