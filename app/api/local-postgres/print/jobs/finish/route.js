import { finishLocalPrintJob } from "../../../../../../server/local-kiosk.js";
import { verifyPrintAgentRequest } from "../../../../../../server/print-kiosk-service.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  if (process.env.DATA_BACKEND !== "local-postgres" || process.env.LOCAL_POSTGRES_ROUTES_ENABLED !== "1") return Response.json({ error: "Rota PostgreSQL local desativada." }, { status: 404 });
  const agent = verifyPrintAgentRequest(request.headers, process.env);
  if (agent.error) return Response.json({ error: agent.error }, { status: agent.status });
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: "JSON invalido." }, { status: 400 }); }
  const kioskId = String(body.kioskId || agent.kioskId).trim();
  if (kioskId !== agent.kioskId) return Response.json({ error: "Agente nao autorizado para este totem." }, { status: 403 });
  const pathMatch = new URL(request.url).pathname.match(/^\/api\/print\/jobs\/([^/]+)\/finish$/);
  const jobId = body.jobId || (pathMatch ? decodeURIComponent(pathMatch[1]) : "");
  if (!jobId) return Response.json({ error: "Trabalho de impressao nao informado." }, { status: 400 });
  try {
    const job = await finishLocalPrintJob(jobId, kioskId, body.success === true, body.error);
    return Response.json({ ok: true, job });
  } catch (error) {
    return Response.json({ error: error.message || "Nao foi possivel concluir o trabalho de impressao." }, { status: 400 });
  }
}
