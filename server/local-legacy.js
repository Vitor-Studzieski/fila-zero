const { query, withTransaction } = require("./local-postgres");
const { publicCartItemDto, publicTicketDto } = require("./local-repository");

const ACTIVE_STATUSES = [
  "aguardando",
  "proximo",
  "chamado",
  "em_atendimento",
  "espera_inteligente",
  "standby"
];

const USER_ROLES = new Set(["customer", "attendant", "manager", "admin"]);
const SECTOR_STATUSES = new Set(["open", "paused", "closed"]);

async function getLocalCustomerHistory(customerId) {
  const ticketResult = await query(
    `
      SELECT *
      FROM public.tickets
      WHERE customer_id = $1
        AND status <> ALL($2::public.ticket_status[])
      ORDER BY updated_at DESC
      LIMIT 30
    `,
    [customerId, ACTIVE_STATUSES]
  );
  const ratingsResult = await query(
    `
      SELECT id, customer_id, ticket_id, score, comment, created_at
      FROM public.ratings
      WHERE customer_id = $1
      ORDER BY created_at DESC
      LIMIT 30
    `,
    [customerId]
  );

  const sectorIds = [...new Set(ticketResult.rows.map((row) => row.sector_id))];
  if (!sectorIds.length) return { tickets: [], ratings: ratingsResult.rows };

  const [sectorsResult, countersResult] = await Promise.all([
    query(
      `
        SELECT id, name, prefix, counter_label, service_label,
               current_number, queue_size, average_service_seconds, capacity,
               status, updated_at
        FROM public.sectors
        WHERE id = ANY($1::text[])
      `,
      [sectorIds]
    ),
    query("SELECT sector_id, business_date, last_number FROM public.ticket_counters WHERE sector_id = ANY($1::text[])", [sectorIds])
  ]);
  const sectors = new Map(sectorsResult.rows.map((row) => [row.id, row]));
  const counters = countersResult.rows;
  const ticketsBySector = new Map();
  for (const row of ticketResult.rows) {
    const list = ticketsBySector.get(row.sector_id) || [];
    list.push(row);
    ticketsBySector.set(row.sector_id, list);
  }

  return {
    tickets: ticketResult.rows
      .map((ticket) => publicTicketDto(ticket, sectors.get(ticket.sector_id), ticketsBySector.get(ticket.sector_id) || [], counters, null))
      .filter(Boolean),
    ratings: ratingsResult.rows
  };
}

