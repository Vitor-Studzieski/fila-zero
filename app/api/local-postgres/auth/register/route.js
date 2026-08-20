import { consumeLocalRateLimit, registerLocalUser } from "../../../../../server/local-auth.js";
import { clientIp } from "../../../../../server/local-http-auth.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  if (process.env.DATA_BACKEND !== "local-postgres" || process.env.LOCAL_POSTGRES_ROUTES_ENABLED !== "1") {
    return Response.json({ error: "Rota PostgreSQL local desativada." }, { status: 404 });
  }
  if (process.env.NODE_ENV === "production" && process.env.LOCAL_PUBLIC_REGISTRATION_ENABLED !== "1") {
    return Response.json({ error: "Cadastro público desativado neste ambiente." }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "O corpo da requisição precisa ser um JSON válido." }, { status: 400 });
  }

  try {
    const requestIp = clientIp(request);
    const emailKey = String(body?.email || "").trim().toLowerCase() || "unknown";
    const [ipAllowed, emailAllowed] = await Promise.all([
      consumeLocalRateLimit("local-register-ip", requestIp, 12, 15 * 60),
      consumeLocalRateLimit("local-register-email", emailKey, 5, 60 * 60)
    ]);
    if (!ipAllowed || !emailAllowed) {
      return Response.json({ error: "Muitas tentativas de cadastro. Aguarde alguns minutos." }, { status: 429 });
    }
    const result = await registerLocalUser(body);
    if (result.error) return Response.json({ error: result.error }, { status: 400 });
    return Response.json(result, { status: 201 });
  } catch (error) {
    console.error("Falha ao registrar usuário no PostgreSQL local:", error.message);
    return Response.json({ error: "Não foi possível criar a conta local." }, { status: 500 });
  }
}
