import { removeLocalCartItem, updateLocalCartItemQuantity } from "../../../../../../server/local-legacy.js";
import { requireCsrf, readJson, requireLocalUser } from "../../../../../../server/local-route-helpers.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function itemIdFrom(request, context, body = {}) {
  const params = await context?.params;
  return String(params?.itemId || body.itemId || new URL(request.url).searchParams.get("itemId") || "").trim();
}

export async function PATCH(request, context) {
  const user = await requireLocalUser(request, ["customer", "attendant", "manager", "admin"]);
  if (user.response) return user.response;
  const csrfError = requireCsrf(request, user.session);
  if (csrfError) return csrfError;
  const body = await readJson(request);
  if (!body) return Response.json({ error: "O corpo da requisição precisa ser um JSON válido." }, { status: 400 });
  const result = await updateLocalCartItemQuantity(await itemIdFrom(request, context, body), user.session.user.customerId, body);
  return Response.json(result, { status: result.error ? 400 : 200 });
}

export async function DELETE(request, context) {
  const user = await requireLocalUser(request, ["customer", "attendant", "manager", "admin"]);
  if (user.response) return user.response;
  const csrfError = requireCsrf(request, user.session);
  if (csrfError) return csrfError;
  const body = await readJson(request);
  const result = await removeLocalCartItem(await itemIdFrom(request, context, body || {}), user.session.user.customerId);
  return Response.json(result, { status: result.error ? 400 : 200 });
}
