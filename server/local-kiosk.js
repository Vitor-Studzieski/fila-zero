const crypto = require("node:crypto");
const { query, withTransaction } = require("./local-postgres");
const { getLocalPublicTicket } = require("./local-repository");
const {
  createKioskSession,
  loadKioskConfiguration,
  printJobDto,
  validatePhysicalTicketBundleInput,
  validatePhysicalTicketInput,
  verifyKioskSession
} = require("./print-kiosk-service");
const { getCookie } = require("./local-http-auth");

const ACTIVE_TICKET_STATUSES = [
  "aguardando",
  "proximo",
  "chamado",
  "em_atendimento",
  "espera_inteligente",
  "standby"
];
const ADMIN_ROLES = new Set(["manager", "admin"]);
const PRIORITY_REASONS = new Set([
  "deficiencia_ou_mobilidade_reduzida",
  "tea",
  "idoso_60_mais",
  "gestante_ou_lactante",
  "crianca_de_colo",
  "obesidade"
]);

function localKioskSecret(environment = process.env) {
  if (String(environment.AUTH_SECRET || "").length >= 32) return String(environment.AUTH_SECRET);
  if (String(environment.NODE_ENV || "") !== "production") {
    return "senhahub-demo-auth-secret-change-before-production";
  }
  throw new Error("AUTH_SECRET precisa ter ao menos 32 caracteres em producao.");
}

function kioskConfiguration(environment = process.env) {
  return loadKioskConfiguration(environment);
}

async function getLocalKioskStatus(request, user, sessionOverride = null) {
  const session = sessionOverride || verifyKioskSession(
    getCookie(request, "senhahub_kiosk"),
    localKioskSecret()
  );
  const [kioskResult, sectorsResult, queueResult] = await Promise.all([
    session
      ? query(
        `
          SELECT *
          FROM public.print_kiosks
          WHERE id = $1 AND active = true AND session_nonce = $2
          LIMIT 1
        `,
        [session.kioskId, session.sessionNonce]
      )
      : Promise.resolve({ rows: [] }),
    query(
      `
        SELECT id, name, prefix, counter_label, service_label,
               current_number, queue_size, average_service_seconds,
               capacity, status, updated_at
        FROM public.sectors
        WHERE status = 'open'::public.sector_status
        ORDER BY id
      `
    ),
    query(
      `
        SELECT sector_id, count(*)::integer AS waiting_count
        FROM public.tickets
        WHERE status = ANY($1::public.ticket_status[])
        GROUP BY sector_id
      `,
      [ACTIVE_TICKET_STATUSES]
    )
  ]);

  const kiosk = kioskResult.rows[0] || null;
  const queueBySector = new Map(queueResult.rows.map((row) => [row.sector_id, Number(row.waiting_count)]));
  const sectors = sectorsResult.rows
    .filter((sector) => !kiosk || kiosk.mode !== "sector" || kiosk.sector_id === sector.id)
    .map((sector) => ({
      id: sector.id,
      name: sector.name,
      prefix: sector.prefix,
      counterLabel: sector.counter_label,
      serviceLabel: sector.service_label,
      currentNumber: Number(sector.current_number || 0),
      queueSize: queueBySector.get(sector.id) || 0,
      averageServiceSeconds: Number(sector.average_service_seconds || 60),
      capacity: Number(sector.capacity || 1),
      status: sector.status,
      updatedAt: sector.updated_at
    }));

  return {
    paired: Boolean(kiosk),
    canPair: Boolean(user && ADMIN_ROLES.has(user.role)),
    kiosk: kiosk ? kioskDto(kiosk) : null,
    sectors
  };
}

