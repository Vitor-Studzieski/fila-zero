const crypto = require("node:crypto");
const { query, withTransaction } = require("./local-postgres");

const WAITING_STATUSES = [
  "aguardando",
  "proximo",
  "espera_inteligente",
  "standby"
];

const ACTIVE_STATUSES = [
  "aguardando",
  "proximo",
  "chamado",
  "em_atendimento",
  "espera_inteligente",
  "standby"
];

const CALL_ELIGIBLE_STATUSES = ["aguardando", "proximo", "standby"];
const CALL_BLOCKING_STATUSES = ["chamado", "em_atendimento"];
const CUSTOMER_CANCELABLE_STATUSES = ["aguardando", "proximo", "chamado", "espera_inteligente", "standby"];
const STAFF_SKIPPABLE_STATUSES = ["aguardando", "proximo", "chamado", "standby", "espera_inteligente"];
const SKIP_REASONS = new Set(["cliente_ausente", "cancelamento", "erro_operacional"]);
const STANDBY_SECONDS = 10 * 60;

const PRIORITY_REASONS = new Set([
  "deficiencia_ou_mobilidade_reduzida",
  "tea",
  "idoso_60_mais",
  "gestante_ou_lactante",
  "crianca_de_colo",
  "obesidade"
]);

const MAX_ACTIVE_TICKETS_PER_CUSTOMER = 3;
const AUTO_CALL_DELAY_SECONDS = 30;
const BUSINESS_TIME_ZONE = "America/Sao_Paulo";

async function listOpenSectors() {
  const result = await query(
    `
      SELECT
        id,
        name,
        prefix,
        counter_label,
        service_label,
        current_number,
        queue_size,
        average_service_seconds,
        capacity,
        status,
        updated_at
      FROM public.sectors
      WHERE status = $1::public.sector_status
      ORDER BY id
    `,
    ["open"]
  );

  return result.rows;
}

async function listWaitingTickets(sectorId = null) {
  const values = [WAITING_STATUSES];
  let filter = "status = ANY($1::public.ticket_status[])";

  if (sectorId) {
    values.push(sectorId);
    filter += " AND sector_id = $2";
  }

  const result = await query(
    `
      SELECT
        id,
        customer_id,
        sector_id,
        customer_name,
        number,
        code,
        status,
        queue_order,
        priority,
        priority_reason,
        eligible_at,
        created_at,
        updated_at
      FROM public.tickets
      WHERE ${filter}
      ORDER BY priority DESC, queue_order ASC, created_at ASC
    `,
    values
  );

  return result.rows;
}

async function getQueueSnapshot(sectorId = null) {
  const [sectors, tickets] = await Promise.all([
    listOpenSectors(),
    listWaitingTickets(sectorId)
  ]);

  return { sectors, tickets };
}

async function getCustomerState(customerId) {
  const normalizedCustomerId = normalizeRequiredId(customerId, "customerId");
  const [sectorResult, ticketResult, activeSectorResult, counterResult, businessDateResult] = await Promise.all([
    query(
      `
        SELECT id, name, prefix, counter_label, service_label,
               current_number, queue_size, average_service_seconds, capacity,
               status, updated_at
        FROM public.sectors
        ORDER BY id
      `
    ),
    query(
      `
        SELECT *
        FROM public.tickets
        WHERE customer_id = $1
          AND status = ANY($2::public.ticket_status[])
        ORDER BY created_at ASC
      `,
      [normalizedCustomerId, ACTIVE_STATUSES]
    ),
    query(
      `
        SELECT *
        FROM public.tickets
        WHERE status = ANY($1::public.ticket_status[])
        ORDER BY sector_id, priority DESC, queue_order ASC, created_at ASC
      `,
      [ACTIVE_STATUSES]
    ),
    query("SELECT sector_id, business_date, last_number FROM public.ticket_counters"),
    query("SELECT (now() AT TIME ZONE $1)::date AS business_date", [BUSINESS_TIME_ZONE])
  ]);

  const sectors = sectorResult.rows.map((sector) => publicSectorDto(sector, counterResult.rows, businessDateResult.rows[0].business_date, activeSectorResult.rows));
  const sectorById = new Map(sectorResult.rows.map((sector) => [sector.id, sector]));
  const rowsBySector = groupRowsBySector(activeSectorResult.rows);
  const tickets = ticketResult.rows
    .map((ticket) => publicTicketDto(
      ticket,
      sectorById.get(ticket.sector_id),
      rowsBySector.get(ticket.sector_id) || [],
      counterResult.rows,
      businessDateResult.rows[0].business_date
    ))
    .filter(Boolean);

  return {
    serverTime: new Date().toISOString(),
    sectors,
    tickets
  };
}

async function upsertLocalDevice(customerId, requestedDeviceId, userAgent = "") {
  const normalizedCustomerId = normalizeRequiredId(customerId, "customerId");
  let deviceId = normalizeOptionalId(requestedDeviceId) || `device-${crypto.randomUUID()}`;

  return withTransaction(async (client) => {
    const existing = await client.query(
      "SELECT customer_id FROM public.devices WHERE id = $1 FOR UPDATE",
      [deviceId]
    );
    if (existing.rowCount && String(existing.rows[0].customer_id) !== normalizedCustomerId) {
      deviceId = `device-${crypto.randomUUID()}`;
    }

    const result = await client.query(
      `
        INSERT INTO public.devices (id, customer_id, user_agent, last_seen_at)
        VALUES ($1, $2, $3, now())
        ON CONFLICT (id) DO UPDATE SET
          user_agent = EXCLUDED.user_agent,
          last_seen_at = now()
        RETURNING id, customer_id, user_agent, last_seen_at
      `,
      [deviceId, normalizedCustomerId, String(userAgent || "").slice(0, 500)]
    );
    return { deviceId: result.rows[0].id, customerId: result.rows[0].customer_id };
  });
}

