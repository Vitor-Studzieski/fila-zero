import { getCustomerState, getLocalStaffState } from "../../../../server/local-repository.js";
import { requireLocalUser } from "../../../../server/local-route-helpers.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const scope = new URL(request.url).searchParams.get("scope") === "staff" ? "staff" : "customer";
  const roles = scope === "staff" ? ["attendant", "manager", "admin"] : ["customer", "attendant", "manager", "admin"];
  const user = await requireLocalUser(request, roles);
  if (user.response) return user.response;
  try {
    const state = scope === "staff"
      ? await getLocalStaffState(user.session.user)
      : await getCustomerState(user.session.user.customerId);
    return new Response(`event: state\ndata: ${JSON.stringify(state)}\n\n`, {
      status: 200,
      headers: {
        "cache-control": "no-cache, no-transform",
        "content-type": "text/event-stream; charset=utf-8",
        connection: "close"
      }
    });
  } catch (error) {
    console.error("Falha ao publicar estado local por SSE:", error.message);
    return Response.json({ error: "Não foi possível atualizar o estado em tempo real." }, { status: 500 });
  }
}
