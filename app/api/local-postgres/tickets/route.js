import { createTicket, getLocalPublicTicket } from "../../../../server/local-repository.js";
import {
  authenticateLocalRequest,
  hasValidCsrf
} from "../../../../server/local-http-auth.js";

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
    const result = await createTicket({
      ...body,
      customerId: session.user.customerId,
      customerName: session.user.name
    });

    const publicTicket = await getLocalPublicTicket(result.ticket.id);
    if (!publicTicket) throw new Error("Senha não encontrada após a emissão.");
    return Response.json({
      source: "postgres-local",
      alreadyExists: result.alreadyExists,
      ticket: publicTicket
    }, { status: result.alreadyExists ? 200 : 201 });
  } catch (error) {
    const message = String(error?.message || "Não foi possível criar a senha.");
    const clientError = /obrigatório|inválido|não encontrado|inativo|fechado|não pertence|Limite de|atingido/i.test(message);
    console.error("Falha ao criar ticket no PostgreSQL local:", message);
    return Response.json(
      { error: clientError ? message : "Não foi possível criar a senha." },
      { status: clientError ? 400 : 500 }
    );
  }
}
