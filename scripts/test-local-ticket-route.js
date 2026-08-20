const fs = require("node:fs");
const path = require("node:path");
const { close, query, withTransaction } = require("../server/local-postgres");
const { hashSessionToken } = require("../server/local-auth");

const ROOT = path.resolve(__dirname, "..");
loadEnvFile(path.join(ROOT, ".env.local"));
loadEnvFile(path.join(ROOT, ".env"));

async function main() {
  const email = String(process.env.LOCAL_AUTH_TEST_EMAIL || "local.teste@senhahub.test");
  const password = String(process.env.LOCAL_AUTH_TEST_PASSWORD || "");
  if (!password) throw new Error("Defina LOCAL_AUTH_TEST_PASSWORD antes do teste.");

  let sessionToken = null;
  let ticketId = null;
  let sectorId = null;
  let sectorBefore = null;
  let counterBefore = null;

  try {
    const loginRoute = await import("../app/api/local-postgres/auth/login/route.js");
    const ticketRoute = await import("../app/api/local-postgres/tickets/route.js");
    const cancelRoute = await import("../app/api/local-postgres/tickets/cancel/route.js");

    const loginResponse = await loginRoute.POST(new Request("http://localhost/api/local-postgres/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password })
    }));
    const loginBody = await loginResponse.json();
    const cookies = loginResponse.headers.getSetCookie?.() || [];
    const authCookie = cookies.find((cookie) => cookie.startsWith("senhahub_local_auth="));
    const csrfCookie = cookies.find((cookie) => cookie.startsWith("senhahub_local_csrf="));
    if (!loginResponse.ok || !authCookie || !csrfCookie) throw new Error(loginBody.error || "Login de teste falhou.");

    const authPair = authCookie.split(";", 1)[0];
    const csrfPair = csrfCookie.split(";", 1)[0];
    sessionToken = decodeURIComponent(authPair.split("=", 2)[1]);
    const csrfToken = decodeURIComponent(csrfPair.split("=", 2)[1]);
    const cookie = `${authPair}; ${csrfPair}`;

    const active = await query(
      `
        SELECT id
        FROM public.tickets
        WHERE customer_id = $1
          AND status = ANY($2::public.ticket_status[])
        LIMIT 1
      `,
      [loginBody.user.id, ["aguardando", "proximo", "chamado", "em_atendimento", "espera_inteligente", "standby"]]
    );
    if (active.rowCount) throw new Error("O usuário de teste já possui uma senha ativa; cancelamento automático foi interrompido.");

    const sectorResult = await query(
      "SELECT id, current_number FROM public.sectors WHERE status = 'open'::public.sector_status ORDER BY id LIMIT 1"
    );
    if (!sectorResult.rowCount) throw new Error("Nenhum setor aberto para o teste.");
    sectorId = sectorResult.rows[0].id;
    sectorBefore = sectorResult.rows[0].current_number;
    const counterResult = await query("SELECT business_date, last_number FROM public.ticket_counters WHERE sector_id = $1", [sectorId]);
    counterBefore = counterResult.rows[0] || null;

    const createResponse = await ticketRoute.POST(new Request("http://localhost/api/local-postgres/tickets", {
      method: "POST",
      headers: { cookie, "x-csrf-token": csrfToken, "content-type": "application/json" },
      body: JSON.stringify({ sectorId })
    }));
    const createBody = await createResponse.json();
    if (createResponse.status !== 201 || !createBody.ticket?.id) {
      throw new Error(createBody.error || "A criação do ticket de teste falhou.");
    }
    ticketId = createBody.ticket.id;

    const cancelResponse = await cancelRoute.POST(new Request("http://localhost/api/local-postgres/tickets/cancel", {
      method: "POST",
      headers: { cookie, "x-csrf-token": csrfToken, "content-type": "application/json" },
      body: JSON.stringify({ ticketId })
    }));
    const cancelBody = await cancelResponse.json();

    console.log(JSON.stringify({
      createHttp: createResponse.status,
      createdTicket: createBody.ticket.ticket || createBody.ticket.code,
      cancelHttp: cancelResponse.status,
      canceledStatus: cancelBody.ticket?.status || null
    }, null, 2));

    if (cancelResponse.status !== 200 || cancelBody.ticket?.status !== "cancelado") {
      throw new Error(cancelBody.error || "O cancelamento do ticket de teste falhou.");
    }
  } finally {
    if (ticketId) {
      await withTransaction(async (client) => {
        await client.query("DELETE FROM public.events WHERE entity_id = $1", [ticketId]);
        await client.query("DELETE FROM public.tickets WHERE id = $1", [ticketId]);
        if (sectorId !== null && sectorBefore !== null) {
          await client.query("UPDATE public.sectors SET current_number = $2 WHERE id = $1", [sectorId, sectorBefore]);
        }
        if (sectorId !== null && counterBefore) {
          await client.query(
            "UPDATE public.ticket_counters SET business_date = $2, last_number = $3 WHERE sector_id = $1",
            [sectorId, counterBefore.business_date, counterBefore.last_number]
          );
        } else if (sectorId !== null) {
          await client.query("DELETE FROM public.ticket_counters WHERE sector_id = $1", [sectorId]);
        }
      });
    }
    if (sessionToken) await query("DELETE FROM auth.sessions WHERE token_hash = $1", [hashSessionToken(sessionToken)]);
    await close();
  }
}

main().catch((error) => {
  console.error(`Falha no teste de ticket local: ${error.message}`);
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
