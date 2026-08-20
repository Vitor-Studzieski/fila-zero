import {
  authenticateLocalRequest,
  hasValidCsrf
} from "../../../../../server/local-http-auth.js";
import {
  createTicket,
  getLocalPublicTicket,
  upsertLocalDevice
} from "../../../../../server/local-repository.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  if (process.env.DATA_BACKEND !== "local-postgres" || process.env.LOCAL_POSTGRES_ROUTES_ENABLED !== "1") {
    return Response.json({ error: "Rota PostgreSQL local desativada." }, { status: 404 });
  }

  const { session } = await authenticateLocalRequest(request);
  if (!session) return Response.json({ error: "Sessão não encontrada." }, { status: 401 });
  if (session.user.role !== "tablet") return Response.json({ error: "Acesso negado." }, { status: 403 });
  if (!hasValidCsrf(request, session)) return Response.json({ error: "Token CSRF inválido." }, { status: 403 });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "O corpo da requisição precisa ser um JSON válido." }, { status: 400 });
  }

  const requestedIds = Array.isArray(body?.sectorIds) ? body.sectorIds : [body?.sectorId];
  const sectorIds = [...new Set(requestedIds
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => value.trim()))].slice(0, 3);
  if (!sectorIds.length) return Response.json({ error: "Selecione ao menos um setor." }, { status: 400 });

  try {
    const deviceId = `tablet-${session.user.id}`;
    await upsertLocalDevice(session.user.customerId, deviceId, request.headers.get("user-agent") || "tablet");

    const tickets = [];
    const existingIds = [];
    for (const sectorId of sectorIds) {
      const result = await createTicket({
        sectorId,
        customerId: session.user.customerId,
        customerName: session.user.name,
        deviceId,
        priority: body.priority === true || body.preferential === true,
        priorityReason: body.priorityReason || null
      });
      const ticket = await getLocalPublicTicket(result.ticket.id);
      if (!ticket) throw new Error("Senha não encontrada após a emissão.");
      tickets.push(ticket);
      if (result.alreadyExists) existingIds.push(ticket.id);
    }

    return Response.json({
      source: "postgres-local",
      tickets,
      alreadyExists: existingIds.length === tickets.length
    }, { status: existingIds.length === tickets.length ? 200 : 201 });
  } catch (error) {
    const message = String(error?.message || "Não foi possível emitir a senha.");
    const clientError = /obrigatório|inválido|não encontrado|inativo|fechado|não pertence|Limite de|atingido|não pode/i.test(message);
    console.error("Falha ao emitir senha pelo tablet no PostgreSQL local:", message);
    return Response.json(
      { error: clientError ? message : "Não foi possível emitir a senha." },
      { status: clientError ? 400 : 500 }
    );
  }
}
