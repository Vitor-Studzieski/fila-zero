import { authenticateLocalRequest } from "../../../../../server/local-http-auth.js";
import { getQueueSnapshot } from "../../../../../server/local-repository.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  if (process.env.DATA_BACKEND !== "local-postgres" || process.env.LOCAL_POSTGRES_ROUTES_ENABLED !== "1") {
    return Response.json({ error: "Rota PostgreSQL local desativada." }, { status: 404 });
  }

  const { session } = await authenticateLocalRequest(request);
  if (!session) return Response.json({ error: "Sessão não encontrada." }, { status: 401 });
  if (session.user.role !== "tablet") return Response.json({ error: "Acesso negado." }, { status: 403 });

  try {
    const snapshot = await getQueueSnapshot();
    const queueBySector = new Map();
    for (const ticket of snapshot.tickets || []) {
      queueBySector.set(ticket.sector_id, (queueBySector.get(ticket.sector_id) || 0) + 1);
    }

    return Response.json({
      source: "postgres-local",
      user: session.user,
      sectors: (snapshot.sectors || []).map((sector) => ({
        id: sector.id,
        name: sector.name,
        prefix: sector.prefix,
        counterLabel: sector.counter_label,
        serviceLabel: sector.service_label,
        queueSize: queueBySector.get(sector.id) || 0,
        averageServiceSeconds: Number(sector.average_service_seconds || 60),
        capacity: Number(sector.capacity || 1),
        status: sector.status
      }))
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("Falha ao consultar a emissão do tablet no PostgreSQL local:", error.message);
    return Response.json({ error: "Não foi possível consultar os setores." }, { status: 500 });
  }
}
