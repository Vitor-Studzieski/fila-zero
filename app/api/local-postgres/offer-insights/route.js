import { getLocalOfferInsights } from "../../../../server/local-legacy.js";
import { requireLocalUser } from "../../../../server/local-route-helpers.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const user = await requireLocalUser(request, ["manager", "admin"]);
  if (user.response) return user.response;
  const days = new URL(request.url).searchParams.get("days");
  try {
    return Response.json({ source: "postgres-local", ...(await getLocalOfferInsights(days)) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("Falha ao consultar insights locais:", error.message);
    return Response.json({ error: "Não foi possível consultar os insights de ofertas." }, { status: 500 });
  }
}
