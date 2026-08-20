const fs = require("node:fs");
const path = require("node:path");
const { close, query, withTransaction } = require("../server/local-postgres");
const { insertTicketInTransaction } = require("../server/local-repository");

const ROOT = path.resolve(__dirname, "..");

loadEnvFile(path.join(ROOT, ".env.local"));
loadEnvFile(path.join(ROOT, ".env"));

async function main() {
  try {
    const customerResult = await query(`
      SELECT p.id, p.name
      FROM public.profiles p
      WHERE p.role = 'customer'::public.user_role
        AND p.status = 'active'::public.user_status
        AND NOT EXISTS (
          SELECT 1
          FROM public.tickets t
          WHERE t.customer_id = p.id
            AND t.status = ANY(ARRAY[
              'aguardando', 'proximo', 'chamado',
              'em_atendimento', 'espera_inteligente', 'standby'
            ]::public.ticket_status[])
        )
      ORDER BY p.created_at
      LIMIT 1
    `);
    const sectorResult = await query(`
      SELECT id
      FROM public.sectors
      WHERE status = 'open'::public.sector_status
      ORDER BY id
      LIMIT 1
    `);
    if (!customerResult.rowCount || !sectorResult.rowCount) {
      throw new Error("Não encontrei cliente ativo sem ticket e setor aberto para o teste.");
    }

    const customer = customerResult.rows[0];
    const sectorId = sectorResult.rows[0].id;
    const before = await countTickets();
    let ticketId = null;

    try {
      await withTransaction(async (client) => {
        const result = await insertTicketInTransaction(client, {
          customerId: customer.id,
          customerName: customer.name,
          sectorId
        });
        ticketId = result.ticket.id;

        const inside = await client.query("SELECT count(*)::int AS total FROM public.tickets");
        if (Number(inside.rows[0].total) !== before + 1) {
          throw new Error("O ticket não apareceu dentro da transação.");
        }

        const rollbackError = new Error("ROLLBACK_TEST");
        rollbackError.code = "ROLLBACK_TEST";
        throw rollbackError;
      });
    } catch (error) {
      if (error.code !== "ROLLBACK_TEST") throw error;
    }

    const after = await countTickets();
    const persisted = await query("SELECT count(*)::int AS total FROM public.tickets WHERE id = $1", [ticketId]);

    console.log(JSON.stringify({
      clienteUsado: customer.id,
      setorUsado: sectorId,
      ticketCriadoDentroDaTransacao: Boolean(ticketId),
      totalAntes: before,
      totalDepoisDoRollback: after,
      ticketPersistido: Number(persisted.rows[0].total) > 0
    }, null, 2));

    if (after !== before || Number(persisted.rows[0].total) !== 0) {
      throw new Error("O rollback não removeu completamente o ticket de teste.");
    }
  } finally {
    await close();
  }
}

async function countTickets() {
  const result = await query("SELECT count(*)::int AS total FROM public.tickets");
  return Number(result.rows[0].total);
}

main().catch((error) => {
  console.error(`Falha no teste de rollback do ticket: ${error.message}`);
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
