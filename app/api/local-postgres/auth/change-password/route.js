import { changeLocalPassword, consumeLocalRateLimit } from "../../../../../server/local-auth.js";
import { clientIp } from "../../../../../server/local-http-auth.js";
import { isLocalPostgresEnabled, readJson } from "../../../../../server/local-route-helpers.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  if (!isLocalPostgresEnabled()) return Response.json({ error: "Rota PostgreSQL local desativada." }, { status: 404 });
  const body = await readJson(request);
  if (!body) return Response.json({ error: "O corpo da requisição precisa ser um JSON válido." }, { status: 400 });
  const ip = clientIp(request);
  if (!await consumeLocalRateLimit("local-change-password-ip", ip, 10, 15 * 60)) {
    return Response.json({ error: "Muitas tentativas. Aguarde alguns minutos." }, { status: 429 });
  }
  const email = String(body.email || "").trim().toLowerCase();
  const result = await changeLocalPassword({
    email,
    currentPassword: body.currentPassword,
    newPassword: body.newPassword,
    attemptKey: `${ip}:${email}:change-password`
  });
  return Response.json(result, { status: result.error ? 401 : 200 });
}
