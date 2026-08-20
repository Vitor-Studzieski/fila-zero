import { getLocalCustomerHistory } from "../../../../server/local-legacy.js";
import { requireLocalUser } from "../../../../server/local-route-helpers.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const user = await requireLocalUser(request, ["customer", "attendant", "manager", "admin"]);
  if (user.response) return user.response;
  try {
    return Response.json({ source: "postgres-local", ...(await getLocalCustomerHistory(user.session.user.customerId)) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("Falha ao consultar histórico local:", error.message);
    return Response.json({ error: "Não foi possível consultar o histórico." }, { status: 500 });
  }
}