async function getLocalStaffState(user = null) {
  const sectorResult = await query(
    `
      SELECT id, name, prefix, counter_label, service_label,
             current_number, queue_size, average_service_seconds, capacity,
             status, updated_at
      FROM public.sectors
      ORDER BY id
    `
  );
  const visibleSectors = sectorResult.rows.filter((sector) => canAccessLocalSector(user, sector.id));
  if (!visibleSectors.length) return { serverTime: new Date().toISOString(), sectors: [] };

  const sectorIds = visibleSectors.map((sector) => sector.id);
  const [ticketResult, counterResult, callsResult, businessDateResult] = await Promise.all([
    query(
      `
        SELECT *
        FROM public.tickets
        WHERE sector_id = ANY($1::text[])
          AND status = ANY($2::public.ticket_status[])
        ORDER BY sector_id, priority DESC, queue_order ASC, created_at ASC
      `,
      [sectorIds, ACTIVE_STATUSES]
    ),
    query(
      "SELECT sector_id, business_date, last_number, preferential_streak FROM public.ticket_counters WHERE sector_id = ANY($1::text[])",
      [sectorIds]
    ),
    query(
      `
        SELECT c.sector_id, c.action, c.created_at,
               t.customer_name, t.number, t.code, t.status, t.priority
        FROM public.calls c
        JOIN public.tickets t ON t.id = c.ticket_id
        WHERE c.sector_id = ANY($1::text[])
        ORDER BY c.created_at DESC
        LIMIT 100
      `,
      [sectorIds]
    ),
    query("SELECT (now() AT TIME ZONE $1)::date AS business_date", [BUSINESS_TIME_ZONE])
  ]);

  const sectorById = new Map(visibleSectors.map((sector) => [sector.id, sector]));
  const rowsBySector = groupRowsBySector(ticketResult.rows);
  const counters = counterResult.rows;
  const businessDate = businessDateResult.rows[0].business_date;
  const callsBySector = new Map(sectorIds.map((sectorId) => [sectorId, []]));
  for (const row of callsResult.rows) {
    const calls = callsBySector.get(row.sector_id);
    if (!calls || calls.length >= 6) continue;
    calls.push({
      action: row.action,
      customerName: normalizeCustomerName(row.customer_name),
      ticketNumber: row.number,
      ticket: row.code,
      status: row.status,
      priority: Boolean(row.priority),
      createdAt: row.created_at
    });
  }

  return {
    serverTime: new Date().toISOString(),
    sectors: visibleSectors.map((sector) => {
      const rows = rowsBySector.get(sector.id) || [];
      const recentCalls = callsBySector.get(sector.id) || [];
      const latestCall = recentCalls.find((call) => call.action === "senha_chamada");
      const tickets = rows.map((ticket) => publicTicketDto(
        ticket,
        sectorById.get(ticket.sector_id),
        rows,
        counters,
        businessDate
      ));
      return {
        ...publicSectorDto(sector, counters, businessDate, rows),
        current: latestCall?.ticket || publicSectorDto(sector, counters, businessDate, rows).current,
        currentCustomerName: latestCall?.customerName || "",
        tickets,
        recentCalls
      };
    })
  };
}

async function callNextLocalTicket(sectorId, user = null) {
  const normalizedSectorId = normalizeRequiredId(sectorId, "sectorId");
  if (!canAccessLocalSector(user, normalizedSectorId)) {
    throw new Error("Usuário sem permissão para este setor.");
  }

  return withTransaction(async (client) => {
    const sectorResult = await client.query(
      "SELECT * FROM public.sectors WHERE id = $1 FOR UPDATE",
      [normalizedSectorId]
    );
    const sector = sectorResult.rows[0];
    if (!sector) throw new Error("Setor não encontrado.");
    if (sector.status !== "open") throw new Error("Setor fechado.");

    const counterResult = await client.query(
      "SELECT preferential_streak FROM public.ticket_counters WHERE sector_id = $1 FOR UPDATE",
      [normalizedSectorId]
    );
    const preferentialStreak = Number(counterResult.rows[0]?.preferential_streak || 0);
    const queueResult = await client.query(
      `
        SELECT *
        FROM public.tickets
        WHERE sector_id = $1
          AND status = ANY($2::public.ticket_status[])
        ORDER BY queue_order ASC, created_at ASC
        FOR UPDATE SKIP LOCKED
      `,
      [normalizedSectorId, CALL_ELIGIBLE_STATUSES.filter((status) => status !== "standby")]
    );

    const preferentialQueue = queueResult.rows.filter((ticket) => ticket.priority);
    const commonQueue = queueResult.rows.filter((ticket) => !ticket.priority);
    const targetPriority = preferentialQueue.length && (!commonQueue.length || preferentialStreak < 2);
    const orderedQueue = [
      ...queueResult.rows.filter((ticket) => Boolean(ticket.priority) === Boolean(targetPriority)),
      ...(preferentialQueue.length && commonQueue.length
        ? queueResult.rows.filter((ticket) => Boolean(ticket.priority) !== Boolean(targetPriority))
        : [])
    ];

    for (const candidate of orderedQueue) {
      const conflictResult = await client.query(
        `
          SELECT id, code
          FROM public.tickets
          WHERE customer_id = $1
            AND status = ANY($2::public.ticket_status[])
            AND id <> $3
          ORDER BY updated_at DESC
          LIMIT 1
        `,
        [candidate.customer_id, CALL_BLOCKING_STATUSES, candidate.id]
      );
      const conflict = conflictResult.rows[0];
      if (conflict) {
        await client.query(
          `
            UPDATE public.tickets
            SET status = 'espera_inteligente'::public.ticket_status,
                smart_wait_reason = $2,
                blocked_by_ticket_id = $3,
                smart_wait_since = now(),
                updated_at = now()
            WHERE id = $1
          `,
          [candidate.id, `Cliente já possui a senha ${conflict.code} em atendimento ou chamada.`, conflict.id]
        );
        continue;
      }

      const updatedResult = await client.query(
        `
          UPDATE public.tickets
          SET status = 'chamado'::public.ticket_status,
              called_at = now(),
              standby_started_at = NULL,
              standby_expires_at = NULL,
              updated_at = now()
          WHERE id = $1
          RETURNING *
        `,
        [candidate.id]
      );
      await client.query(
        `INSERT INTO public.calls (id, ticket_id, sector_id, action) VALUES (gen_random_uuid(), $1, $2, $3)`,
        [candidate.id, normalizedSectorId, "senha_chamada"]
      );
      await client.query(
        `
          UPDATE public.ticket_counters
          SET preferential_streak = $2,
              updated_at = now()
          WHERE sector_id = $1
        `,
        [normalizedSectorId, candidate.priority ? Math.min(preferentialStreak + 1, 2) : 0]
      );
      await client.query(
        `
          INSERT INTO public.events (type, entity_type, entity_id, customer_id, sector_id, payload)
          VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        `,
        ["senha_chamada", "ticket", candidate.id, candidate.customer_id, normalizedSectorId, JSON.stringify({ code: candidate.code })]
      );

      const currentRows = await client.query(
        "SELECT * FROM public.tickets WHERE sector_id = $1 AND status = ANY($2::public.ticket_status[])",
        [normalizedSectorId, ACTIVE_STATUSES]
      );
      const counters = await client.query(
        "SELECT sector_id, business_date, last_number FROM public.ticket_counters WHERE sector_id = $1",
        [normalizedSectorId]
      );
      return {
        ticket: publicTicketDto(
          updatedResult.rows[0],
          sector,
          currentRows.rows,
          counters.rows,
          null
        )
      };
    }

    return { ticket: null, message: "Nenhuma senha elegível para chamada." };
  });
}

