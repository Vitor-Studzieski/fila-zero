const fs = require("node:fs");
const path = require("node:path");
const { close, query, withTransaction } = require("../server/local-postgres");
const { hashSessionToken } = require("../server/local-auth");

const ROOT = path.resolve(__dirname, "..");
loadEnvFile(path.join(ROOT, ".env.local"));
loadEnvFile(path.join(ROOT, ".env"));

async function main() {
  const baseUrl = `http://127.0.0.1:${process.env.PORT || 3017}`;
  const email = String(process.env.LOCAL_AUTH_TEST_EMAIL || "local.teste@senhahub.test");
  const password = String(process.env.LOCAL_AUTH_TEST_PASSWORD || "");
  if (!password) throw new Error("Defina LOCAL_AUTH_TEST_PASSWORD antes do teste.");

  let userId = null;
  let originalRole = null;
  let sessionToken = null;
  let sectorId = null;
  let sectorBefore = null;
  let counterBefore = null;
  const ticketIds = [];

  try {
    const userResult = await query(
      "SELECT id, role FROM public.profiles WHERE lower(email) = lower($1)",
      [email]
    );
    if (!userResult.rowCount) throw new Error("Usuário de teste não encontrado.");
    userId = userResult.rows[0].id;
    originalRole = userResult.rows[0].role;

    const sectorResult = await query(
      "SELECT id, current_number FROM public.sectors WHERE status = 'open'::public.sector_status ORDER BY id LIMIT 1"
    );
    if (!sectorResult.rowCount) throw new Error("Nenhum setor aberto para o teste.");
    sectorId = sectorResult.rows[0].id;
    sectorBefore = sectorResult.rows[0].current_number;
    const counterResult = await query(
      "SELECT business_date, last_number FROM public.ticket_counters WHERE sector_id = $1",
      [sectorId]
    );
    counterBefore = counterResult.rows[0] || null;

    await query("UPDATE public.profiles SET role = 'manager'::public.user_role WHERE id = $1", [userId]);

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const loginBody = await loginResponse.json();
    const cookies = loginResponse.headers.getSetCookie?.() || [];
    const authCookie = cookies.find((cookie) => cookie.startsWith("senhahub_local_auth="));
    const csrfCookie = cookies.find((cookie) => cookie.startsWith("senhahub_local_csrf="));
    if (!loginResponse.ok || !authCookie || !csrfCookie) throw new Error(loginBody.error || "Login pelo alias falhou.");

    const authPair = authCookie.split(";", 1)[0];
    const csrfPair = csrfCookie.split(";", 1)[0];
    sessionToken = decodeURIComponent(authPair.split("=", 2)[1]);
    const csrfToken = decodeURIComponent(csrfPair.split("=", 2)[1]);
    const headers = {
      cookie: `${authPair}; ${csrfPair}`,
      "x-csrf-token": csrfToken,
      "content-type": "application/json"
    };

    const createResponse = await fetch(`${baseUrl}/api/tickets`, {
      method: "POST",
      headers,
      body: JSON.stringify({ sectorId })
    });
    const createBody = await createResponse.json();
    if (createResponse.status !== 201 || !createBody.ticket?.id) throw new Error(createBody.error || "Criação pelo alias falhou.");
    const ticketId = createBody.ticket.id;
    ticketIds.push(ticketId);

    const callResponse = await fetch(`${baseUrl}/api/sectors/${encodeURIComponent(sectorId)}/call-next`, {
      method: "POST",
      headers,
      body: "{}"
    });
    const callBody = await callResponse.json();
    if (callResponse.status !== 200 || callBody.ticket?.id !== ticketId) throw new Error(callBody.error || "Chamada pelo alias falhou.");

    const confirmResponse = await fetch(`${baseUrl}/api/tickets/${encodeURIComponent(ticketId)}/confirm`, {
      method: "POST",
      headers,
      body: "{}"
    });
    const confirmBody = await confirmResponse.json();
    if (confirmResponse.status !== 200 || confirmBody.ticket?.status !== "em_atendimento") throw new Error(confirmBody.error || "Confirmação pelo alias falhou.");

    const finishResponse = await fetch(`${baseUrl}/api/tickets/${encodeURIComponent(ticketId)}/finish`, {
      method: "POST",
      headers,
      body: "{}"
    });
    const finishBody = await finishResponse.json();
    if (finishResponse.status !== 200 || finishBody.finishedTicket?.status !== "atendido") throw new Error(finishBody.error || "Finalização pelo alias falhou.");

    console.log(JSON.stringify({
      loginRole: loginBody.user?.role || null,
      createHttp: createResponse.status,
      callHttp: callResponse.status,
      confirmHttp: confirmResponse.status,
      finishHttp: finishResponse.status,
      finalStatus: finishBody.finishedTicket.status
    }, null, 2));
  } finally {
    await withTransaction(async (client) => {
      for (const ticketId of ticketIds) {
        await client.query("DELETE FROM public.events WHERE entity_id = $1", [ticketId]);
        await client.query("DELETE FROM public.calls WHERE ticket_id = $1", [ticketId]);
        await client.query("DELETE FROM public.services WHERE ticket_id = $1", [ticketId]);
        await client.query("DELETE FROM public.tickets WHERE id = $1", [ticketId]);
      }
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
      if (userId && originalRole) {
        await client.query("UPDATE public.profiles SET role = $2::public.user_role WHERE id = $1", [userId, originalRole]);
      }
    });
    if (sessionToken) await query("DELETE FROM auth.sessions WHERE token_hash = $1", [hashSessionToken(sessionToken)]);
    await close();
  }
}

main().catch((error) => {
  console.error(`Falha no teste dos aliases de ticket locais: ${error.message}`);
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
