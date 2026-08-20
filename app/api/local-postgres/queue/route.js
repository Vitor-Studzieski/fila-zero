import { getQueueSnapshot } from "../../../../server/local-repository.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  if (process.env.DATA_BACKEND !== "local-postgres" || process.env.LOCAL_POSTGRES_ROUTES_ENABLED !== "1") {
    return Response.json({ error: "Rota PostgreSQL local desativada." }, { status: 404 });
  }

  try {
    const url = new URL(request.url);
    const sectorId = url.searchParams.get("sector") || null;
    const snapshot = await getQueueSnapshot(sectorId);

    return Response.json({
      source: "postgres-local",
      sector: sectorId,
      ...snapshot
    });
  } catch (error) {
    console.error("Falha ao consultar a fila no PostgreSQL local:", error);
    return Response.json(
      { error: "Não foi possível consultar o PostgreSQL local." },
      { status: 500 }
    );
  }
}
