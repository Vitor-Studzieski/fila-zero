import { getLocalTrackedTickets } from "../../../../../server/local-repository.js";
import { clientIp } from "../../../../../server/local-http-auth.js";
import { consumeLocalRateLimit } from "../../../../../server/local-auth.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  if (process.env.DATA_BACKEND !== "local-postgres" || process.env.LOCAL_POSTGRES_ROUTES_ENABLED !== "1") {
    return Response.json({ error: "Rota PostgreSQL local desativada." }, { status: 404 });
  }

  const requestUrl = new URL(request.url);
  const pathMatch = requestUrl.pathname.match(/^\/api\/(?:local-postgres\/)?tickets\/track\/([A-Za-z0-9_-]{20,100})$/);
  const token = pathMatch?.[1] || requestUrl.searchParams.get("token") || "";
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) {
    return Response.json({ error: "Senha não encontrada." }, { status: 404 });
  }

  if (!await consumeLocalRateLimit("local-ticket-track-ip", clientIp(request), 120, 60)) {
    return Response.json({ error: "Muitas consultas. Aguarde um minuto." }, { status: 429 });
  }

  try {
    const result = await getLocalTrackedTickets(token);
    if (result.status === "expired") return Response.json({ error: "Este QR Code expirou." }, { status: 404 });
    if (result.status !== "ok" || !result.tickets.length) return Response.json({ error: "Senha não encontrada." }, { status: 404 });
    return Response.json({ ticket: result.tickets[0], tickets: result.tickets }, {
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    console.error("Falha ao consultar rastreamento local:", error.message);
    return Response.json({ error: "Não foi possível consultar a senha." }, { status: 503 });
  }
}
