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
    const { POST } = await import("../app/api/local-postgres/auth/login/route.js");
    const response = await POST(new Request("http://localhost/api/local-postgres/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password })
    }));
    const body = await response.json();
    const setCookies = response.headers.getSetCookie?.() || [];
    const authCookie = setCookies.find((cookie) => cookie.startsWith("senhahub_local_auth="));
    sessionToken = authCookie?.split(";", 1)[0]?.split("=", 2)[1]
      ? decodeURIComponent(authCookie.split(";", 1)[0].split("=", 2)[1])
      : null;

    console.log(JSON.stringify({
      statusHttp: response.status,
      loginOk: response.ok,
      usuario: body.user?.email || null,
      csrfTokenTamanho: body.csrfToken?.length || 0,
      cookieHttpOnlyRecebido: Boolean(authCookie),
      cookieCsrfRecebido: setCookies.some((cookie) => cookie.startsWith("senhahub_local_csrf="))
    }, null, 2));

    if (!response.ok || !sessionToken) throw new Error(body.error || "A rota não criou o cookie de sessão.");
  } finally {
    if (sessionToken) {
      await query(
        "DELETE FROM auth.sessions WHERE token_hash = $1",
        [hashSessionToken(sessionToken)]
      );
    }
    await close();
  }
}

main().catch((error) => {
  console.error(`Falha no teste da rota de autenticação local: ${error.message}`);
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