async function getLocalCart(customerId) {
  const normalizedCustomerId = normalizeRequiredId(customerId, "customerId");
  const result = await query(
    `
      SELECT id, customer_id, product_id, product_name, sector_name, price,
             quantity, created_at, updated_at
      FROM public.cart_items
      WHERE customer_id = $1
      ORDER BY updated_at DESC, created_at DESC
    `,
    [normalizedCustomerId]
  );
  return { items: result.rows.map(publicCartItemDto) };
}

async function addLocalCartItem(customerId, input = {}) {
  const normalizedCustomerId = normalizeRequiredId(customerId, "customerId");
  const productId = normalizeRequiredId(input.productId, "productId");
  const productName = normalizeCustomerName(input.productName || productId);
  const sectorName = normalizeCustomerName(input.sectorName || "Mercado");
  const price = String(input.price || "").trim().slice(0, 80) || "--";

  const result = await query(
    `
      INSERT INTO public.cart_items (
        id, customer_id, product_id, product_name, sector_name, price, quantity
      )
      VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 1)
      ON CONFLICT (customer_id, product_id) DO UPDATE SET
        quantity = public.cart_items.quantity + 1,
        product_name = EXCLUDED.product_name,
        sector_name = EXCLUDED.sector_name,
        price = EXCLUDED.price,
        updated_at = now()
      RETURNING id, customer_id, product_id, product_name, sector_name, price,
                quantity, created_at, updated_at
    `,
    [normalizedCustomerId, productId, productName, sectorName, price]
  );
  return { item: publicCartItemDto(result.rows[0]) };
}