async function pairLocalKiosk(user, body = {}) {
  const configuration = kioskConfiguration();
  if (!user || !ADMIN_ROLES.has(user.role)) throw new Error("Acesso negado.");
  if (body.kioskId && String(body.kioskId) !== configuration.id) {
    throw new Error("Totem nao encontrado.");
  }

  const sessionNonce = crypto.randomBytes(24).toString("base64url");
  await query(
    `
      INSERT INTO public.print_kiosks (
        id, name, active, printer_name, printer_port, paper_width_mm,
        install_url, last_seen_at, created_at, updated_at, mode, sector_id,
        app_url, session_nonce
      )
      VALUES ($1, $2, true, $3, $4, $5, $6, NULL, now(), now(), $7, $8, $9, $10)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        active = true,
        printer_name = EXCLUDED.printer_name,
        printer_port = EXCLUDED.printer_port,
        paper_width_mm = EXCLUDED.paper_width_mm,
        install_url = EXCLUDED.install_url,
        updated_at = now(),
        mode = EXCLUDED.mode,
        sector_id = EXCLUDED.sector_id,
        app_url = EXCLUDED.app_url,
        session_nonce = EXCLUDED.session_nonce
    `,
    [
      configuration.id,
      configuration.name,
      configuration.printerName,
      configuration.printerPort,
      configuration.paperWidthMm,
      configuration.installUrl,
      configuration.mode,
      configuration.sectorId || null,
      configuration.appUrl,
      sessionNonce
    ]
  );

  await registerLocalEvent("totem_vinculado", "kiosk", configuration.id, null, null, { userId: user.id });
  return createKioskSession(configuration.id, localKioskSecret(), Date.now(), sessionNonce);
}

async function unpairLocalKiosk(user) {
  const configuration = kioskConfiguration();
  if (!user || !ADMIN_ROLES.has(user.role)) throw new Error("Acesso negado.");
  await query(
    `
      UPDATE public.print_kiosks
      SET active = false, session_nonce = $2, updated_at = now()
      WHERE id = $1
    `,
    [configuration.id, crypto.randomBytes(24).toString("base64url")]
  );
}

async function issueLocalPhysicalTicket(kioskSession, body = {}) {
  const input = Array.isArray(body.sectorIds) && body.sectorIds.length > 1
    ? validatePhysicalTicketBundleInput(body)
    : validatePhysicalTicketInput(body);
  if (input.error) throw new Error(input.error);

  const configuration = kioskConfiguration();
  const kioskResult = await query(
    "SELECT id, active, mode, sector_id, session_nonce FROM public.print_kiosks WHERE id = $1 LIMIT 1",
    [kioskSession.kioskId]
  );
  const kiosk = kioskResult.rows[0];
  if (!kiosk || !kiosk.active) throw new Error("Totem indisponivel.");
  if (!safeEqual(kiosk.session_nonce, kioskSession.sessionNonce)) {
    throw new Error("Sessao do totem revogada. Vincule o totem novamente.");
  }
  if (kiosk.mode === "sector" && kiosk.sector_id !== (input.sectorId || input.sectorIds[0])) {
    throw new Error("Este totem esta configurado para outro setor.");
  }
  if (kiosk.mode === "sector" && input.sectorIds) {
    throw new Error("Este totem permite apenas uma senha por vez.");
  }
  const rate = await consumeLocalRateLimit(`kiosk:issue:${kioskSession.kioskId}`, 12, 60);
  if (!rate) throw new Error("Limite de emissao atingido. Aguarde um minuto.");

  const priority = normalizePriority(body);
  const functionName = input.sectorIds ? "issue_physical_ticket_bundle" : "issue_physical_ticket";
  const values = input.sectorIds
    ? [
      kioskSession.kioskId,
      input.sectorIds,
      input.idempotencyKey,
      configuration.installUrl,
      configuration.appUrl,
      priority.enabled,
      priority.reason,
      30
    ]
    : [
      kioskSession.kioskId,
      input.sectorId,
      input.idempotencyKey,
      configuration.installUrl,
      configuration.appUrl,
      priority.enabled,
      priority.reason,
      30
    ];
  const result = await query(
    `SELECT public.${functionName}($1, $2, $3, $4, $5, $6, $7, $8) AS payload`,
    values
  );
  const payload = result.rows[0]?.payload;
  if (!payload?.ticket || !payload?.printJob) throw new Error("Nao foi possivel emitir a senha fisica agora.");

  const rawTickets = Array.isArray(payload.tickets) && payload.tickets.length
    ? payload.tickets
    : [payload.ticket];
  const tickets = [];
  for (const rawTicket of rawTickets) {
    const ticket = await getLocalPublicTicket(rawTicket.id);
    if (ticket) tickets.push(ticket);
  }

  const response = {
    ticket: tickets[0] || payload.ticket,
    tickets,
    printJob: printJobDto(payload.printJob),
    alreadyExists: Boolean(payload.alreadyExists)
  };
  if (!response.alreadyExists) {
    for (const ticket of rawTickets) {
      await registerLocalEvent("senha_fisica_emitida", "ticket", ticket.id, null, ticket.sector_id, {
        code: ticket.code,
        kioskId: kioskSession.kioskId,
        printJobId: payload.printJob.id,
        bundle: Boolean(input.sectorIds)
      });
    }
  }
  if (!input.sectorIds) delete response.tickets;
  return response;
}

