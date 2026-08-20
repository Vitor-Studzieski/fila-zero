import { createLocalManagedUser, listLocalUsers } from "../../../../server/local-legacy.js";
import { requireCsrf, readJson, requireLocalUser } from "../../../../server/local-route-helpers.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const user = await requireLocalUser(request, ["manager", "admin"]);
  if (user.response) return user.response;
  try {
    return Response.json({ users: await listLocalUsers() }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("Falha ao listar usuários locais:", error.message);
    return Response.json({ error: "Não foi possível listar os usuários." }, { status: 500 });
  }
}

export async function POST(request) {
  const user = await requireLocalUser(request, ["manager", "admin"]);
  if (user.response) return user.response;
  const csrfError = requireCsrf(request, user.session);
  if (csrfError) return csrfError;
  const body = await readJson(request);
  if (!body) return Response.json({ error: "O corpo da requisição precisa ser um JSON válido." }, { status: 400 });
  const result = await createLocalManagedUser(body);
  return Response.json(result, { status: result.error ? 400 : 201 });
}
