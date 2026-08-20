import { getLocalMetrics } from "../../../../server/local-legacy.js";
import { requireLocalUser } from "../../../../server/local-route-helpers.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const user = await requireLocalUser(request, ["manager", "admin"]);
  if (user.response) return user.response;
  const date = new URL(request.url).searchParams.get("date");
  try {
    return Response.json({ source: "postgres-local", ...(await getLocalMetrics(date)) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("Falha ao consultar métricas locais:", error.message);
    return Response.json({ error: "Não foi possível consultar as métricas." }, { status: 500 });
  }
}
