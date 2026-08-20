import { issueLocalPhysicalTicket, localKioskSecret } from "../../../../../server/local-kiosk.js";
import { verifyKioskRequest } from "../../../../../server/print-kiosk-service.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  if (process.env.DATA_BACKEND !== "local-postgres" || process.env.LOCAL_POSTGRES_ROUTES_ENABLED !== "1") return Response.json({ error: "Rota PostgreSQL local desativada." }, { status: 404 });
  const kiosk = verifyKioskRequest(request.headers, localKioskSecret());
  if (kiosk.error) return Response.json({ error: kiosk.error }, { status: kiosk.status });
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: "JSON invalido." }, { status: 400 }); }
  try {
    const result = await issueLocalPhysicalTicket(kiosk, body);
    return Response.json(result, { status: result.alreadyExists ? 200 : 201 });
  } catch (error) {
    return Response.json({ error: error.message || "Nao foi possivel emitir a senha fisica." }, { status: 400 });
  }
}
