import { updateLocalSector } from "../../../../../server/local-legacy.js";
import { requireCsrf, readJson, requireLocalUser } from "../../../../../server/local-route-helpers.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request, context) {
  const user = await requireLocalUser(request, ["manager", "admin"]);
  if (user.response) return user.response;
  const csrfError = requireCsrf(request, user.session);
  if (csrfError) return csrfError;
  const body = await readJson(request);
  if (!body) return Response.json({ error: "O corpo da requisição precisa ser um JSON válido." }, { status: 400 });
  const params = await context?.params;
  const sectorId = String(params?.sectorId || body.sectorId || "").trim();
  const result = await updateLocalSector(sectorId, body);
  return Response.json(result, { status: result.error ? 400 : 200 });
}
