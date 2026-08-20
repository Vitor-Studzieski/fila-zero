import { finishLocalTicket } from "../../../../../server/local-repository.js";
import { dispatchLocalPushEvent } from "../../../../../server/local-push.js";
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
  if (!["customer", "attendant", "manager", "admin"].includes(session.user.role)) {
    return Response.json({ error: "Acesso negado." }, { status: 403 });
  }
  if (!hasValidCsrf(request, session)) {
    return Response.json({ error: "Token CSRF inválido." }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  try {
    const result = await finishLocalTicket(body?.ticketId, session.user);
    if (result.releasedTicket?.customerId) {
      void dispatchLocalPushEvent({
        type: "queue_changed",
        eventKey: `local-release:${result.releasedTicket.id}:${result.releasedTicket.updatedAt || Date.now()}`,
        userId: result.releasedTicket.customerId,
        ticketId: result.releasedTicket.id,
        payloadVersion: 1,
        context: {
          customerName: result.releasedTicket.customerName,
          sector: result.releasedTicket.sector,
          url: "/?view=status"
        }
      });
    }
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: String(error?.message || "Não foi possível finalizar o atendimento.") }, { status: 400 });
  }
}
