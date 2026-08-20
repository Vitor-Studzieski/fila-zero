const fs = require("node:fs");
const path = require("node:path");
const { close, query } = require("../server/local-postgres");
const { hashSessionToken, loginLocalUser } = require("../server/local-auth");

const ROOT = path.resolve(__dirname, "..");

loadEnvFile(path.join(ROOT, ".env.local"));
loadEnvFile(path.join(ROOT, ".env"));

async function main() {
  try {
    const schemaResult = await query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'auth'
        AND table_name IN ('users', 'sessions', 'login_attempts')
      ORDER BY table_name
    `);
    const passwordResult = await query(`
      SELECT count(*)::int AS total
      FROM auth.users
      WHERE nullif(encrypted_password, '') IS NOT NULL
    `);
    const invalidLogin = await loginLocalUser({ email: "", password: "" });

    console.log(JSON.stringify({
      tabelasAuth: schemaResult.rows.map((row) => row.table_name),
      usuariosComSenha: Number(passwordResult.rows[0].total),
      hashTokenTamanho: hashSessionToken("token-de-teste").length,
      loginSemCredenciais: invalidLogin.error
    }, null, 2));
  } finally {
    await close();
  }
}

main().catch((error) => {
  console.error(`Falha ao testar a autenticação local: ${error.message}`);
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