async function recordLocalShoppingSignal(customerId, input = {}) {
  const normalizedCustomerId = normalizeRequiredId(customerId, "customerId");
  await query(
    `
      INSERT INTO public.shopping_signals (
        customer_id, signal_type, query, product_id, product_name, sector_name
      )
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [
      normalizedCustomerId,
      String(input.type || input.signalType || "interaction").slice(0, 80),
      input.query ? String(input.query).slice(0, 240) : null,
      input.productId ? String(input.productId).slice(0, 120) : null,
      input.productName ? String(input.productName).slice(0, 240) : null,
      input.sectorName ? String(input.sectorName).slice(0, 160) : null
    ]
  );
  return { ok: true };
}

async function runLocalMaintenance() {
  return withTransaction(async (client) => {
    const sessionsResult = await client.query(
      "DELETE FROM auth.sessions WHERE expires_at <= now()"
    );

    const staleResult = await client.query(
      `
        SELECT *
        FROM public.tickets
        WHERE status = ANY($1::public.ticket_status[])
          AND (created_at AT TIME ZONE $2)::date <> (now() AT TIME ZONE $2)::date
        FOR UPDATE SKIP LOCKED
      `,
      [ACTIVE_STATUSES, BUSINESS_TIME_ZONE]
    );
    for (const ticket of staleResult.rows) {
      await client.query(
        `
          UPDATE public.tickets
          SET status = 'expirado'::public.ticket_status,
              expired_at = now(),
              called_at = NULL,
              smart_wait_reason = NULL,
              blocked_by_ticket_id = NULL,
              smart_wait_since = NULL,
              updated_at = now()
          WHERE id = $1
        `,
        [ticket.id]
      );
      await client.query(
        `
          INSERT INTO public.events (type, entity_type, entity_id, customer_id, sector_id, payload)
          VALUES ($1, 'ticket', $2, $3, $4, $5::jsonb)
        `,
        [
          "senha_expirada_por_reset_diario",
          ticket.id,
          ticket.customer_id,
          ticket.sector_id,
          JSON.stringify({ code: ticket.code })
        ]
      );
      await releaseSmartWaitTicketInTransaction(client, ticket.customer_id);
    }

    const absentResult = await client.query(
      `
        SELECT *
        FROM public.tickets
        WHERE status = 'chamado'::public.ticket_status
          AND service_started_at IS NULL
          AND called_at IS NOT NULL
          AND called_at <= now() - make_interval(secs => $1)
        FOR UPDATE SKIP LOCKED
      `,
      [10 * 60]
    );
    let movedToStandby = 0;
    let canceledByAbsence = 0;
    for (const ticket of absentResult.rows) {
      const absenceCount = Number(ticket.absence_count || 0) + 1;
      const cancel = absenceCount >= 2;
      await client.query(
        `
          UPDATE public.tickets
          SET status = $2::public.ticket_status,
              absence_count = $3,
              canceled_at = CASE WHEN $4 THEN now() ELSE NULL END,
              called_at = NULL,
              standby_started_at = CASE WHEN $4 THEN NULL ELSE now() END,
              standby_expires_at = CASE WHEN $4 THEN NULL ELSE now() + make_interval(secs => $5) END,
              queue_order = CASE WHEN $4 THEN queue_order ELSE queue_order + 1000 END,
              updated_at = now()
          WHERE id = $1
        `,
        [ticket.id, cancel ? "cancelado" : "standby", absenceCount, cancel, STANDBY_SECONDS]
      );
      await client.query(
        `
          INSERT INTO public.events (type, entity_type, entity_id, customer_id, sector_id, payload)
          VALUES ($1, 'ticket', $2, $3, $4, $5::jsonb)
        `,
        [
          cancel ? "senha_cancelada_por_ausencia" : "senha_em_standby_por_ausencia",
          ticket.id,
          ticket.customer_id,
          ticket.sector_id,
          JSON.stringify({ code: ticket.code, absenceCount })
        ]
      );
      await releaseSmartWaitTicketInTransaction(client, ticket.customer_id);
      if (cancel) canceledByAbsence += 1;
      else movedToStandby += 1;
    }

    const expiredStandbyResult = await client.query(
      `
        SELECT *
        FROM public.tickets
        WHERE status = 'standby'::public.ticket_status
          AND standby_expires_at IS NOT NULL
          AND standby_expires_at <= now()
        FOR UPDATE SKIP LOCKED
      `
    );
    for (const ticket of expiredStandbyResult.rows) {
      await client.query(
        `
          UPDATE public.tickets
          SET status = 'cancelado'::public.ticket_status,
              canceled_at = now(),
              standby_started_at = NULL,
              standby_expires_at = NULL,
              updated_at = now()
          WHERE id = $1
        `,
        [ticket.id]
      );
      await client.query(
        `
          INSERT INTO public.events (type, entity_type, entity_id, customer_id, sector_id, payload)
          VALUES ($1, 'ticket', $2, $3, $4, $5::jsonb)
        `,
        [
          "senha_cancelada_por_standby_expirado",
          ticket.id,
          ticket.customer_id,
          ticket.sector_id,
          JSON.stringify({ code: ticket.code })
        ]
      );
      await releaseSmartWaitTicketInTransaction(client, ticket.customer_id);
    }

    return {
      expiredSessions: sessionsResult.rowCount,
      expiredTickets: staleResult.rowCount,
      movedToStandby,
      canceledByAbsence,
      canceledStandby: expiredStandbyResult.rowCount
    };
  });
}

async function createTicket(input = {}) {
  return withTransaction((client) => insertTicketInTransaction(client, input));
}

async function cancelTicket(ticketId, customerId) {
  const normalizedTicketId = normalizeRequiredId(ticketId, "ticketId");
  const normalizedCustomerId = normalizeRequiredId(customerId, "customerId");

  return withTransaction(async (client) => {
    const result = await client.query(
      `
        SELECT *
        FROM public.tickets
        WHERE id = $1
          AND customer_id = $2
          AND status = ANY($3::public.ticket_status[])
        FOR UPDATE
      `,
      [normalizedTicketId, normalizedCustomerId, CUSTOMER_CANCELABLE_STATUSES]
    );
    const ticket = result.rows[0];
    if (!ticket) throw new Error("Senha não encontrada ou não pode mais ser cancelada.");

    const updatedResult = await client.query(
      `
        UPDATE public.tickets
        SET status = 'cancelado'::public.ticket_status,
            canceled_at = now(),
            smart_wait_reason = NULL,
            blocked_by_ticket_id = NULL,
            smart_wait_since = NULL,
            standby_started_at = NULL,
            standby_expires_at = NULL,
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [normalizedTicketId]
    );

    await client.query(
      `
        INSERT INTO public.events (type, entity_type, entity_id, customer_id, sector_id, payload)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      `,
      [
        "senha_cancelada_pelo_cliente",
        "ticket",
        normalizedTicketId,
        normalizedCustomerId,
        ticket.sector_id,
        JSON.stringify({ code: ticket.code, previousStatus: ticket.status })
      ]
    );

    return { ticket: updatedResult.rows[0] };
  });
}

