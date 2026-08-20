import crypto from "node:crypto";
import { authenticateLocalRequest, hasValidCsrf } from "../../../../../server/local-http-auth.js";
import { consumeLocalPushRateLimit, localPushService, verifyLocalPushOrigin } from "../../../../../server/local-push.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  if (process.env.DATA_BACKEND !== "local-postgres" || process.env.LOCAL_POSTGRES_ROUTES_ENABLED !== "1") return Response.json({ error: "Rota PostgreSQL local desativada." }, { status: 404 });
  const { session } = await authenticateLocalRequest(request);
  if (!session) return Response.json({ error: "Sessao nao encontrada." }, { status: 401 });
  if (!["customer", "manager", "admin"].includes(session.user.role)) return Response.json({ error: "Acesso negado." }, { status: 403 });
  if (!hasValidCsrf(request, session)) return Response.json({ error: "Token CSRF invalido." }, { status: 403 });
  if (!verifyLocalPushOrigin(request)) return Response.json({ error: "Origem da requisicao nao autorizada." }, { status: 403 });
  if (!await consumeLocalPushRateLimit(session.user.id, "test", 5, 15 * 60, request.headers.get("user-agent") || "local")) {
    return Response.json({ error: "Limite de testes atingido. Aguarde antes de tentar novamente." }, { status: 429 });
  }
  const delivery = await localPushService.sendBusinessEvent({
    type: "push_test",
    eventKey: `push-test:${session.user.id}:${crypto.randomUUID()}`,
    userId: session.user.id,
    payloadVersion: 1,
    context: { customerName: session.user.name, url: "/?view=account" }
  });
  return Response.json({ ok: delivery.status !== "failed", delivery }, { status: delivery.status === "failed" ? 502 : 200 });
}
