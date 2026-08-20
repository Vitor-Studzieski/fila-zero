const fs = require("node:fs");
const path = require("node:path");
const { close, query } = require("../server/local-postgres");

const ROOT = path.resolve(__dirname, "..");

loadEnvFile(path.join(ROOT, ".env.local"));
loadEnvFile(path.join(ROOT, ".env"));

async function main() {
  try {
    const result = await query(`
      SELECT
        current_user AS usuario,
        current_database() AS banco,
        (SELECT count(*) FROM public.profiles) AS perfis,
        (SELECT count(*) FROM public.tickets) AS tickets
    `);

    console.log(JSON.stringify(result.rows[0], null, 2));
  } finally {
    await close();
  }
}

main().catch((error) => {
  console.error(`Falha ao testar o PostgreSQL local: ${error.message}`);
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
