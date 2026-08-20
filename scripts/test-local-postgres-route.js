const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

loadEnvFile(path.join(ROOT, ".env.local"));
loadEnvFile(path.join(ROOT, ".env"));

async function main() {
  const { GET } = await import("../app/api/local-postgres/queue/route.js");
  const response = await GET(new Request("http://localhost/api/local-postgres/queue"));
  const body = await response.json();

  console.log(JSON.stringify({
    statusHttp: response.status,
    source: body.source,
    setores: body.sectors?.length ?? 0,
    tickets: body.tickets?.length ?? 0
  }, null, 2));

  if (!response.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Falha ao testar a rota PostgreSQL local: ${error.message}`);
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
