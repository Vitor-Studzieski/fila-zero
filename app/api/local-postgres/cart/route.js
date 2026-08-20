import { authenticateLocalRequest, hasValidCsrf } from "../../../../server/local-http-auth.js";
import { addLocalCartItem, getLocalCart } from "../../../../server/local-repository.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  if (process.env.DATA_BACKEND !== "local-postgres" || process.env.LOCAL_POSTGRES_ROUTES_ENABLED !== "1") {
    return Response.json({ error: "Rota PostgreSQL local desativada." }, { status: 404 });
  }
  const { session } = await authenticateLocalRequest(request);
  if (!session) return Response.json({ error: "Sessão não encontrada." }, { status: 401 });

  try {
    return Response.json({ source: "postgres-local", ...(await getLocalCart(session.user.customerId)) });
  } catch (error) {
    console.error("Falha ao consultar o carrinho no PostgreSQL local:", error.message);
    return Response.json({ error: "Não foi possível consultar a lista de compras." }, { status: 500 });
  }
}

export async function POST(request) {
  if (process.env.DATA_BACKEND !== "local-postgres" || process.env.LOCAL_POSTGRES_ROUTES_ENABLED !== "1") {
    return Response.json({ error: "Rota PostgreSQL local desativada." }, { status: 404 });
  }
  const { session } = await authenticateLocalRequest(request);
  if (!session) return Response.json({ error: "Sessão não encontrada." }, { status: 401 });
  if (!hasValidCsrf(request, session)) {
    return Response.json({ error: "Token CSRF inválido." }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "O corpo da requisição precisa ser um JSON válido." }, { status: 400 });
  }

  try {
    return Response.json({ source: "postgres-local", ...(await addLocalCartItem(session.user.customerId, body)) }, { status: 201 });
  } catch (error) {
    const message = String(error?.message || "Não foi possível adicionar o produto.");
    return Response.json({ error: message }, { status: 400 });
  }
}
