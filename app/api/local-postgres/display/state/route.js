import { getLocalStaffState } from "../../../../../server/local-repository.js";
import { requireLocalUser } from "../../../../../server/local-route-helpers.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const user = await requireLocalUser(request, ["tv"]);
  if (user.response) return user.response;

  try {
    return Response.json({
      source: "postgres-local",
      ...(await getLocalStaffState(user.session.user))
    }, {
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    console.error("Falha ao consultar o estado da TV do açougue:", error.message);
    return Response.json({ error: "Não foi possível carregar a fila do açougue." }, { status: 500 });
  }
}