async function confirmLocalTicket(ticketId, user = null) {
  const normalizedTicketId = normalizeRequiredId(ticketId, "ticketId");

  return withTransaction(async (client) => {
    const ticketResult = await client.query(
      "SELECT * FROM public.tickets WHERE id = $1 FOR UPDATE",
      [normalizedTicketId]
    );
    const ticket = ticketResult.rows[0];
    if (!ticket) throw new Error("Senha não encontrada.");
    if (!canOperateLocalTicket(user, ticket)) {
      throw new Error("Usuário sem permissão para este setor.");
    }
    if (ticket.status !== "chamado") {
      throw new Error("A senha precisa estar chamada para iniciar atendimento.");
    }

    const blockingResult = await client.query(
      `
        SELECT id, code
        FROM public.tickets
        WHERE id <> $1
          AND customer_id = $2
          AND status = 'em_atendimento'::public.ticket_status
        LIMIT 1
        FOR UPDATE
      `,
      [ticket.id, ticket.customer_id]
    );
    if (blockingResult.rowCount) {
      throw new Error("Cliente já possui outro atendimento em andamento.");
    }

    const updatedResult = await client.query(
      `
        UPDATE public.tickets
        SET status = 'em_atendimento'::public.ticket_status,
            service_started_at = COALESCE(service_started_at, now()),
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [ticket.id]
    );
    const updatedTicket = updatedResult.rows[0];

    await client.query(
      `
        INSERT INTO public.services (ticket_id, sector_id, customer_id, started_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (ticket_id) WHERE finished_at IS NULL DO NOTHING
      `,
      [updatedTicket.id, updatedTicket.sector_id, updatedTicket.customer_id, updatedTicket.service_started_at]
    );
    await insertLocalEvent(client, "atendimento_iniciado", updatedTicket, {
      code: updatedTicket.code
    });

    return {
      source: "postgres-local",
      ticket: await loadLocalTicketDto(client, updatedTicket.id)
    };
  });
}

async function finishLocalTicket(ticketId, user = null) {
  const normalizedTicketId = normalizeRequiredId(ticketId, "ticketId");

  return withTransaction(async (client) => {
    const ticketResult = await client.query(
      "SELECT * FROM public.tickets WHERE id = $1 FOR UPDATE",
      [normalizedTicketId]
    );
    const ticket = ticketResult.rows[0];
    if (!ticket) throw new Error("Senha não encontrada.");
    if (!canOperateLocalTicket(user, ticket)) {
      throw new Error("Usuário sem permissão para este setor.");
    }
    if (ticket.status !== "em_atendimento") {
      throw new Error("A senha precisa estar em atendimento para finalizar pedido.");
    }

    const updatedResult = await client.query(
      `
        UPDATE public.tickets
        SET status = 'atendido'::public.ticket_status,
            finished_at = now(),
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [ticket.id]
    );
    const updatedTicket = updatedResult.rows[0];

    await client.query(
      `
        UPDATE public.services
        SET finished_at = $2
        WHERE ticket_id = $1
          AND finished_at IS NULL
      `,
      [updatedTicket.id, updatedTicket.finished_at]
    );
    await client.query(
      `
        UPDATE public.sectors
        SET current_number = GREATEST(current_number, $2), updated_at = now()
        WHERE id = $1
      `,
      [updatedTicket.sector_id, updatedTicket.number]
    );
    await insertLocalEvent(client, "pedido_finalizado", updatedTicket, {
      code: updatedTicket.code
    });

    const releasedTicket = await releaseSmartWaitTicketInTransaction(client, updatedTicket.customer_id);
    return {
      source: "postgres-local",
      finishedTicket: await loadLocalTicketDto(client, updatedTicket.id),
      releasedTicket: releasedTicket ? await loadLocalTicketDto(client, releasedTicket.id) : null
    };
  });
}

async function skipLocalTicket(ticketId, user = null, reason) {
  const normalizedTicketId = normalizeRequiredId(ticketId, "ticketId");
  const normalizedReason = normalizeOptionalId(reason);
  if (!SKIP_REASONS.has(normalizedReason)) {
    throw new Error("Informe um motivo obrigatório para pular a senha.");
  }

  return withTransaction(async (client) => {
    const ticketResult = await client.query(
      "SELECT * FROM public.tickets WHERE id = $1 FOR UPDATE",
      [normalizedTicketId]
    );
    const ticket = ticketResult.rows[0];
    if (!ticket) throw new Error("Senha não encontrada.");
    if (!canAccessLocalSector(user, ticket.sector_id)) {
      throw new Error("Usuário sem permissão para este setor.");
    }
    if (!STAFF_SKIPPABLE_STATUSES.includes(ticket.status)) {
      throw new Error("Esta senha não pode ser pulada neste status.");
    }

    const absenceCount = normalizedReason === "cliente_ausente"
      ? Number(ticket.absence_count || 0) + 1
      : Number(ticket.absence_count || 0);
    const isStandby = normalizedReason === "cliente_ausente";
    const updatedResult = await client.query(
      `
        UPDATE public.tickets
        SET status = $2::public.ticket_status,
            absence_count = $3,
            canceled_at = CASE WHEN $4 THEN NULL ELSE now() END,
            called_at = NULL,
            smart_wait_reason = NULL,
            blocked_by_ticket_id = NULL,
            smart_wait_since = NULL,
            standby_started_at = CASE WHEN $4 THEN now() ELSE NULL END,
            standby_expires_at = CASE WHEN $4 THEN now() + make_interval(secs => $5) ELSE NULL END,
            queue_order = CASE WHEN $4 THEN queue_order + 1000 ELSE queue_order END,
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [ticket.id, isStandby ? "standby" : "cancelado", absenceCount, isStandby, STANDBY_SECONDS]
    );
    const updatedTicket = updatedResult.rows[0];

    await client.query(
      `
        INSERT INTO public.calls (ticket_id, sector_id, action)
        VALUES ($1, $2, $3)
      `,
      [updatedTicket.id, updatedTicket.sector_id, `senha_pulada:${normalizedReason}`]
    );
    await insertLocalEvent(client, "senha_pulada_pelo_atendente", updatedTicket, {
      code: updatedTicket.code,
      previousStatus: ticket.status,
      reason: normalizedReason,
      absenceCount
    });

    const releasedTicket = CALL_BLOCKING_STATUSES.includes(ticket.status)
      ? await releaseSmartWaitTicketInTransaction(client, ticket.customer_id)
      : null;
    return {
      source: "postgres-local",
      skippedTicket: await loadLocalTicketDto(client, updatedTicket.id),
      releasedTicket: releasedTicket ? await loadLocalTicketDto(client, releasedTicket.id) : null
    };
  });
}

async function releaseSmartWaitTicketInTransaction(client, customerId) {
  const nextResult = await client.query(
    `
      SELECT *
      FROM public.tickets
      WHERE customer_id = $1
        AND status = 'espera_inteligente'::public.ticket_status
      ORDER BY COALESCE(smart_wait_since, created_at) ASC
      LIMIT 1
      FOR UPDATE
    `,
    [customerId]
  );
  const next = nextResult.rows[0];
  if (!next) return null;

  const releasedResult = await client.query(
    `
      UPDATE public.tickets
      SET status = 'aguardando'::public.ticket_status,
          called_at = NULL,
          eligible_at = now(),
          smart_wait_reason = NULL,
          blocked_by_ticket_id = NULL,
          smart_wait_since = NULL,
          updated_at = now()
      WHERE id = $1
        AND status = 'espera_inteligente'::public.ticket_status
      RETURNING *
    `,
    [next.id]
  );
  const released = releasedResult.rows[0];
  if (!released) return null;

  await insertLocalEvent(client, "espera_inteligente_liberada", released, {
    code: released.code
  });
  return released;
}

async function insertLocalEvent(client, type, ticket, payload = {}) {
  await client.query(
    `
      INSERT INTO public.events (type, entity_type, entity_id, customer_id, sector_id, payload)
      VALUES ($1, 'ticket', $2, $3, $4, $5::jsonb)
    `,
    [type, ticket.id, ticket.customer_id, ticket.sector_id, JSON.stringify(payload)]
  );
}

async function loadLocalTicketDto(client, ticketId) {
  const ticketResult = await client.query(
    "SELECT * FROM public.tickets WHERE id = $1",
    [ticketId]
  );
  const ticket = ticketResult.rows[0];
  if (!ticket) return null;

  const sectorResult = await client.query(
    `
      SELECT id, name, prefix, counter_label, service_label,
             current_number, queue_size, average_service_seconds, capacity,
             status, updated_at
      FROM public.sectors
      WHERE id = $1
    `,
    [ticket.sector_id]
  );
  const sector = sectorResult.rows[0];
  if (!sector) return null;

  const [rowsResult, countersResult] = await Promise.all([
    client.query(
      `
        SELECT *
        FROM public.tickets
        WHERE sector_id = $1
          AND status = ANY($2::public.ticket_status[])
      `,
      [ticket.sector_id, ACTIVE_STATUSES]
    ),
    client.query(
      "SELECT sector_id, business_date, last_number FROM public.ticket_counters WHERE sector_id = $1",
      [ticket.sector_id]
    )
  ]);
  return publicTicketDto(ticket, sector, rowsResult.rows, countersResult.rows, null);
}

async function getLocalPublicTicket(ticketId) {
  const ticketResult = await query(
    "SELECT * FROM public.tickets WHERE id = $1",
    [normalizeRequiredId(ticketId, "ticketId")]
  );
  const ticket = ticketResult.rows[0];
  if (!ticket) return null;

  const [sectorResult, rowsResult, countersResult, businessDateResult] = await Promise.all([
    query(
      `
        SELECT id, name, prefix, counter_label, service_label,
               current_number, queue_size, average_service_seconds, capacity,
               status, updated_at
        FROM public.sectors
        WHERE id = $1
      `,
      [ticket.sector_id]
    ),
    query(
      `
        SELECT *
        FROM public.tickets
        WHERE sector_id = $1
          AND status = ANY($2::public.ticket_status[])
      `,
      [ticket.sector_id, ACTIVE_STATUSES]
    ),
    query(
      "SELECT sector_id, business_date, last_number FROM public.ticket_counters WHERE sector_id = $1",
      [ticket.sector_id]
    ),
    query("SELECT (now() AT TIME ZONE $1)::date AS business_date", [BUSINESS_TIME_ZONE])
  ]);

  return publicTicketDto(
    ticket,
    sectorResult.rows[0],
    rowsResult.rows,
    countersResult.rows,
    businessDateResult.rows[0].business_date
  );
}

async function getLocalTrackedTickets(trackingToken) {
  const token = String(trackingToken || "").trim();
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return { status: "not_found", tickets: [] };

  const ticketResult = await query(
    "SELECT * FROM public.tickets WHERE tracking_token = $1 LIMIT 1",
    [token]
  );
  const ticket = ticketResult.rows[0];
  if (!ticket) return { status: "not_found", tickets: [] };

  const createdAt = new Date(ticket.created_at).getTime();
  if (!Number.isFinite(createdAt) || Date.now() - createdAt > 24 * 60 * 60 * 1000) {
    return { status: "expired", tickets: [] };
  }

  const jobsResult = await query(
    "SELECT payload FROM public.print_jobs WHERE ticket_id = $1 ORDER BY created_at DESC LIMIT 1",
    [ticket.id]
  );
  const payload = parseLocalPayload(jobsResult.rows[0]?.payload);
  const ticketIds = Array.isArray(payload.ticketIds) && payload.ticketIds.length
    ? payload.ticketIds.filter((ticketId) => /^[A-Za-z0-9_-]{8,120}$/.test(String(ticketId)))
    : [ticket.id];
  const uniqueTicketIds = [...new Set(ticketIds)];
  const ticketDtos = (await Promise.all(uniqueTicketIds.map((ticketId) => getLocalPublicTicket(ticketId))))
    .filter(Boolean)
    .map(publicTrackingTicketView);

  return {
    status: "ok",
    tickets: ticketDtos.length ? ticketDtos : [publicTrackingTicketView(await getLocalPublicTicket(ticket.id))]
  };
}

async function insertTicketInTransaction(client, input = {}) {
  const customerId = normalizeRequiredId(input.customerId, "customerId");
  const sectorId = normalizeRequiredId(input.sectorId, "sectorId");
  const deviceId = normalizeOptionalId(input.deviceId);
  const priority = normalizePriority(input);

  const profileResult = await client.query(
    `
      SELECT id, name, status
      FROM public.profiles
      WHERE id = $1
      FOR SHARE
    `,
    [customerId]
  );
  const profile = profileResult.rows[0];
  if (!profile) throw new Error("Cliente não encontrado.");
  if (profile.status !== "active") throw new Error("Cliente inativo.");

  if (deviceId) {
    const deviceResult = await client.query(
      `
        SELECT id
        FROM public.devices
        WHERE id = $1 AND customer_id = $2
        FOR SHARE
      `,
      [deviceId, customerId]
    );
    if (!deviceResult.rowCount) throw new Error("Dispositivo não pertence ao cliente.");
  }

  const sectorResult = await client.query(
    `
      SELECT id, name, prefix, base_number, status
      FROM public.sectors
      WHERE id = $1
      FOR UPDATE
    `,
    [sectorId]
  );
  const sector = sectorResult.rows[0];
  if (!sector) throw new Error("Setor não encontrado.");
  if (sector.status !== "open") throw new Error("Setor fechado para novas senhas.");

  const existingResult = await client.query(
    `
      SELECT *
      FROM public.tickets
      WHERE customer_id = $1
        AND sector_id = $2
        AND status = ANY($3::public.ticket_status[])
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE
    `,
    [customerId, sectorId, ACTIVE_STATUSES]
  );
  if (existingResult.rowCount) {
    return { ticket: existingResult.rows[0], alreadyExists: true };
  }

  const activeCountResult = await client.query(
    `
      SELECT count(*)::int AS total
      FROM public.tickets
      WHERE customer_id = $1
        AND status = ANY($2::public.ticket_status[])
    `,
    [customerId, ACTIVE_STATUSES]
  );
  if (Number(activeCountResult.rows[0].total) >= MAX_ACTIVE_TICKETS_PER_CUSTOMER) {
    throw new Error(`Limite de ${MAX_ACTIVE_TICKETS_PER_CUSTOMER} senhas ativas por cliente atingido.`);
  }

  const businessDateResult = await client.query(
    "SELECT (now() AT TIME ZONE $1)::date AS business_date",
    [BUSINESS_TIME_ZONE]
  );
  const businessDate = businessDateResult.rows[0].business_date;

  const counterResult = await client.query(
    `
      SELECT business_date, last_number
      FROM public.ticket_counters
      WHERE sector_id = $1
      FOR UPDATE
    `,
    [sectorId]
  );
  const counter = counterResult.rows[0];
  const lastNumber = counter && String(counter.business_date) === String(businessDate)
    ? Number(counter.last_number)
    : Number(sector.base_number || 0) - 1;
  const nextNumber = lastNumber >= 999 ? Number(sector.base_number || 0) : lastNumber + 1;

  await client.query(
    `
      INSERT INTO public.ticket_counters (sector_id, business_date, last_number, updated_at)
      VALUES ($1, $2, $3, now())
      ON CONFLICT (sector_id) DO UPDATE SET
        business_date = EXCLUDED.business_date,
        last_number = EXCLUDED.last_number,
        updated_at = now()
    `,
    [sectorId, businessDate, nextNumber]
  );

  const queueOrderResult = await client.query(
    `
      SELECT COALESCE(max(queue_order), 0)::int + 1 AS next_order
      FROM public.tickets
      WHERE sector_id = $1
        AND status = ANY($2::public.ticket_status[])
    `,
    [sectorId, WAITING_STATUSES]
  );
  const queueOrder = Number(queueOrderResult.rows[0].next_order);
  const customerName = normalizeCustomerName(input.customerName || profile.name);
  const code = `${sector.prefix}${String(nextNumber).padStart(3, "0")}`;
  const ticketId = crypto.randomUUID();

  const ticketResult = await client.query(
    `
      INSERT INTO public.tickets (
        id,
        customer_id,
        device_id,
        sector_id,
        customer_name,
        number,
        code,
        status,
        queue_order,
        eligible_at,
        priority,
        priority_reason,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        'aguardando'::public.ticket_status,
        $8,
        now() + make_interval(secs => $9),
        $10,
        $11,
        now(),
        now()
      )
      RETURNING *
    `,
    [
      ticketId,
      customerId,
      deviceId,
      sectorId,
      customerName,
      nextNumber,
      code,
      queueOrder,
      AUTO_CALL_DELAY_SECONDS,
      priority.enabled,
      priority.reason
    ]
  );

  await client.query(
    `
      UPDATE public.sectors
      SET current_number = $2, updated_at = now()
      WHERE id = $1
    `,
    [sectorId, nextNumber]
  );

  await client.query(
    `
      INSERT INTO public.events (
        type, entity_type, entity_id, customer_id, sector_id, payload
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [
      "senha_emitida",
      "ticket",
      ticketId,
      customerId,
      sectorId,
      JSON.stringify({ code, priority })
    ]
  );

  return { ticket: ticketResult.rows[0], alreadyExists: false };
}

function normalizeRequiredId(value, field) {
  const normalized = normalizeOptionalId(value);
  if (!normalized) throw new Error(`${field} é obrigatório.`);
  return normalized;
}

function normalizeOptionalId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function canAccessLocalSector(user, sectorId) {
  if (!user) return false;
  if (["manager", "admin"].includes(user.role)) return true;
  if (user.role === "tv") return sectorId === "acougue";
  return user.role === "attendant" && (user.sectorIds || []).includes(sectorId);
}

function canOperateLocalTicket(user, ticket) {
  if (!user || !ticket) return false;
  if (["manager", "admin"].includes(user.role)) return true;
  if (user.role === "customer") return ticket.customer_id === user.customerId;
  return canAccessLocalSector(user, ticket.sector_id);
}

function normalizeCustomerName(value) {
  return String(value || "Cliente").replace(/\s+/g, " ").trim().slice(0, 120) || "Cliente";
}

function groupRowsBySector(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const current = grouped.get(row.sector_id) || [];
    current.push(row);
    grouped.set(row.sector_id, current);
  }
  return grouped;
}

function publicSectorDto(sector, counters, businessDate, activeRows) {
  const active = activeRows.find((row) => row.sector_id === sector.id && CALL_BLOCKING_STATUSES.includes(row.status));
  const counter = counters.find((row) => row.sector_id === sector.id);
  return {
    id: sector.id,
    name: sector.name,
    prefix: sector.prefix,
    counterLabel: sector.counter_label,
    serviceLabel: sector.service_label,
    queueSize: Number(sector.queue_size || 0),
    averageServiceSeconds: Number(sector.average_service_seconds || 60),
    averageServiceSamples: 0,
    estimateBasedOnRecentServices: false,
    capacity: Number(sector.capacity || 1),
    status: sector.status,
    current: active?.code || formatTicket(sector.prefix, counter?.business_date === businessDate ? Number(counter.last_number) : 0)
  };
}

function publicTicketDto(ticket, sector, sectorRows, counters, businessDate) {
  if (!ticket || !sector) return null;

  const currentTicket = sectorRows.find((row) => CALL_BLOCKING_STATUSES.includes(row.status));
  const waiting = CALL_ELIGIBLE_STATUSES.includes(ticket.status);
  const ahead = waiting
    ? sectorRows.filter((row) => CALL_ELIGIBLE_STATUSES.includes(row.status) && (
      Number(row.priority || 0) > Number(ticket.priority || 0)
      || (Number(row.priority || 0) === Number(ticket.priority || 0) && Number(row.queue_order) < Number(ticket.queue_order))
    )).length
    : 0;
  const position = waiting ? ahead + 1 : 1;
  const averageSeconds = Number(sector.average_service_seconds || 60);
  const activeDelay = currentTicket ? activeServiceDelaySeconds(currentTicket, averageSeconds) : 0;
  const eligibleDelay = waiting ? secondsUntil(ticket.eligible_at || ticket.created_at) : 0;
  const secondsToCall = waiting ? Math.max(eligibleDelay, activeDelay + ahead * averageSeconds) : 0;
  const estimatedCallAt = waiting ? new Date(Date.now() + secondsToCall * 1000).toISOString() : null;
  const counter = counters.find((row) => row.sector_id === sector.id);
  const current = currentTicket?.code || formatTicket(sector.prefix, counter?.business_date === businessDate ? Number(counter.last_number) : 0);

  return {
    id: ticket.id,
    customerId: ticket.customer_id,
    customerName: normalizeCustomerName(ticket.customer_name),
    ticketNumber: ticket.number,
    deviceId: ticket.device_id,
    sectorId: ticket.sector_id,
    sector: sector.name,
    ticket: ticket.code,
    current,
    currentCustomerName: currentTicket ? normalizeCustomerName(currentTicket.customer_name) : "",
    counterLabel: sector.counter_label,
    serviceLabel: sector.service_label,
    status: ticket.status,
    source: ticket.source || "digital",
    kioskId: ticket.kiosk_id || null,
    priority: Boolean(ticket.priority),
    priorityReason: ticket.priority_reason,
    position,
    ahead,
    secondsToCall,
    averageServiceSeconds: averageSeconds,
    averageServiceSamples: 0,
    estimateBasedOnRecentServices: false,
    countdownTotalSeconds: waiting ? Math.max(secondsToCall, secondsBetween(ticket.created_at, estimatedCallAt)) : 0,
    estimatedCallAt,
    progress: progressFor(ticket.status, position),
    smartWaitReason: ticket.smart_wait_reason,
    locationVerified: Boolean(ticket.location_verified),
    qrVerified: Boolean(ticket.qr_verified),
    locationDistanceMeters: ticket.location_distance_meters,
    absenceCount: Number(ticket.absence_count || 0),
    calledAt: ticket.called_at,
    eligibleAt: ticket.eligible_at,
    standbyStartedAt: ticket.standby_started_at,
    standbyExpiresAt: ticket.standby_expires_at,
    standbySecondsRemaining: ticket.standby_expires_at ? secondsUntil(ticket.standby_expires_at) : 0,
    serviceStartedAt: ticket.service_started_at,
    finishedAt: ticket.finished_at,
    createdAt: ticket.created_at
  };
}

function activeServiceDelaySeconds(active, averageSeconds) {
  const startedAt = active.service_started_at || active.called_at || active.updated_at;
  const elapsed = secondsBetween(startedAt, new Date().toISOString());
  const limit = active.status === "chamado" ? 10 * 60 : averageSeconds;
  return Math.max(0, limit - elapsed);
}

function secondsBetween(start, end) {
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return 0;
  return Math.max(0, Math.round((endTime - startTime) / 1000));
}

function secondsUntil(value) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, Math.ceil((time - Date.now()) / 1000));
}

function progressFor(status, position) {
  if (status === "em_atendimento") return 100;
  if (status === "chamado") return 95;
  if (status === "espera_inteligente") return 92;
  if (status === "standby") return 48;
  if (status === "proximo") return 82;
  return Math.max(14, Math.min(76, 80 - position * 7));
}

function formatTicket(prefix, number) {
  return `${prefix}${String(number).padStart(3, "0")}`;
}

function publicCartItemDto(item) {
  return {
    id: item.id,
    customerId: item.customer_id,
    productId: item.product_id,
    productName: item.product_name,
    sectorName: item.sector_name,
    price: item.price,
    quantity: Number(item.quantity || 1),
    createdAt: item.created_at,
    updatedAt: item.updated_at
  };
}

function normalizePriority(input) {
  const requested = input.priority === true || input.preferential === true || input.isPriority === true;
  const reason = normalizeOptionalId(input.priorityReason || input.preferentialReason || input.priorityCategory);
  if (!requested && !reason) return { enabled: false, reason: null };
  if (!reason || !PRIORITY_REASONS.has(reason)) {
    throw new Error("Motivo de prioridade inválido.");
  }
  return { enabled: true, reason };
}

function parseLocalPayload(payload) {
  if (!payload) return {};
  if (typeof payload === "object") return payload;
  try {
    return JSON.parse(payload);
  } catch {
    return {};
  }
}

function publicTrackingTicketView(ticket) {
  if (!ticket) return null;
  return {
    ticketNumber: ticket.ticketNumber,
    ticket: ticket.ticket,
    current: ticket.current,
    currentCustomerName: ticket.currentCustomerName,
    sector: ticket.sector,
    counterLabel: ticket.counterLabel,
    serviceLabel: ticket.serviceLabel,
    status: ticket.status,
    priority: ticket.priority,
    position: ticket.position,
    ahead: ticket.ahead,
    secondsToCall: ticket.secondsToCall,
    estimatedCallAt: ticket.estimatedCallAt,
    progress: ticket.progress
  };
}

module.exports = {
  cancelTicket,
  createTicket,
  addLocalCartItem,
  callNextLocalTicket,
  confirmLocalTicket,
  finishLocalTicket,
  getCustomerState,
  getLocalStaffState,
  getLocalCart,
  getLocalPublicTicket,
  getLocalTrackedTickets,
  getQueueSnapshot,
  insertTicketInTransaction,
  listOpenSectors,
  listWaitingTickets,
  skipLocalTicket,
  recordLocalShoppingSignal,
  runLocalMaintenance,
  upsertLocalDevice,
  publicCartItemDto,
  publicTicketDto
};
