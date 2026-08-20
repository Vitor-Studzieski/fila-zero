import { authenticateLocalRequest, getCookie } from "../../../../../server/local-http-auth.js";
import { getLocalKioskStatus, localKioskSecret } from "../../../../../server/local-kiosk.js";
import { verifyKioskSession } from "../../../../../server/print-kiosk-service.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  if (process.env.DATA_BACKEND !== "local-postgres" || process.env.LOCAL_POSTGRES_ROUTES_ENABLED !== "1") return Response.json({ error: "Rota PostgreSQL local desativada." }, { status: 404 });
  const { session } = await authenticateLocalRequest(request);
  const kioskSession = verifyKioskSession(getCookie(request, "senhahub_kiosk"), localKioskSecret());
  if (!kioskSession && !["manager", "admin"].includes(session?.user?.role)) {
    return Response.json({ error: "Acesso do totem nao autorizado." }, { status: 401 });
  }
  return Response.json(await getLocalKioskStatus(request, session?.user || null, kioskSession));
}
