const fs = require("node:fs");
const path = require("node:path");
const { close, query, withTransaction } = require("../server/local-postgres");
const { createKioskSession, verifyKioskSession } = require("../server/print-kiosk-service");
const {
  claimLocalPrintJob,
  finishLocalPrintJob,
  issueLocalPhysicalTicket,
  localKioskSecret
} = require("../server/local-kiosk");

const ROOT = path.resolve(__dirname, "..");
loadEnvFile(path.join(ROOT, ".env.local"));
loadEnvFile(path.join(ROOT, ".env"));

async function main() {
  let ticketId = null;
  let jobId = null;
  let sectorId = null;
  let sectorBefore = null;
  let counterBefore = null;

  try {
    const kiosk = (await query(
      "SELECT id, session_nonce FROM public.print_kiosks WHERE id = $1 AND active = true",
      [process.env.KIOSK_ID || "totem-pompeia-01"]
    )).rows[0];
    if (!kiosk) throw new Error("Totem local ativo nao encontrado.");

    const sector = (await query(
      "SELECT id, current_number FROM public.sectors WHERE status = 'open'::public.sector_status ORDER BY id LIMIT 1"
    )).rows[0];
    if (!sector) throw new Error("Nenhum setor aberto para o teste.");
    sectorId = sector.id;
    sectorBefore = sector.current_number;
    counterBefore = (await query(
      "SELECT business_date, last_number FROM public.ticket_counters WHERE sector_id = $1",
      [sectorId]
    )).rows[0] || null;

    const session = verifyKioskSession(
      createKioskSession(kiosk.id, localKioskSecret(), Date.now(), kiosk.session_nonce).token,
      localKioskSecret()
    );
    const idempotencyKey = `local-kiosk-${Date.now()}-test`;
    const issued = await issueLocalPhysicalTicket(session, { sectorId, idempotencyKey });
    ticketId = issued.ticket.id;
    jobId = issued.printJob.id;
    const repeated = await issueLocalPhysicalTicket(session, { sectorId, idempotencyKey });
    const claimed = await claimLocalPrintJob(kiosk.id);
    if (!claimed || claimed.id !== jobId) throw new Error("O agente nao retirou o trabalho criado pelo teste.");
    const finished = await finishLocalPrintJob(jobId, kiosk.id, true);

    console.log(JSON.stringify({
      emitted: Boolean(ticketId),
      idempotency: repeated.alreadyExists,
      claimedStatus: claimed.status,
      finishedStatus: finished.status
    }, null, 2));
  } finally {
    await withTransaction(async (client) => {
      if (jobId) {
        await client.query("DELETE FROM public.print_job_attempts WHERE job_id = $1", [jobId]);
        await client.query("DELETE FROM public.print_jobs WHERE id = $1", [jobId]);
      }
      if (ticketId) {
        await client.query("DELETE FROM public.events WHERE entity_id = $1", [ticketId]);
        await client.query("DELETE FROM public.tickets WHERE id = $1", [ticketId]);
      }
      if (sectorId && sectorBefore !== null) {
        await client.query("UPDATE public.sectors SET current_number = $2 WHERE id = $1", [sectorId, sectorBefore]);
      }
      if (sectorId && counterBefore) {
        await client.query(
          "UPDATE public.ticket_counters SET business_date = $2, last_number = $3 WHERE sector_id = $1",
          [sectorId, counterBefore.business_date, counterBefore.last_number]
        );
      }
    });
    await close();
  }
}

main().catch((error) => {
  console.error(`Falha no teste do totem local: ${error.message}`);
  process.exitCode = 1;
});

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