async function getLocalMetrics(metricsDate = null) {
  const date = normalizeMetricsDate(metricsDate);
  const start = new Date(`${date}T00:00:00-03:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const [sectorsResult, ticketResult, ratingResult] = await Promise.all([
    query(
      `
        SELECT id, name
        FROM public.sectors
        ORDER BY id
      `
    ),
    query(
      `
        SELECT sector_id,
               COUNT(*)::integer AS issued,
               COUNT(*) FILTER (WHERE status = 'atendido'::public.ticket_status)::integer AS finished,
               COUNT(*) FILTER (WHERE status = 'expirado'::public.ticket_status)::integer AS expired,
               COUNT(*) FILTER (WHERE status = 'cancelado'::public.ticket_status)::integer AS canceled,
               COALESCE(AVG(EXTRACT(EPOCH FROM (finished_at - service_started_at))
                 ) FILTER (WHERE service_started_at IS NOT NULL AND finished_at IS NOT NULL), 0)::integer AS avg_service_seconds,
               COALESCE(AVG(EXTRACT(EPOCH FROM (called_at - smart_wait_since))
                 ) FILTER (WHERE smart_wait_since IS NOT NULL AND called_at IS NOT NULL), 0)::integer AS avg_smart_wait_seconds
        FROM public.tickets
        WHERE created_at >= $1 AND created_at < $2
        GROUP BY sector_id
      `,
      [start.toISOString(), end.toISOString()]
    ),
    query(
      `
        SELECT score
        FROM public.ratings
        WHERE created_at >= $1 AND created_at < $2
      `,
      [start.toISOString(), end.toISOString()]
    )
  ]);
  const bySector = new Map(ticketResult.rows.map((row) => [row.sector_id, row]));
  const sectors = sectorsResult.rows.map((sector) => {
    const row = bySector.get(sector.id) || {};
    return {
      id: sector.id,
      name: sector.name,
      issued: Number(row.issued || 0),
      finished: Number(row.finished || 0),
      abandoned: Number(row.expired || 0) + Number(row.canceled || 0),
      avgServiceSeconds: Number(row.avg_service_seconds || 0),
      avgSmartWaitSeconds: Number(row.avg_smart_wait_seconds || 0)
    };
  });
  const scores = ratingResult.rows
    .map((row) => scoreNumber(row.score))
    .filter((score) => score !== null);
  return {
    date,
    sectors,
    satisfaction: {
      count: scores.length,
      average: scores.length ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) / 10 : 0
    },
    generatedAt: new Date().toISOString()
  };
}

async function getLocalOfferInsights(days = 30) {
  const periodDays = Math.max(1, Math.min(90, Number(days) || 30));
  const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();
  const result = await query(
    `
      SELECT customer_id, product_id, product_name, sector_name, quantity, created_at
      FROM public.cart_items
      WHERE created_at >= $1
      ORDER BY created_at DESC
      LIMIT 1000
    `,
    [since]
  );
  const rows = result.rows;
  const productGroups = groupBy(rows, (row) => row.product_id);
  const sectorGroups = groupBy(rows, (row) => row.sector_name || "Não informado");
  const productRanking = [...productGroups.values()]
    .map((group) => ({
      productId: group[0].product_id,
      productName: group[0].product_name,
      sectorName: group[0].sector_name,
      quantity: group.reduce((sum, row) => sum + Number(row.quantity || 1), 0),
      customers: new Set(group.map((row) => row.customer_id)).size
    }))
    .sort((left, right) => right.quantity - left.quantity)
    .slice(0, 8);
  const sectorPatterns = [...sectorGroups.values()]
    .map((group) => ({
      sectorName: group[0].sector_name || "Não informado",
      quantity: group.reduce((sum, row) => sum + Number(row.quantity || 1), 0),
      customers: new Set(group.map((row) => row.customer_id)).size
    }))
    .sort((left, right) => right.quantity - left.quantity)
    .slice(0, 6);
  const timeGroups = groupBy(rows, (row) => hourBucket(row.created_at));
  const timePatterns = [...timeGroups.entries()]
    .map(([label, group]) => ({
      label,
      quantity: group.reduce((sum, row) => sum + Number(row.quantity || 1), 0),
      topProducts: productRanking.filter((product) => group.some((row) => row.product_id === product.productId)).slice(0, 3)
    }))
    .sort((left, right) => right.quantity - left.quantity)
    .slice(0, 8);
  const clusters = sectorPatterns.slice(0, 4).map((sector) => ({
    name: `Seleções de ${sector.sectorName}`,
    dominantSector: sector.sectorName,
    dominantTime: timePatterns[0]?.label || "horário variado",
    quantity: sector.quantity,
    customers: sector.customers,
    topProducts: productRanking.filter((product) => product.sectorName === sector.sectorName).slice(0, 4),
    confidence: confidenceFor(sector.quantity),
    recommendation: `Avaliar ofertas complementares para clientes que selecionam itens de ${sector.sectorName}.`
  }));
  const suggestions = productRanking.slice(0, 3).map((product) => `Avaliar uma oferta complementar para ${product.productName}.`);
  return {
    periodDays,
    totalSelections: rows.reduce((sum, row) => sum + Number(row.quantity || 1), 0),
    totalCustomers: new Set(rows.map((row) => row.customer_id)).size,
    generatedAt: new Date().toISOString(),
    productRanking,
    sectorPatterns,
    timePatterns,
    clusters,
    suggestions,
    confidence: confidenceFor(rows.length)
  };
}

async function createLocalRating(customerId, body = {}) {
  const ticketId = String(body.ticketId || "").trim();
  if (!ticketId) return { error: "Avalie uma senha atendida." };
  const ticketResult = await query(
    `
      SELECT id, status, finished_at
      FROM public.tickets
      WHERE id = $1 AND customer_id = $2
      LIMIT 1
    `,
    [ticketId, customerId]
  );
  const ticket = ticketResult.rows[0];
  if (!ticket || (!ticket.finished_at && ticket.status !== "atendido")) return { error: "A senha ainda não pode ser avaliada." };
  const score = String(body.score || "sem_nota").slice(0, 30);
  if (!["Ruim", "Regular", "Ótima", "sem_nota"].includes(score)) return { error: "Nota de avaliação inválida." };

  try {
    const result = await query(
      `
        INSERT INTO public.ratings (id, customer_id, ticket_id, score, comment)
        SELECT gen_random_uuid(), $1, $2, $3, $4
        WHERE NOT EXISTS (
          SELECT 1 FROM public.ratings WHERE customer_id = $1 AND ticket_id = $2
        )
        RETURNING id, created_at
      `,
      [customerId, ticketId, score, String(body.comment || "").slice(0, 500)]
    );
    if (!result.rowCount) return { error: "Esta senha já foi avaliada." };
    return { id: result.rows[0].id, createdAt: result.rows[0].created_at };
  } catch (error) {
    if (error?.code === "23505") return { error: "Esta senha já foi avaliada." };
    throw error;
  }
}

async function updateLocalCartItemQuantity(itemId, customerId, body = {}) {
  const quantity = Math.max(1, Math.min(99, Number.parseInt(body.quantity, 10) || 1));
  const result = await query(
    `
      UPDATE public.cart_items
      SET quantity = $1, updated_at = now()
      WHERE id = $2 AND customer_id = $3
      RETURNING id, customer_id, product_id, product_name, sector_name, price, quantity, created_at, updated_at
    `,
    [quantity, itemId, customerId]
  );
  if (!result.rowCount) return { error: "Item não encontrado." };
  return { item: publicCartItemDto(result.rows[0]) };
}

async function removeLocalCartItem(itemId, customerId) {
  const result = await query(
    "DELETE FROM public.cart_items WHERE id = $1 AND customer_id = $2 RETURNING id",
    [itemId, customerId]
  );
  return result.rowCount ? { ok: true } : { error: "Item não encontrado." };
}

async function updateLocalSector(sectorId, body = {}) {
  const currentResult = await query("SELECT * FROM public.sectors WHERE id = $1", [sectorId]);
  const current = currentResult.rows[0];
  if (!current) return { error: "Setor não encontrado." };
  const status = SECTOR_STATUSES.has(body.status) ? body.status : current.status;
  const queueSize = positiveInt(body.queueSize, current.queue_size);
  const averageServiceSeconds = positiveInt(body.averageServiceSeconds, current.average_service_seconds);
  const capacity = positiveInt(body.capacity, current.capacity);
  const result = await query(
    `
      UPDATE public.sectors
      SET name = $1,
          counter_label = $2,
          service_label = $3,
          queue_size = $4,
          average_service_seconds = $5,
          capacity = $6,
          status = $7::public.sector_status,
          updated_at = now()
      WHERE id = $8
      RETURNING id, name, prefix, counter_label, service_label, queue_size,
                average_service_seconds, capacity, status, updated_at
    `,
    [
      cleanText(body.name, current.name, 120),
      cleanText(body.counterLabel, current.counter_label, 120),
      cleanText(body.serviceLabel, current.service_label, 120),
      queueSize,
      averageServiceSeconds,
      capacity,
      status,
      sectorId
    ]
  );
  return { sector: sectorDto(result.rows[0]) };
}

async function listLocalUsers() {
  const result = await query(
    `
      SELECT p.id, p.name, p.email, p.role::text AS role, p.status::text AS status, p.created_at,
             COALESCE(array_agg(psp.sector_id ORDER BY psp.sector_id) FILTER (WHERE psp.sector_id IS NOT NULL), '{}') AS sector_ids
      FROM public.profiles p
      LEFT JOIN public.profile_sector_permissions psp ON psp.profile_id = p.id
      WHERE p.status = 'active'::public.user_status
      GROUP BY p.id
      ORDER BY p.created_at ASC
    `
  );
  return result.rows.map((row) => userDto(row));
}

async function createLocalManagedUser(body = {}) {
  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.name || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const password = String(body.password || "");
  const role = USER_ROLES.has(body.role) ? body.role : "attendant";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name || !isStrongPassword(password)) {
    return { error: "Informe nome, e-mail e senha com ao menos 12 caracteres, letras maiúsculas, minúsculas e números." };
  }
  const sectorIds = Array.isArray(body.sectorIds) ? [...new Set(body.sectorIds.map((value) => String(value).trim()).filter(Boolean))] : [];
  try {
    return await withTransaction(async (client) => {
      const existing = await client.query("SELECT 1 FROM auth.users WHERE lower(email) = lower($1) LIMIT 1", [email]);
      if (existing.rowCount) return { error: "Já existe um usuário com este e-mail." };
      const userResult = await client.query(
        `
          INSERT INTO auth.users (id, email, encrypted_password, raw_user_meta_data, raw_app_meta_data, email_confirmed_at)
          VALUES (gen_random_uuid(), $1, crypt($2, gen_salt('bf')), jsonb_build_object('name', $3::text, 'role', $4::text), '{}'::jsonb, now())
          RETURNING id, email, created_at
        `,
        [email, password, name, role]
      );
      const user = userResult.rows[0];
      const profileResult = await client.query(
        `
          INSERT INTO public.profiles (id, name, email, role, status)
          VALUES ($1, $2, $3, $4::public.user_role, 'active'::public.user_status)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            email = EXCLUDED.email,
            role = EXCLUDED.role,
            status = EXCLUDED.status,
            updated_at = now()
          RETURNING id, name, email, role::text AS role, status::text AS status, created_at
        `,
        [user.id, name, email, role]
      );
      for (const sectorId of sectorIds) {
        await client.query(
          `
            INSERT INTO public.profile_sector_permissions (profile_id, sector_id)
            SELECT $1, id FROM public.sectors WHERE id = $2
            ON CONFLICT DO NOTHING
          `,
          [user.id, sectorId]
        );
      }
      return { user: userDto({ ...profileResult.rows[0], sector_ids: sectorIds }) };
    });
  } catch (error) {
    const uniquenessMessage = `${error?.constraint || ""} ${error?.detail || ""}`;
    if (error?.code === "23505" && /email/i.test(uniquenessMessage)) return { error: "Já existe um usuário com este e-mail." };
    throw error;
  }
}

function sectorDto(row) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    counterLabel: row.counter_label,
    serviceLabel: row.service_label,
    queueSize: Number(row.queue_size || 0),
    averageServiceSeconds: Number(row.average_service_seconds || 60),
    capacity: Number(row.capacity || 1),
    status: row.status,
    updatedAt: row.updated_at
  };
}

function userDto(row) {
  return {
    id: row.id,
    customerId: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
    sectorIds: Array.isArray(row.sector_ids) ? row.sector_ids.filter(Boolean) : [],
    createdAt: row.created_at
  };
}

function normalizeMetricsDate(value) {
  const candidate = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return candidate;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function scoreNumber(value) {
  return { Ruim: 1, Regular: 3, "Ótima": 5 }[value] || null;
}

function groupBy(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }
  return groups;
}

function hourBucket(value) {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    hour12: false
  }).format(new Date(value));
  return `${hour}:00`;
}

function confidenceFor(quantity) {
  if (Number(quantity) >= 50) return "alta";
  if (Number(quantity) >= 10) return "media";
  return "baixa";
}

function positiveInt(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number > 0 ? Math.min(number, 100000) : Number(fallback || 1);
}

function cleanText(value, fallback, limit) {
  const text = String(value ?? fallback ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
  return text || String(fallback || "").slice(0, limit);
}

function isStrongPassword(value) {
  return value.length >= 12 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value);
}

module.exports = {
  createLocalManagedUser,
  createLocalRating,
  getLocalCustomerHistory,
  getLocalMetrics,
  getLocalOfferInsights,
  listLocalUsers,
  removeLocalCartItem,
  updateLocalCartItemQuantity,
  updateLocalSector
};
