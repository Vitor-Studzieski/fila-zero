import { consumeLocalRateLimit, requestLocalPasswordReset } from "../../../../../server/local-auth.js";
import { clientIp } from "../../../../../server/local-http-auth.js";
import { isLocalPostgresEnabled, readJson } from "../../../../../server/local-route-helpers.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  if (!isLocalPostgresEnabled()) return Response.json({ error: "Rota PostgreSQL local desativada." }, { status: 404 });
  const body = await readJson(request);
  if (!body) return Response.json({ error: "O corpo da requisição precisa ser um JSON válido." }, { status: 400 });
  const response = { ok: true, message: "Se o e-mail estiver cadastrado, enviaremos um link para redefinir a senha." };
  const ip = clientIp(request);
  const email = String(body.email || "").trim().toLowerCase();
  if (!await consumeLocalRateLimit("local-forgot-password-ip", ip, 8, 15 * 60)) return Response.json(response, { status: 202 });
  if (!await consumeLocalRateLimit("local-forgot-password-email", email || "unknown", 3, 60 * 60)) return Response.json(response, { status: 202 });
  return Response.json(await requestLocalPasswordReset(email), { status: 202 });
}
