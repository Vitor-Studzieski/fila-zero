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
  let userId = null;
  let originalRole = null;
  let sectorId = null;
  let sectorBefore = null;
  let counterBefore = null;
  const ticketIds = [];

  try {
    const loginRoute = await import("../app/api/local-postgres/auth/login/route.js");
    const ticketRoute = await import("../app/api/local-postgres/tickets/route.js");
    const callNextRoute = await import("../app/api/local-postgres/staff/call-next/route.js");
    const confirmRoute = await import("../app/api/local-postgres/tickets/confirm/route.js");
    const finishRoute = await import("../app/api/local-postgres/tickets/finish/route.js");
    const skipRoute = await import("../app/api/local-postgres/tickets/skip/route.js");

    const userResult = await query(
      "SELECT id, role FROM public.profiles WHERE lower(email) = lower($1)",
      [email]
    );
    if (!userResult.rowCount) throw new Error("Usuário de teste não encontrado.");
    userId = userResult.rows[0].id;
    originalRole = userResult.rows[0].role;

    const activeResult = await query(
      `
        SELECT id
        FROM public.tickets
        WHERE customer_id = $1
          AND status = ANY($2::public.ticket_status[])
        LIMIT 1
      `,
      [userId, ["aguardando", "proximo", "chamado", "em_atendimento", "espera_inteligente", "standby"]]
    );
    if (activeResult.rowCount) throw new Error("O usuário de teste já possui uma senha ativa; o teste foi interrompido.");

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

    await query(
      "UPDATE public.profiles SET role = 'manager'::public.user_role WHERE id = $1",
      [userId]
    );

    const loginResponse = await loginRoute.POST(new Request("http://localhost/api/local-postgres/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password })
    }));
    const loginBody = await loginResponse.json();
    const cookies = loginResponse.headers.getSetCookie?.() || [];
    const authCookie = cookies.find((cookie) => cookie.startsWith("senhahub_local_auth="));
    const csrfCookie = cookies.find((cookie) => cookie.startsWith("senhahub_local_csrf="));
    if (!loginResponse.ok || !authCookie || !csrfCookie) throw new Error(loginBody.error || "Login do atendente falhou.");

    const authPair = authCookie.split(";", 1)[0];
    const csrfPair = csrfCookie.split(";", 1)[0];
    sessionToken = decodeURIComponent(authPair.split("=", 2)[1]);
    const csrfToken = decodeURIComponent(csrfPair.split("=", 2)[1]);
    const cookie = `${authPair}; ${csrfPair}`;
    const headers = { cookie, "x-csrf-token": csrfToken, "content-type": "application/json" };

    const createResponse = await ticketRoute.POST(new Request("http://localhost/api/local-postgres/tickets", {
      method: "POST",
      headers,
      body: JSON.stringify({ sectorId })
    }));
    const createBody = await createResponse.json();
    if (createResponse.status !== 201 || !createBody.ticket?.id) throw new Error(createBody.error || "Criação da senha de ciclo falhou.");
    const firstTicketId = createBody.ticket.id;
    ticketIds.push(firstTicketId);

    const callResponse = await callNextRoute.POST(new Request("http://localhost/api/local-postgres/staff/call-next", {
      method: "POST",
      headers,
      body: JSON.stringify({ sectorId })
    }));
    const callBody = await callResponse.json();
    if (callResponse.status !== 200 || callBody.ticket?.id !== firstTicketId) {
      throw new Error(callBody.error || "Chamada da senha de ciclo falhou.");
    }

    const confirmResponse = await confirmRoute.POST(new Request("http://localhost/api/local-postgres/tickets/confirm", {
      method: "POST",
      headers,
      body: JSON.stringify({ ticketId: firstTicketId })
    }));
    const confirmBody = await confirmResponse.json();
    if (confirmResponse.status !== 200 || confirmBody.ticket?.status !== "em_atendimento") {
      throw new Error(confirmBody.error || "Confirmação da senha de ciclo falhou.");
    }

    const finishResponse = await finishRoute.POST(new Request("http://localhost/api/local-postgres/tickets/finish", {
      method: "POST",
      headers,
      body: JSON.stringify({ ticketId: firstTicketId })
    }));
    const finishBody = await finishResponse.json();
    if (finishResponse.status !== 200 || finishBody.finishedTicket?.status !== "atendido") {
      throw new Error(finishBody.error || "Finalização da senha de ciclo falhou.");
    }

    const serviceResult = await query(
      "SELECT started_at, finished_at FROM public.services WHERE ticket_id = $1 ORDER BY started_at DESC LIMIT 1",
      [firstTicketId]
    );
    if (!serviceResult.rowCount || !serviceResult.rows[0].finished_at) {
      throw new Error("O atendimento foi finalizado, mas o serviço não recebeu finished_at.");
    }

    const skipCreateResponse = await ticketRoute.POST(new Request("http://localhost/api/local-postgres/tickets", {
      method: "POST",
      headers,
      body: JSON.stringify({ sectorId })
    }));
    const skipCreateBody = await skipCreateResponse.json();
    if (skipCreateResponse.status !== 201 || !skipCreateBody.ticket?.id) throw new Error(skipCreateBody.error || "Criação da senha de ausência falhou.");
    const skipTicketId = skipCreateBody.ticket.id;
    ticketIds.push(skipTicketId);

    const skipCallResponse = await callNextRoute.POST(new Request("http://localhost/api/local-postgres/staff/call-next", {
      method: "POST",
      headers,
      body: JSON.stringify({ sectorId })
    }));
    const skipCallBody = await skipCallResponse.json();
    if (skipCallResponse.status !== 200 || skipCallBody.ticket?.id !== skipTicketId) {
      throw new Error(skipCallBody.error || "Chamada da senha de ausência falhou.");
    }

    const skipResponse = await skipRoute.POST(new Request("http://localhost/api/local-postgres/tickets/skip", {
      method: "POST",
      headers,
      body: JSON.stringify({ ticketId: skipTicketId, reason: "cliente_ausente" })
    }));
    const skipBody = await skipResponse.json();
    if (skipResponse.status !== 200 || skipBody.skippedTicket?.status !== "standby" || !skipBody.skippedTicket?.standbyExpiresAt) {
      throw new Error(skipBody.error || "Registro de ausência da senha falhou.");
    }

    console.log(JSON.stringify({
      loginRole: loginBody.user?.role || null,
      sectorId,
      firstTicket: {
        id: firstTicketId,
        called: callBody.ticket.status,
        confirmed: confirmBody.ticket.status,
        finished: finishBody.finishedTicket.status,
        serviceFinished: Boolean(serviceResult.rows[0].finished_at)
      },
      skippedTicket: {
        id: skipTicketId,
        status: skipBody.skippedTicket.status,
        absenceCount: skipBody.skippedTicket.absenceCount,
        standbyExpiresAt: Boolean(skipBody.skippedTicket.standbyExpiresAt)
      }
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
  console.error(`Falha no teste do ciclo de atendimento local: ${error.message}`);
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
