const fs = require("node:fs");
const path = require("node:path");
const { close, query } = require("../server/local-postgres");
const { hashSessionToken } = require("../server/local-auth");

const ROOT = path.resolve(__dirname, "..");

loadEnvFile(path.join(ROOT, ".env.local"));
loadEnvFile(path.join(ROOT, ".env"));

async function main() {
  const email = String(process.env.LOCAL_AUTH_TEST_EMAIL || "local.teste@senhahub.test");
  const password = String(process.env.LOCAL_AUTH_TEST_PASSWORD || "");
  if (!password) throw new Error("Defina LOCAL_AUTH_TEST_PASSWORD antes do teste.");

  let sessionToken = null;
  try {
    const loginRoute = await import("../app/api/local-postgres/auth/login/route.js");
    const meRoute = await import("../app/api/local-postgres/auth/me/route.js");
    const stateRoute = await import("../app/api/local-postgres/state/route.js");
    const logoutRoute = await import("../app/api/local-postgres/auth/logout/route.js");
    const ticketRoute = await import("../app/api/local-postgres/tickets/route.js");

    const loginResponse = await loginRoute.POST(new Request("http://localhost/api/local-postgres/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password })
    }));
    const loginBody = await loginResponse.json();
    const cookies = loginResponse.headers.getSetCookie?.() || [];
    const authCookie = cookies.find((cookie) => cookie.startsWith("senhahub_local_auth="));
    const csrfCookie = cookies.find((cookie) => cookie.startsWith("senhahub_local_csrf="));
    if (!loginResponse.ok || !authCookie || !csrfCookie) {
      throw new Error(loginBody.error || "Login local não criou os cookies esperados.");
    }

    const authPair = authCookie.split(";", 1)[0];
    const csrfPair = csrfCookie.split(";", 1)[0];
    sessionToken = decodeURIComponent(authPair.split("=", 2)[1]);
    const csrfToken = decodeURIComponent(csrfPair.split("=", 2)[1]);
    const cookie = `${authPair}; ${csrfPair}`;

    const meResponse = await meRoute.GET(new Request("http://localhost/api/local-postgres/auth/me", {
      headers: { cookie }
    }));
    const meBody = await meResponse.json();

    const stateResponse = await stateRoute.GET(new Request("http://localhost/api/local-postgres/state", {
      headers: { cookie }
    }));
    const stateBody = await stateResponse.json();

    const missingSectorResponse = await ticketRoute.POST(new Request("http://localhost/api/local-postgres/tickets", {
      method: "POST",
      headers: { cookie, "x-csrf-token": csrfToken, "content-type": "application/json" },
      body: "{}"
    }));
    const missingSectorBody = await missingSectorResponse.json();

    const badCsrfResponse = await ticketRoute.POST(new Request("http://localhost/api/local-postgres/tickets", {
      method: "POST",
      headers: { cookie, "x-csrf-token": "csrf-invalido", "content-type": "application/json" },
      body: "{}"
    }));

    const logoutResponse = await logoutRoute.POST(new Request("http://localhost/api/local-postgres/auth/logout", {
      method: "POST",
      headers: { cookie, "x-csrf-token": csrfToken }
    }));
    const meAfterLogoutResponse = await meRoute.GET(new Request("http://localhost/api/local-postgres/auth/me", {
      headers: { cookie }
    }));

    console.log(JSON.stringify({
      loginHttp: loginResponse.status,
      meHttp: meResponse.status,
      meEmail: meBody.user?.email || null,
      stateHttp: stateResponse.status,
      stateSource: stateBody.source || null,
      stateSectors: stateBody.sectors?.length || 0,
      stateTickets: stateBody.tickets?.length || 0,
      authenticatedTicketValidationHttp: missingSectorResponse.status,
      authenticatedTicketValidation: missingSectorBody.error || null,
      invalidCsrfHttp: badCsrfResponse.status,
      logoutHttp: logoutResponse.status,
      meAfterLogoutHttp: meAfterLogoutResponse.status
    }, null, 2));

    if (
      loginResponse.status !== 200 ||
      meResponse.status !== 200 ||
      meBody.user?.email !== email ||
      stateResponse.status !== 200 ||
      stateBody.source !== "postgres-local" ||
      !Array.isArray(stateBody.sectors) ||
      !Array.isArray(stateBody.tickets) ||
      missingSectorResponse.status !== 400 ||
      badCsrfResponse.status !== 403 ||
      logoutResponse.status !== 200 ||
      meAfterLogoutResponse.status !== 401
    ) {
      throw new Error("O fluxo local de sessão não passou em todas as etapas.");
    }
  } finally {
    if (sessionToken) {
      await query("DELETE FROM auth.sessions WHERE token_hash = $1", [hashSessionToken(sessionToken)]);
    }
    await close();
  }
}

main().catch((error) => {
  console.error(`Falha no teste das rotas de sessão local: ${error.message}`);
  process.exitCode = 1;
});

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) process.env[key] = value;
  }
}
