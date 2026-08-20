const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { close, query } = require("../server/local-postgres");
const { hashSessionToken } = require("../server/local-auth");

const ROOT = path.resolve(__dirname, "..");
loadEnvFile(path.join(ROOT, ".env.local"));
loadEnvFile(path.join(ROOT, ".env"));

async function main() {
  const baseUrl = `http://127.0.0.1:${process.env.PORT || 3018}`;
  const email = String(process.env.LOCAL_AUTH_TEST_EMAIL || "local.teste@senhahub.test").trim();
  const password = String(process.env.LOCAL_AUTH_TEST_PASSWORD || "");
  if (!password) throw new Error("Defina LOCAL_AUTH_TEST_PASSWORD antes do teste.");

  let sessionToken = null;
  let userId = null;
  let originalRole = null;
  let createdUserId = null;
  let cartItemId = null;
  try {
    const profile = await query("SELECT id, role FROM public.profiles WHERE lower(email) = lower($1)", [email]);
    if (!profile.rowCount) throw new Error("Usuário de teste não encontrado.");
    userId = profile.rows[0].id;
    originalRole = profile.rows[0].role;
    await query("UPDATE public.profiles SET role = 'manager'::public.user_role WHERE id = $1", [userId]);

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const loginBody = await login.json();
    const cookies = login.headers.getSetCookie?.() || [];
    const authCookie = cookies.find((cookie) => cookie.startsWith("senhahub_local_auth="));
    const csrfCookie = cookies.find((cookie) => cookie.startsWith("senhahub_local_csrf="));
    if (!login.ok || !authCookie || !csrfCookie) throw new Error(loginBody.error || "Login falhou.");
    const authPair = authCookie.split(";", 1)[0];
    const csrfPair = csrfCookie.split(";", 1)[0];
    sessionToken = decodeURIComponent(authPair.split("=", 2)[1]);
    const csrfToken = decodeURIComponent(csrfPair.split("=", 2)[1]);
    const headers = { cookie: `${authPair}; ${csrfPair}`, "x-csrf-token": csrfToken, "content-type": "application/json" };

    const metrics = await getJson(`${baseUrl}/api/metrics?date=2026-08-19`, headers);
    const insights = await getJson(`${baseUrl}/api/offer-insights?days=30`, headers);
    const users = await getJson(`${baseUrl}/api/users`, headers);
    const history = await getJson(`${baseUrl}/api/history`, headers);
    const events = await fetch(`${baseUrl}/api/events?scope=staff`, { headers });
    const eventsText = await events.text();
    if (!events.ok || !eventsText.includes("event: state")) throw new Error("SSE de eventos falhou.");

    const sectorResult = await query("SELECT id, name, counter_label, service_label, queue_size, average_service_seconds, capacity, status FROM public.sectors ORDER BY id LIMIT 1");
    const sector = sectorResult.rows[0];
    const sectorResponse = await fetch(`${baseUrl}/api/sectors/${encodeURIComponent(sector.id)}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        name: sector.name,
        counterLabel: sector.counter_label,
        serviceLabel: sector.service_label,
        queueSize: sector.queue_size,
        averageServiceSeconds: sector.average_service_seconds,
        capacity: sector.capacity,
        status: sector.status
      })
    });
    if (!sectorResponse.ok) throw new Error((await sectorResponse.text()) || "Atualização de setor falhou.");

    const newEmail = `legacy-route-${crypto.randomUUID()}@senhahub.test`;
    const createUser = await fetch(`${baseUrl}/api/users`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Usuário de Smoke Test", email: newEmail, password: "SmokeRoute123!", role: "attendant", sectorIds: [sector.id] })
    });
    const createUserBody = await createUser.json();
    if (createUser.status !== 201 || !createUserBody.user?.id) throw new Error(createUserBody.error || "Criação de usuário falhou.");
    createdUserId = createUserBody.user.id;

    const addCart = await fetch(`${baseUrl}/api/cart/items`, {
      method: "POST",
      headers,
      body: JSON.stringify({ productId: `legacy-${crypto.randomUUID()}`, productName: "Produto de smoke test", sectorName: sector.name, price: "R$ 1,00" })
    });
    const addCartBody = await addCart.json();
    if (addCart.status !== 201 || !addCartBody.item?.id) throw new Error(addCartBody.error || "Inclusão no carrinho falhou.");
    cartItemId = addCartBody.item.id;

    const patchCart = await fetch(`${baseUrl}/api/cart/items/${encodeURIComponent(cartItemId)}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ quantity: 2 })
    });
    if (!patchCart.ok || (await patchCart.json()).item?.quantity !== 2) throw new Error("Atualização do carrinho falhou.");
    const deleteCart = await fetch(`${baseUrl}/api/cart/items/${encodeURIComponent(cartItemId)}`, { method: "DELETE", headers });
    if (!deleteCart.ok) throw new Error("Remoção do carrinho falhou.");
    cartItemId = null;

    const forgot = await fetch(`${baseUrl}/api/auth/forgot-password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "nao-existe@senhahub.test" })
    });
    if (forgot.status !== 202) throw new Error("Recuperação de senha não preservou resposta anti-enumeração.");

    const changePassword = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, currentPassword: "SenhaIncorreta123!", newPassword: "NovaSenhaLocal123!" })
    });
    if (changePassword.status !== 401) throw new Error("Alteração de senha não rejeitou credencial inválida.");
    const resetPassword = await fetch(`${baseUrl}/api/auth/reset-password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessToken: "token-invalido", newPassword: "NovaSenhaLocal123!" })
    });
    if (resetPassword.status !== 400) throw new Error("Redefinição de senha não rejeitou token inválido.");

    console.log(JSON.stringify({
      metricsHttp: metrics.status,
      insightsHttp: insights.status,
      usersHttp: users.status,
      historyHttp: history.status,
      eventsHttp: events.status,
      sectorHttp: sectorResponse.status,
      createUserHttp: createUser.status,
      cartPatchHttp: patchCart.status,
      cartDeleteHttp: deleteCart.status,
      forgotPasswordHttp: forgot.status,
      changePasswordInvalidHttp: changePassword.status,
      resetPasswordInvalidHttp: resetPassword.status,
      routesMigrated: true
    }, null, 2));
  } finally {
    if (cartItemId) await query("DELETE FROM public.cart_items WHERE id = $1", [cartItemId]);
    if (createdUserId) {
      await query("DELETE FROM public.profiles WHERE id = $1", [createdUserId]);
      await query("DELETE FROM auth.users WHERE id = $1", [createdUserId]);
    }
    if (userId && originalRole) await query("UPDATE public.profiles SET role = $2::public.user_role WHERE id = $1", [userId, originalRole]);
    if (sessionToken) await query("DELETE FROM auth.sessions WHERE token_hash = $1", [hashSessionToken(sessionToken)]);
    await close();
  }
}

async function getJson(url, headers) {
  const response = await fetch(url, { headers });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `${url} retornou ${response.status}`);
  return { status: response.status, body };
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

main().catch((error) => {
  console.error(`Falha no smoke test das rotas legadas locais: ${error.message}`);
  process.exitCode = 1;
});
