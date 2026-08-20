import { authenticateLocalRequest, hasValidCsrf } from "../../../../server/local-http-auth.js";
import { upsertLocalDevice } from "../../../../server/local-repository.js";

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
    body = {};
  }

  try {
    return Response.json(await upsertLocalDevice(
      session.user.customerId,
      body?.deviceId,
      request.headers.get("user-agent") || ""
    ));
  } catch (error) {
    console.error("Falha ao registrar dispositivo no PostgreSQL local:", error.message);
    return Response.json({ error: "Não foi possível registrar o dispositivo." }, { status: 500 });
  }
}
