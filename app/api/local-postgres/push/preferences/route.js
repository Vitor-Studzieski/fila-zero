import { authenticateLocalRequest, hasValidCsrf } from "../../../../../server/local-http-auth.js";
import { consumeLocalPushRateLimit, setLocalPushPreferences, verifyLocalPushOrigin } from "../../../../../server/local-push.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request) {
  if (process.env.DATA_BACKEND !== "local-postgres" || process.env.LOCAL_POSTGRES_ROUTES_ENABLED !== "1") return Response.json({ error: "Rota PostgreSQL local desativada." }, { status: 404 });
  const { session } = await authenticateLocalRequest(request);
  if (!session) return Response.json({ error: "Sessao nao encontrada." }, { status: 401 });
  if (!["customer", "manager", "admin"].includes(session.user.role)) return Response.json({ error: "Acesso negado." }, { status: 403 });
  if (!hasValidCsrf(request, session)) return Response.json({ error: "Token CSRF invalido." }, { status: 403 });
  if (!verifyLocalPushOrigin(request)) return Response.json({ error: "Origem da requisicao nao autorizada." }, { status: 403 });
  if (!await consumeLocalPushRateLimit(session.user.id, "preferences", 30, 60 * 60, request.headers.get("user-agent") || "local")) {
    return Response.json({ error: "Muitas alteracoes em pouco tempo. Aguarde e tente novamente." }, { status: 429 });
  }
  let body = {};
  try { body = await request.json(); } catch { /* preferencias opcionais */ }
  try {
    return Response.json({ ok: true, preferences: await setLocalPushPreferences(session.user.id, body.preferences) });
  } catch (error) {
    return Response.json({ error: error.message || "Nao foi possivel salvar as preferencias." }, { status: 400 });
  }
}
