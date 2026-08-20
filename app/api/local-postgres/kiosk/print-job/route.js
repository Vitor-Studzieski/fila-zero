import { getCookie } from "../../../../../server/local-http-auth.js";
import { getLocalPrintJob, localKioskSecret } from "../../../../../server/local-kiosk.js";
import { verifyKioskSession } from "../../../../../server/print-kiosk-service.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  if (process.env.DATA_BACKEND !== "local-postgres" || process.env.LOCAL_POSTGRES_ROUTES_ENABLED !== "1") return Response.json({ error: "Rota PostgreSQL local desativada." }, { status: 404 });
  const session = verifyKioskSession(getCookie(request, "senhahub_kiosk"), localKioskSecret());
  if (!session) return Response.json({ error: "Totem nao vinculado." }, { status: 401 });
  const requestUrl = new URL(request.url);
  const pathMatch = requestUrl.pathname.match(/^\/api\/kiosk\/print-jobs\/([^/]+)$/);
  const jobId = pathMatch ? decodeURIComponent(pathMatch[1]) : requestUrl.searchParams.get("jobId");
  if (!jobId) return Response.json({ error: "Trabalho de impressao nao informado." }, { status: 400 });
  try {
    const job = await getLocalPrintJob(session, jobId);
    return job ? Response.json({ job }) : Response.json({ error: "Trabalho de impressao nao encontrado." }, { status: 404 });
  } catch {
    return Response.json({ error: "Trabalho de impressao invalido." }, { status: 400 });
  }
}
