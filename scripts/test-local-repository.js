const fs = require("node:fs");
const path = require("node:path");
const { close } = require("../server/local-postgres");
const { getQueueSnapshot } = require("../server/local-repository");

const ROOT = path.resolve(__dirname, "..");

loadEnvFile(path.join(ROOT, ".env.local"));
loadEnvFile(path.join(ROOT, ".env"));

async function main() {
  try {
    const snapshot = await getQueueSnapshot();

    console.log(JSON.stringify({
      setoresAbertos: snapshot.sectors.map((sector) => ({
        id: sector.id,
        nome: sector.name,
        status: sector.status
      })),
      totalTicketsEmEspera: snapshot.tickets.length,
      primeirosTickets: snapshot.tickets.slice(0, 5).map((ticket) => ({
        id: ticket.id,
        setor: ticket.sector_id,
        codigo: ticket.code,
        status: ticket.status,
        prioridade: ticket.priority,
        ordem: ticket.queue_order
      }))
    }, null, 2));
  } finally {
    await close();
  }
}

main().catch((error) => {
  console.error(`Falha ao testar o repositório PostgreSQL local: ${error.message}`);
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