async function getLocalPrintJob(kioskSession, jobId) {
  const result = await query(
    `
      SELECT j.*
      FROM public.print_jobs j
      JOIN public.print_kiosks k ON k.id = j.kiosk_id
      WHERE j.id = $1
        AND j.kiosk_id = $2
        AND k.active = true
        AND k.session_nonce = $3
      LIMIT 1
    `,
    [jobId, kioskSession.kioskId, kioskSession.sessionNonce]
  );
  return result.rows[0] ? printJobDto(result.rows[0]) : null;
}

async function claimLocalPrintJob(kioskId) {
  return withTransaction(async (client) => {
    const kioskResult = await client.query(
      "SELECT id FROM public.print_kiosks WHERE id = $1 AND active = true FOR UPDATE",
      [kioskId]
    );
    if (!kioskResult.rowCount) return null;

    const jobResult = await client.query(
      `
        SELECT *
        FROM public.print_jobs
        WHERE kiosk_id = $1
          AND attempts < 5
          AND (
            status = 'pending'
            OR status = 'failed'
            OR (status = 'printing' AND claimed_at < now() - interval '2 minutes')
          )
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `,
      [kioskId]
    );
    const job = jobResult.rows[0];
    if (!job) {
      await client.query("UPDATE public.print_kiosks SET last_seen_at = now() WHERE id = $1", [kioskId]);
      return null;
    }

    if (job.status === "printing") {
      await client.query(
        `
          UPDATE public.print_job_attempts
          SET status = 'reprocessed', finished_at = now(),
              duration_ms = GREATEST(0, (extract(epoch from (now() - started_at)) * 1000)::bigint),
              error_message = 'Tentativa retomada apos expirar o tempo de processamento.'
          WHERE job_id = $1 AND status = 'printing'
        `,
        [job.id]
      );
    }

    const updatedResult = await client.query(
      `
        UPDATE public.print_jobs
        SET status = 'printing', attempts = attempts + 1,
            claimed_at = now(), updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [job.id]
    );
    const updated = updatedResult.rows[0];
    await client.query(
      `
        INSERT INTO public.print_job_attempts (
          id, job_id, kiosk_id, attempt_number, started_at, finished_at,
          duration_ms, status, error_message, created_at
        )
        VALUES (gen_random_uuid(), $1, $2, $3, now(), NULL, NULL, 'printing', NULL, now())
      `,
      [updated.id, kioskId, updated.attempts]
    );
    await client.query("UPDATE public.print_kiosks SET last_seen_at = now() WHERE id = $1", [kioskId]);
    return printJobDto(updated);
  });
}

async function finishLocalPrintJob(jobId, kioskId, success, errorMessage = null) {
  return withTransaction(async (client) => {
    const jobResult = await client.query(
      `
        UPDATE public.print_jobs
        SET status = CASE WHEN $3 THEN 'printed' ELSE 'failed' END,
            printed_at = CASE WHEN $3 THEN now() ELSE NULL END,
            failed_at = CASE WHEN $3 THEN NULL ELSE now() END,
            last_error = CASE WHEN $3 THEN NULL ELSE left(coalesce($4, 'Falha de impressao.'), 500) END,
            updated_at = now()
        WHERE id = $1 AND kiosk_id = $2 AND status = 'printing'
        RETURNING *
      `,
      [jobId, kioskId, Boolean(success), String(errorMessage || "").slice(0, 500) || null]
    );
    const job = jobResult.rows[0];
    if (!job) throw new Error("Trabalho de impressao nao esta em processamento.");

    await client.query(
      `
        UPDATE public.print_job_attempts
        SET status = CASE WHEN $2 THEN 'printed' ELSE 'failed' END,
            finished_at = now(),
            duration_ms = GREATEST(0, (extract(epoch from (now() - started_at)) * 1000)::bigint),
            error_message = CASE WHEN $2 THEN NULL ELSE $3 END
        WHERE id = (
          SELECT id FROM public.print_job_attempts
          WHERE job_id = $1 AND status = 'printing'
          ORDER BY started_at DESC
          LIMIT 1
        )
      `,
      [jobId, Boolean(success), String(errorMessage || "").slice(0, 500) || null]
    );
    await client.query("UPDATE public.print_kiosks SET last_seen_at = now() WHERE id = $1", [kioskId]);
    return printJobDto(job);
  });
}

async function consumeLocalRateLimit(rateKey, limit, windowSeconds) {
  return withTransaction(async (client) => {
    const result = await client.query(
      "SELECT * FROM public.security_rate_limits WHERE rate_key = $1 FOR UPDATE",
      [rateKey]
    );
    const row = result.rows[0];
    if (!row) {
      await client.query(
        `
          INSERT INTO public.security_rate_limits (rate_key, window_started_at, request_count, updated_at)
          VALUES ($1, now(), 1, now())
        `,
        [rateKey]
      );
      return true;
    }

    const age = Date.now() - new Date(row.window_started_at).getTime();
    if (age >= Number(windowSeconds) * 1000) {
      await client.query(
        `
          UPDATE public.security_rate_limits
          SET window_started_at = now(), request_count = 1, updated_at = now()
          WHERE rate_key = $1
        `,
        [rateKey]
      );
      return true;
    }
    if (Number(row.request_count) >= Number(limit)) return false;
    await client.query(
      "UPDATE public.security_rate_limits SET request_count = request_count + 1, updated_at = now() WHERE rate_key = $1",
      [rateKey]
    );
    return true;
  });
}

function normalizePriority(body) {
  const requested = body?.priority === true || body?.preferential === true || body?.isPriority === true;
  const reason = String(body?.priorityReason || body?.preferentialReason || body?.priorityCategory || "").trim();
  if (!requested && !reason) return { enabled: false, reason: null };
  if (!PRIORITY_REASONS.has(reason)) throw new Error("Motivo de prioridade invalido.");
  return { enabled: true, reason };
}

async function registerLocalEvent(type, entityType, entityId, customerId, sectorId, payload = {}) {
  await query(
    `
      INSERT INTO public.events (type, entity_type, entity_id, customer_id, sector_id, payload)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [type, entityType, entityId, customerId, sectorId, JSON.stringify(payload)]
  );
}

function kioskDto(row) {
  return {
    id: row.id,
    name: row.name,
    mode: row.mode === "sector" ? "sector" : "central",
    sectorId: row.sector_id || null,
    printerName: row.printer_name,
    printerPort: row.printer_port,
    paperWidthMm: Number(row.paper_width_mm),
    installUrl: row.install_url,
    appUrl: row.app_url || kioskConfiguration().appUrl,
    lastSeenAt: row.last_seen_at
  };
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length > 0
    && leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

module.exports = {
  getLocalKioskStatus,
  getLocalPrintJob,
  issueLocalPhysicalTicket,
  kioskConfiguration,
  localKioskSecret,
  pairLocalKiosk,
  claimLocalPrintJob,
  finishLocalPrintJob,
  unpairLocalKiosk
};
