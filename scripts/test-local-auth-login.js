const fs = require("node:fs");
const path = require("node:path");
const { close, query } = require("../server/local-postgres");
const {
  getLocalSession,
  hashSessionToken,
  loginLocalUser
} = require("../server/local-auth");

const ROOT = path.resolve(__dirname, "..");

loadEnvFile(path.join(ROOT, ".env.local"));
loadEnvFile(path.join(ROOT, ".env"));

async function main() {
  const email = String(process.env.LOCAL_AUTH_TEST_EMAIL || "local.teste@senhahub.test").trim();
  const password = String(process.env.LOCAL_AUTH_TEST_PASSWORD || "");
  if (!password) {
    throw new Error("Defina LOCAL_AUTH_TEST_PASSWORD somente no terminal antes do teste.");
  }

  let sessionToken = null;
  try {
    const result = await loginLocalUser({
      email,
      password,
      attemptKey: "local-auth-integration-test"
    });
    if (result.error) throw new Error(result.error);

    sessionToken = result.sessionToken;
    const session = await getLocalSession(sessionToken);

    console.log(JSON.stringify({
      loginOk: true,
      usuario: result.user,
      sessaoEncontrada: Boolean(session),
      csrfTokenTamanho: result.csrfToken.length,
      tokenNaoArmazenadoEmClaro: Boolean(hashSessionToken(sessionToken))
    }, null, 2));

    if (!session || session.user.id !== result.user.id) {
      throw new Error("A sessão criada não corresponde ao usuário autenticado.");
    }
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
  console.error(`Falha no teste de login local: ${error.message}`);
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
