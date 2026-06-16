const crypto = require("node:crypto");

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_ANON_KEY = String(process.env.SUPABASE_ANON_KEY || "");
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
const AUTH_SECRET = authSecret();
const AUTO_CONFIRM_PUBLIC_CUSTOMERS = process.env.SUPABASE_AUTO_CONFIRM_CUSTOMERS === "1";

const BUSINESS_TIME_ZONE = "America/Sao_Paulo";
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const MAX_ACTIVE_TICKETS_PER_CUSTOMER = 3;
const AUTO_CALL_DELAY_SECONDS = 30;
const CALL_ABSENCE_SECONDS = 10 * 60;
const STANDBY_SECONDS = 10 * 60;
const TICKET_MIN_NUMBER = 0;
const TICKET_MAX_NUMBER = 999;
const ACTIVE_STATUSES = ["aguardando", "proximo", "chamado", "em_atendimento", "espera_inteligente", "standby"];
const CALL_ELIGIBLE_STATUSES = ["aguardando", "proximo", "standby"];
const CALL_BLOCKING_STATUSES = ["chamado", "em_atendimento"];
const CUSTOMER_CANCELABLE_STATUSES = ["aguardando", "proximo", "chamado", "espera_inteligente", "standby"];
const STAFF_SKIPPABLE_STATUSES = ["aguardando", "proximo", "chamado", "standby", "espera_inteligente"];
const CUSTOMER_ROLES = ["customer", "manager", "admin"];
const STAFF_ROLES = ["attendant", "manager", "admin"];
const ADMIN_ROLES = ["manager", "admin"];
const SKIP_REASONS = new Set(["cliente_ausente", "cancelamento", "erro_operacional"]);
const PRIORITY_CATEGORIES = new Set([
  "deficiencia_ou_mobilidade_reduzida",
  "tea",
  "idoso_60_mais",
  "gestante_ou_lactante",
  "crianca_de_colo",
  "obesidade"
]);
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;

async function handleRequest(request) {
  const url = new URL(request.url);
  try {
    if (!isSupabaseReady()) {
      return json({ error: "Supabase nao configurado." }, 500);
    }
    await runScheduledJobs();

    if (request.method === "POST" && url.pathname === "/api/auth/login") return login(request);
    if (request.method === "POST" && url.pathname === "/api/auth/change-password") return changePassword(request);
    if (request.method === "POST" && url.pathname === "/api/auth/register") return registerCustomer(request);
    if (request.method === "POST" && url.pathname === "/api/auth/logout") return logout(request);
    if (request.method === "GET" && url.pathname === "/api/auth/me") return me(request);
    if (request.method === "GET" && url.pathname === "/api/events") return events(request, url);
    if (request.method === "POST" && url.pathname === "/api/sessions") return sessions(request);
    if (request.method === "GET" && url.pathname === "/api/state") return state(request);
    if (request.method === "GET" && url.pathname === "/api/history") return history(request);
    if (request.method === "GET" && url.pathname === "/api/staff/state") return staffState(request);
    if (request.method === "GET" && url.pathname === "/api/metrics") return metrics(request);
    if (request.method === "POST" && url.pathname === "/api/tickets") return createTicketRoute(request);
    if (request.method === "GET" && url.pathname === "/api/cart") return cart(request);
    if (request.method === "POST" && url.pathname === "/api/cart/items") return addCartItemRoute(request);
    if (request.method === "POST" && url.pathname === "/api/ratings") return rating(request);
    if (request.method === "GET" && url.pathname === "/api/users") return users(request);
    if (request.method === "POST" && url.pathname === "/api/users") return createUserRoute(request);

    const confirmMatch = url.pathname.match(/^\/api\/tickets\/([^/]+)\/confirm$/);
    if (request.method === "POST" && confirmMatch) return confirmTicketRoute(request, confirmMatch[1]);

    const finishMatch = url.pathname.match(/^\/api\/tickets\/([^/]+)\/finish$/);
    if (request.method === "POST" && finishMatch) return finishTicketRoute(request, finishMatch[1]);

    const skipMatch = url.pathname.match(/^\/api\/tickets\/([^/]+)\/skip$/);
    if (request.method === "POST" && skipMatch) return skipTicketRoute(request, skipMatch[1]);

    const cancelMatch = url.pathname.match(/^\/api\/tickets\/([^/]+)\/cancel$/);
    if (request.method === "POST" && cancelMatch) return cancelTicketRoute(request, cancelMatch[1]);

    const callNextMatch = url.pathname.match(/^\/api\/sectors\/([^/]+)\/call-next$/);
    if (request.method === "POST" && callNextMatch) return callNextRoute(request, callNextMatch[1]);

    const sectorMatch = url.pathname.match(/^\/api\/sectors\/([^/]+)$/);
    if (request.method === "PUT" && sectorMatch) return updateSectorRoute(request, sectorMatch[1]);

    const cartDeleteMatch = url.pathname.match(/^\/api\/cart\/items\/([^/]+)$/);
    if (request.method === "DELETE" && cartDeleteMatch) return removeCartItemRoute(request, cartDeleteMatch[1]);

    return json({ error: "Rota nao encontrada." }, 404);
  } catch (error) {
    console.error(error);
    return json({ error: "Erro interno do servidor." }, 500);
  }
}

async function login(request) {
  const body = await readJson(request);
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const attemptKey = `${clientIp(request)}:${email || "unknown"}`;
  if (await isLoginLocked(attemptKey)) return json({ error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." }, 401);

  const auth = await supabaseFetch("/auth/v1/token?grant_type=password", {
    method: "POST",
    apiKey: SUPABASE_ANON_KEY,
    bearer: SUPABASE_ANON_KEY,
    body: { email, password }
  });
  if (auth.error || !auth.user?.id) {
    await registerLoginFailure(attemptKey);
    return json({ error: "E-mail ou senha invalidos." }, 401);
  }

  const profile = await getProfile(auth.user.id, auth.user.email);
  if (!profile || profile.status !== "active") {
    await registerLoginFailure(attemptKey);
    return json({ error: "Usuario sem perfil ativo no sistema." }, 401);
  }

  await clearLoginFailures(attemptKey);
  const csrfToken = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  const sessionToken = signSessionToken({ provider: "supabase", email: profile.email, user: profile, csrfToken, expiresAt });
  return json({ user: profile, csrfToken }, 200, authCookies(sessionToken, csrfToken));
}

async function changePassword(request) {
  const body = await readJson(request);
  const email = String(body.email || "").trim().toLowerCase();
  const currentPassword = String(body.currentPassword || "");
  const newPassword = String(body.newPassword || "");
  if (!email || !currentPassword || newPassword.length < 8) {
    return json({ error: "Informe e-mail, senha atual e nova senha com ao menos 8 caracteres." }, 400);
  }

  const attemptKey = `${clientIp(request)}:${email || "unknown"}:change-password`;
  if (await isLoginLocked(attemptKey)) return json({ error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." }, 401);

  const auth = await supabaseFetch("/auth/v1/token?grant_type=password", {
    method: "POST",
    apiKey: SUPABASE_ANON_KEY,
    bearer: SUPABASE_ANON_KEY,
    body: { email, password: currentPassword }
  });
  if (auth.error || !auth.user?.id) {
    await registerLoginFailure(attemptKey);
    return json({ error: "E-mail ou senha atual invalidos." }, 401);
  }

  const updated = await supabaseFetch(`/auth/v1/admin/users/${encodeURIComponent(auth.user.id)}`, {
    method: "PUT",
    body: { password: newPassword }
  });
  if (updated.error) {
    console.error("password_update_failed", updated.error);
    return json({ error: "Nao foi possivel atualizar a senha agora." }, 400);
  }
  await clearLoginFailures(attemptKey);
  return json({ ok: true, message: "Senha alterada com sucesso. Entre usando a nova senha." });
}

async function registerCustomer(request) {
  const body = await readJson(request);
  const data = validateCustomerRegistration(body);
  if (data.error) return json(data, 400);

  const attemptKey = `${clientIp(request)}:${data.email}:register`;
  if (await isLoginLocked(attemptKey)) return json({ error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." }, 401);

  const auth = await supabaseFetch("/auth/v1/admin/users", {
    method: "POST",
    body: {
      email: data.email,
      password: data.password,
      email_confirm: AUTO_CONFIRM_PUBLIC_CUSTOMERS,
      user_metadata: { name: data.name, role: "customer" }
    }
  });
  const userId = auth.id || auth.user?.id;
  if (auth.error || !userId) {
    await registerLoginFailure(attemptKey);
    console.error("customer_register_failed", auth.error || "missing_user_id");
    return json({ error: "Nao foi possivel criar a conta com os dados informados." }, 400);
  }

  const profile = await upsert("profiles", { id: userId, email: data.email, name: data.name, role: "customer", status: "active" }, "id");
  await clearLoginFailures(attemptKey);
  return json({
    user: userDto({ ...profile, sectorIds: [] }),
    message: "Conta de cliente criada com sucesso. Entre usando seu e-mail e senha."
  }, 201);
}

async function logout(request) {
  const user = await requireUser(request, CUSTOMER_ROLES);
  if (user.response) return user.response;
  if (!(await verifyCsrf(request, user))) return json({ error: "Token de seguranca invalido. Recarregue a pagina e tente novamente." }, 403);
  return json({ ok: true }, 200, clearAuthCookies());
}

async function me(request) {
  const user = await getAuthUser(request);
  return json({ user, csrfToken: user?.csrf_token || null });
}

async function events(request, url) {
  const roles = url.searchParams.get("scope") === "staff" ? STAFF_ROLES : CUSTOMER_ROLES;
  const result = await requireUser(request, roles);
  if (result.response) return result.response;
  const data = url.searchParams.get("scope") === "staff"
    ? await getStaffState(result)
    : await getCustomerState(result.customerId);
  return new Response(`event: state\ndata: ${JSON.stringify(data)}\n\n`, {
    status: 200,
    headers: securityHeaders({ "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform" })
  });
}

async function sessions(request) {
  const user = await requireUser(request, CUSTOMER_ROLES);
  if (user.response) return user.response;
  if (!(await verifyCsrf(request, user))) return json({ error: "Token de seguranca invalido. Recarregue a pagina e tente novamente." }, 403);
  const body = await readJson(request);
  const session = await upsertSession({ ...body, customerId: user.customerId }, request.headers.get("user-agent") || "");
  return json(session);
}

async function state(request) {
  const user = await requireUser(request, CUSTOMER_ROLES);
  if (user.response) return user.response;
  return json(await getCustomerState(user.customerId));
}

async function history(request) {
  const user = await requireUser(request, CUSTOMER_ROLES);
  if (user.response) return user.response;
  return json(await getCustomerHistory(user.customerId));
}

async function staffState(request) {
  const user = await requireUser(request, STAFF_ROLES);
  if (user.response) return user.response;
  return json(await getStaffState(user));
}

async function metrics(request) {
  const user = await requireUser(request, ADMIN_ROLES);
  if (user.response) return user.response;
  return json(await getMetrics());
}

async function createTicketRoute(request) {
  const user = await requireUser(request, CUSTOMER_ROLES);
  if (user.response) return user.response;
  if (!(await verifyCsrf(request, user))) return json({ error: "Token de seguranca invalido. Recarregue a pagina e tente novamente." }, 403);
  const result = await createTicket({ ...(await readJson(request)), customerId: user.customerId });
  return json(result, result.error ? 400 : 201);
}

async function confirmTicketRoute(request, ticketId) {
  const user = await requireUser(request, [...CUSTOMER_ROLES, ...STAFF_ROLES]);
  if (user.response) return user.response;
  if (!(await verifyCsrf(request, user))) return json({ error: "Token de seguranca invalido. Recarregue a pagina e tente novamente." }, 403);
  if (!(await canOperateOnTicket(user, ticketId))) return json({ error: "Acesso negado." }, 403);
  const result = await confirmTicket(ticketId);
  return json(result, result.error ? 400 : 200);
}

async function finishTicketRoute(request, ticketId) {
  const user = await requireUser(request, [...CUSTOMER_ROLES, ...STAFF_ROLES]);
  if (user.response) return user.response;
  if (!(await verifyCsrf(request, user))) return json({ error: "Token de seguranca invalido. Recarregue a pagina e tente novamente." }, 403);
  if (!(await canOperateOnTicket(user, ticketId))) return json({ error: "Acesso negado." }, 403);
  const result = await finishTicket(ticketId);
  return json(result, result.error ? 400 : 200);
}

async function skipTicketRoute(request, ticketId) {
  const user = await requireUser(request, STAFF_ROLES);
  if (user.response) return user.response;
  if (!(await verifyCsrf(request, user))) return json({ error: "Token de seguranca invalido. Recarregue a pagina e tente novamente." }, 403);
  const ticket = await getTicket(ticketId);
  if (!ticket) return json({ error: "Senha nao encontrada." }, 404);
  if (!(await canAccessSector(user, ticket.sector_id))) return json({ error: "Usuario sem permissao para este setor." }, 403);
  const result = await skipTicket(ticketId, await readJson(request));
  return json(result, result.error ? 400 : 200);
}

async function cancelTicketRoute(request, ticketId) {
  const user = await requireUser(request, CUSTOMER_ROLES);
  if (user.response) return user.response;
  if (!(await verifyCsrf(request, user))) return json({ error: "Token de seguranca invalido. Recarregue a pagina e tente novamente." }, 403);
  const result = await cancelTicket(ticketId, user.customerId);
  return json(result, result.error ? 400 : 200);
}

async function callNextRoute(request, sectorId) {
  const user = await requireUser(request, STAFF_ROLES);
  if (user.response) return user.response;
  if (!(await verifyCsrf(request, user))) return json({ error: "Token de seguranca invalido. Recarregue a pagina e tente novamente." }, 403);
  if (!(await canAccessSector(user, sectorId))) return json({ error: "Usuario sem permissao para este setor." }, 403);
  const result = await callNextTicket(sectorId);
  return json(result, result.error ? 400 : 200);
}

async function updateSectorRoute(request, sectorId) {
  const user = await requireUser(request, ADMIN_ROLES);
  if (user.response) return user.response;
  if (!(await verifyCsrf(request, user))) return json({ error: "Token de seguranca invalido. Recarregue a pagina e tente novamente." }, 403);
  const result = await updateSector(sectorId, await readJson(request));
  return json(result, result.error ? 400 : 200);
}

async function cart(request) {
  const user = await requireUser(request, CUSTOMER_ROLES);
  if (user.response) return user.response;
  return json(await getCart(user.customerId));
}

async function addCartItemRoute(request) {
  const user = await requireUser(request, CUSTOMER_ROLES);
  if (user.response) return user.response;
  if (!(await verifyCsrf(request, user))) return json({ error: "Token de seguranca invalido. Recarregue a pagina e tente novamente." }, 403);
  const result = await addCartItem({ ...(await readJson(request)), customerId: user.customerId });
  return json(result, result.error ? 400 : 201);
}

async function removeCartItemRoute(request, itemId) {
  const user = await requireUser(request, CUSTOMER_ROLES);
  if (user.response) return user.response;
  if (!(await verifyCsrf(request, user))) return json({ error: "Token de seguranca invalido. Recarregue a pagina e tente novamente." }, 403);
  const result = await removeCartItem(itemId, user.customerId);
  return json(result, result.error ? 400 : 200);
}

async function rating(request) {
  const user = await requireUser(request, CUSTOMER_ROLES);
  if (user.response) return user.response;
  if (!(await verifyCsrf(request, user))) return json({ error: "Token de seguranca invalido. Recarregue a pagina e tente novamente." }, 403);
  const result = await createRating({ ...(await readJson(request)), customerId: user.customerId });
  return json(result, result.error ? 400 : 201);
}

async function users(request) {
  const user = await requireUser(request, ADMIN_ROLES);
  if (user.response) return user.response;
  return json({ users: await listUsers() });
}

async function createUserRoute(request) {
  const user = await requireUser(request, ADMIN_ROLES);
  if (user.response) return user.response;
  if (!(await verifyCsrf(request, user))) return json({ error: "Token de seguranca invalido. Recarregue a pagina e tente novamente." }, 403);
  const result = await createUser(await readJson(request));
  return json(result, result.error ? 400 : 201);
}

async function createTicket(body) {
  await expireStaleActiveTickets();
  const sector = await getSector(body.sectorId);
  if (!sector) return fail("Setor nao encontrado.");
  if (sector.status !== "open") return fail("Setor fechado para novas senhas.");
  const session = await upsertSession(body, "");
  const active = await select("tickets", `customer_id=eq.${encodeURIComponent(session.customerId)}&status=in.(${ACTIVE_STATUSES.join(",")})`);
  if (active.length >= MAX_ACTIVE_TICKETS_PER_CUSTOMER) return fail(`Limite de ${MAX_ACTIVE_TICKETS_PER_CUSTOMER} senhas ativas por cliente atingido.`);
  const existing = active.find((ticket) => ticket.sector_id === sector.id);
  if (existing) return { ticket: await ticketDto(existing), alreadyExists: true };
  const priority = normalizePriority(body);
  const row = await rpc("issue_ticket", {
    p_customer_id: session.customerId,
    p_device_id: session.deviceId,
    p_sector_id: sector.id,
    p_priority: priority.enabled,
    p_priority_reason: priority.reason,
    p_auto_call_delay_seconds: AUTO_CALL_DELAY_SECONDS,
    p_max_active_tickets: MAX_ACTIVE_TICKETS_PER_CUSTOMER
  });
  if (!row || row.error) return fail("Nao foi possivel emitir a senha agora.");
  await registerEvent("senha_emitida", "ticket", row.id, row.customer_id, row.sector_id, { code: row.code, priority });
  return { ticket: await ticketDto(row), alreadyExists: false };
}

async function callNextTicket(sectorId, options = {}) {
  const called = await rpc("call_next_ticket", {
    p_sector_id: sectorId,
    p_require_eligible: Boolean(options.requireEligible),
    p_prefer_standby: Boolean(options.preferStandby)
  });
  if (called.error) return fail("Finalize a senha atual antes de chamar a proxima.");
  if (called?.id) {
    await registerEvent("senha_chamada", "ticket", called.id, called.customer_id, called.sector_id, { code: called.code });
    return { ticket: await ticketDto(called) };
  }
  return { ticket: null, message: "Nenhuma senha elegivel para chamada." };
}

async function confirmTicket(ticketId) {
  const ticket = await getTicket(ticketId);
  if (!ticket) return fail("Senha nao encontrada.");
  if (ticket.status !== "chamado") return fail("A senha precisa estar chamada para iniciar atendimento.");
  const blocking = await select("tickets", `id=neq.${encodeURIComponent(ticket.id)}&customer_id=eq.${encodeURIComponent(ticket.customer_id)}&status=eq.em_atendimento&limit=1`);
  if (blocking.length) return fail("Cliente ja possui outro atendimento em andamento.");
  const now = isoNow();
  const updated = await update("tickets", ticket.id, { status: "em_atendimento", service_started_at: now, updated_at: now });
  await insert("services", { ticket_id: ticket.id, sector_id: ticket.sector_id, customer_id: ticket.customer_id, started_at: now });
  await registerEvent("atendimento_iniciado", "ticket", ticket.id, ticket.customer_id, ticket.sector_id, { code: ticket.code });
  return { ticket: await ticketDto(updated) };
}

async function finishTicket(ticketId) {
  const ticket = await getTicket(ticketId);
  if (!ticket) return fail("Senha nao encontrada.");
  if (ticket.status !== "em_atendimento") return fail("A senha precisa estar em atendimento para finalizar pedido.");
  const now = isoNow();
  await update("tickets", ticket.id, { status: "atendido", finished_at: now, updated_at: now });
  const services = await select("services", `ticket_id=eq.${encodeURIComponent(ticket.id)}&finished_at=is.null&limit=1`);
  if (services[0]) await update("services", services[0].id, { finished_at: now });
  const sector = await getSector(ticket.sector_id);
  await update("sectors", ticket.sector_id, { current_number: Math.max(Number(sector.current_number || 0), Number(ticket.number || 0)), updated_at: now });
  await registerEvent("pedido_finalizado", "ticket", ticket.id, ticket.customer_id, ticket.sector_id, { code: ticket.code });
  const released = await releaseSmartWaitTicket(ticket.customer_id);
  const nextInSector = await callNextTicket(ticket.sector_id, { preferStandby: true });
  return {
    finishedTicket: await ticketDto(await getTicket(ticket.id)),
    releasedTicket: released ? await ticketDto(released) : null,
    nextTicket: nextInSector?.ticket || null
  };
}

async function skipTicket(ticketId, body = {}) {
  const ticket = await getTicket(ticketId);
  if (!ticket) return fail("Senha nao encontrada.");
  if (!STAFF_SKIPPABLE_STATUSES.includes(ticket.status)) return fail("Esta senha nao pode ser pulada neste status.");
  const reason = cleanId(body.reason);
  if (!SKIP_REASONS.has(reason)) return fail("Informe um motivo obrigatorio para pular a senha.");
  const now = isoNow();
  const nextStatus = reason === "cliente_ausente" ? "standby" : "cancelado";
  const absenceCount = reason === "cliente_ausente" ? Number(ticket.absence_count || 0) + 1 : Number(ticket.absence_count || 0);
  const patch = reason === "cliente_ausente"
    ? {
        status: nextStatus,
        absence_count: absenceCount,
        called_at: null,
        smart_wait_reason: null,
        blocked_by_ticket_id: null,
        smart_wait_since: null,
        standby_started_at: now,
        standby_expires_at: new Date(Date.now() + STANDBY_SECONDS * 1000).toISOString(),
        queue_order: Number(ticket.queue_order || 0) + 1000,
        updated_at: now
      }
    : {
        status: nextStatus,
        absence_count: absenceCount,
        canceled_at: now,
        called_at: null,
        smart_wait_reason: null,
        blocked_by_ticket_id: null,
        smart_wait_since: null,
        standby_started_at: null,
        standby_expires_at: null,
        updated_at: now
      };
  const skipped = await update("tickets", ticket.id, patch);
  await insert("calls", { ticket_id: ticket.id, sector_id: ticket.sector_id, action: `senha_pulada:${reason}`, created_at: now });
  await registerEvent("senha_pulada_pelo_atendente", "ticket", ticket.id, ticket.customer_id, ticket.sector_id, { code: ticket.code, previousStatus: ticket.status, reason });
  const nextInSector = CALL_BLOCKING_STATUSES.includes(ticket.status) ? await callNextTicket(ticket.sector_id) : null;
  return { skippedTicket: await ticketDto(skipped), nextTicket: nextInSector?.ticket || null };
}

async function cancelTicket(ticketId, customerId) {
  const ticket = await getTicket(ticketId);
  if (!ticket || ticket.customer_id !== customerId) return fail("Senha nao encontrada.");
  if (!CUSTOMER_CANCELABLE_STATUSES.includes(ticket.status)) return fail("Esta senha nao pode mais ser cancelada pelo cliente.");
  const now = isoNow();
  const canceled = await update("tickets", ticket.id, {
    status: "cancelado",
    canceled_at: now,
    called_at: null,
    smart_wait_reason: null,
    blocked_by_ticket_id: null,
    smart_wait_since: null,
    updated_at: now
  });
  await registerEvent("senha_cancelada_pelo_cliente", "ticket", ticket.id, ticket.customer_id, ticket.sector_id, { code: ticket.code, previousStatus: ticket.status });
  const released = CALL_BLOCKING_STATUSES.includes(ticket.status) ? await releaseSmartWaitTicket(ticket.customer_id) : null;
  return { canceledTicket: await ticketDto(canceled), releasedTicket: released ? await ticketDto(released) : null };
}

async function releaseSmartWaitTicket(customerId) {
  const rows = await select("tickets", `customer_id=eq.${encodeURIComponent(customerId)}&status=eq.espera_inteligente&order=smart_wait_since.asc,created_at.asc&limit=1`);
  const next = rows[0];
  if (!next) return null;
  const now = isoNow();
  const updated = await update("tickets", next.id, {
    status: "chamado",
    called_at: now,
    smart_wait_reason: null,
    blocked_by_ticket_id: null,
    smart_wait_since: null,
    updated_at: now
  });
  await insert("calls", { ticket_id: next.id, sector_id: next.sector_id, action: "senha_chamada", created_at: now });
  await registerEvent("espera_inteligente_liberada", "ticket", next.id, next.customer_id, next.sector_id, { code: next.code });
  await registerEvent("senha_chamada", "ticket", next.id, next.customer_id, next.sector_id, { code: next.code, source: "fim_do_pedido_anterior" });
  return updated;
}

async function updateSector(sectorId, body) {
  const sector = await getSector(sectorId);
  if (!sector) return fail("Setor nao encontrado.");
  const patch = {
    name: String(body.name || sector.name).trim(),
    counter_label: String(body.counterLabel || sector.counter_label).trim(),
    service_label: String(body.serviceLabel || sector.service_label).trim(),
    queue_size: toPositiveInt(body.queueSize, sector.queue_size),
    average_service_seconds: toPositiveInt(body.averageServiceSeconds, sector.average_service_seconds),
    capacity: toPositiveInt(body.capacity, sector.capacity),
    status: ["open", "paused", "closed"].includes(body.status) ? body.status : sector.status,
    updated_at: isoNow()
  };
  await update("sectors", sectorId, patch);
  await registerEvent("setor_atualizado", "sector", sectorId, null, sectorId, patch);
  return { sector: await sectorDto(await getSector(sectorId)) };
}

async function getCustomerState(customerId) {
  await expireStaleActiveTickets();
  const sectors = await Promise.all((await getSectors()).map(sectorDto));
  const tickets = customerId
    ? await select("tickets", `customer_id=eq.${encodeURIComponent(customerId)}&status=in.(${ACTIVE_STATUSES.join(",")})&order=created_at.asc`)
    : [];
  return { serverTime: isoNow(), sectors, tickets: await mapAsync(tickets, ticketDto) };
}

async function getStaffState(user) {
  await expireStaleActiveTickets();
  const sectors = (await getSectors()).filter((sector) => canAccessSectorSync(user, sector.id));
  const data = await mapAsync(sectors, async (sector) => {
    const tickets = await select("tickets", `sector_id=eq.${encodeURIComponent(sector.id)}&status=in.(${ACTIVE_STATUSES.join(",")})&order=priority.desc,queue_order.asc`);
    return { ...(await sectorDto(sector)), tickets: await mapAsync(tickets, ticketDto), recentCalls: await recentSectorCalls(sector.id) };
  });
  return { serverTime: isoNow(), sectors: data };
}

async function getCustomerHistory(customerId) {
  const tickets = await select("tickets", `customer_id=eq.${encodeURIComponent(customerId)}&status=not.in.(${ACTIVE_STATUSES.join(",")})&order=updated_at.desc&limit=30`);
  const ratings = await select("ratings", `customer_id=eq.${encodeURIComponent(customerId)}&order=created_at.desc&limit=30`);
  return { tickets: await mapAsync(tickets, ticketDto), ratings };
}

async function getMetrics() {
  const sectors = await mapAsync(await getSectors(), async (sector) => {
    const finished = await count("tickets", `sector_id=eq.${encodeURIComponent(sector.id)}&status=eq.atendido`);
    const abandoned = await count("tickets", `sector_id=eq.${encodeURIComponent(sector.id)}&status=in.(expirado,cancelado)`);
    const smartWaitRows = await select("tickets", `sector_id=eq.${encodeURIComponent(sector.id)}&smart_wait_since=not.is.null`);
    const serviceRows = await select("tickets", `sector_id=eq.${encodeURIComponent(sector.id)}&service_started_at=not.is.null&finished_at=not.is.null`);
    return {
      id: sector.id,
      name: sector.name,
      finished,
      abandoned,
      avgServiceSeconds: average(serviceRows.map((row) => secondsBetween(row.service_started_at, row.finished_at))),
      avgSmartWaitSeconds: average(smartWaitRows.map((row) => secondsBetween(row.smart_wait_since, row.called_at || isoNow())))
    };
  });
  return { sectors, satisfaction: satisfactionSummary(await select("ratings", "select=score")), generatedAt: isoNow() };
}

async function getCart(customerId) {
  return { items: (await select("cart_items", `customer_id=eq.${encodeURIComponent(customerId)}&order=created_at.asc`)).map(cartItemDto) };
}

async function addCartItem(body) {
  const customerId = cleanId(body.customerId);
  const productId = cleanId(body.productId);
  if (!customerId || !productId) return fail("Cliente e produto sao obrigatorios.");
  const existing = (await select("cart_items", `customer_id=eq.${encodeURIComponent(customerId)}&product_id=eq.${encodeURIComponent(productId)}&limit=1`))[0];
  if (existing) {
    const item = await update("cart_items", existing.id, { quantity: Number(existing.quantity || 0) + 1, updated_at: isoNow() });
    await registerEvent("carrinho_item_incrementado", "cart_item", existing.id, customerId, null, { productId });
    return { item: cartItemDto(item) };
  }
  const item = await insert("cart_items", {
    customer_id: customerId,
    product_id: productId,
    product_name: String(body.productName || "Produto").slice(0, 120),
    sector_name: String(body.sectorName || "Oferta").slice(0, 120),
    price: String(body.price || "").slice(0, 40),
    quantity: 1,
    created_at: isoNow(),
    updated_at: isoNow()
  });
  await registerEvent("carrinho_item_adicionado", "cart_item", item.id, customerId, null, { productId });
  return { item: cartItemDto(item) };
}

async function removeCartItem(itemId, customerId) {
  const item = (await select("cart_items", `id=eq.${encodeURIComponent(itemId)}&customer_id=eq.${encodeURIComponent(customerId)}&limit=1`))[0];
  if (!item) return fail("Item nao encontrado.");
  await remove("cart_items", itemId);
  await registerEvent("carrinho_item_removido", "cart_item", itemId, customerId, null, { productId: item.product_id });
  return { ok: true };
}

async function createRating(body) {
  const rating = await insert("ratings", {
    customer_id: cleanId(body.customerId),
    ticket_id: cleanId(body.ticketId),
    score: String(body.score || "sem_nota").slice(0, 30),
    comment: String(body.comment || "").slice(0, 500),
    created_at: isoNow()
  });
  await registerEvent("avaliacao_recebida", "rating", rating.id, cleanId(body.customerId), null, { score: body.score });
  return { id: rating.id, createdAt: rating.created_at };
}

async function listUsers() {
  const profiles = await select("profiles", "select=id,name,email,role,status,created_at&order=created_at.asc");
  const permissions = await select("profile_sector_permissions", "select=profile_id,sector_id");
  const byProfile = new Map();
  permissions.forEach((item) => {
    const current = byProfile.get(item.profile_id) || [];
    current.push(item.sector_id);
    byProfile.set(item.profile_id, current);
  });
  return profiles.map((profile) => userDto({ ...profile, sectorIds: byProfile.get(profile.id) || [] }));
}

async function createUser(body) {
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const name = String(body.name || "").trim();
  const role = ["customer", "attendant", "manager", "admin"].includes(body.role) ? body.role : "attendant";
  if (!email || !name || !validateStrongPassword(password)) return fail("Informe nome, e-mail e senha com ao menos 12 caracteres, letras maiusculas, minusculas e numeros.");
  const auth = await supabaseFetch("/auth/v1/admin/users", {
    method: "POST",
    body: { email, password, email_confirm: true, user_metadata: { name, role } }
  });
  if (auth.error || !auth.id) return fail(auth.error || "Nao foi possivel criar usuario.");
  const profile = await upsert("profiles", { id: auth.id, email, name, role, status: "active" }, "id");
  await setUserSectorPermissions(auth.id, Array.isArray(body.sectorIds) ? body.sectorIds : []);
  return { user: userDto({ ...profile, sectorIds: Array.isArray(body.sectorIds) ? body.sectorIds : [] }) };
}

async function ticketDto(row) {
  if (!row) return null;
  const sector = await getSector(row.sector_id);
  const ahead = await countAhead(row);
  const isWaiting = CALL_ELIGIBLE_STATUSES.includes(row.status);
  const position = isWaiting ? ahead + 1 : 1;
  const averageStats = await averageServiceStats(sector);
  const averageSeconds = averageStats.seconds;
  const activeDelay = isWaiting ? await activeServiceDelaySeconds(sector.id, averageSeconds) : 0;
  const eligibleDelay = isWaiting ? secondsUntil(row.eligible_at || row.created_at) : 0;
  const secondsToCall = isWaiting ? Math.max(eligibleDelay, activeDelay + ahead * averageSeconds) : 0;
  const estimatedCallAt = isWaiting ? new Date(Date.now() + secondsToCall * 1000).toISOString() : null;
  return {
    id: row.id,
    customerId: row.customer_id,
    deviceId: row.device_id,
    sectorId: row.sector_id,
    sector: sector.name,
    ticket: row.code,
    current: await currentCode(sector),
    counterLabel: sector.counter_label,
    serviceLabel: sector.service_label,
    status: row.status,
    priority: Boolean(row.priority),
    priorityReason: row.priority_reason,
    position,
    ahead,
    secondsToCall,
    averageServiceSeconds: averageSeconds,
    averageServiceSamples: averageStats.samples,
    estimateBasedOnRecentServices: averageStats.samples > 0,
    countdownTotalSeconds: isWaiting ? Math.max(secondsToCall, secondsBetween(row.created_at, estimatedCallAt)) : 0,
    estimatedCallAt,
    progress: progressFor(row.status, position),
    smartWaitReason: row.smart_wait_reason,
    locationVerified: Boolean(row.location_verified),
    qrVerified: Boolean(row.qr_verified),
    locationDistanceMeters: row.location_distance_meters,
    absenceCount: row.absence_count || 0,
    calledAt: row.called_at,
    eligibleAt: row.eligible_at,
    standbyStartedAt: row.standby_started_at,
    standbyExpiresAt: row.standby_expires_at,
    standbySecondsRemaining: row.standby_expires_at ? secondsUntil(row.standby_expires_at) : 0,
    serviceStartedAt: row.service_started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at
  };
}

async function sectorDto(row) {
  const stats = await averageServiceStats(row);
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    counterLabel: row.counter_label,
    serviceLabel: row.service_label,
    queueSize: row.queue_size,
    averageServiceSeconds: stats.seconds,
    averageServiceSamples: stats.samples,
    estimateBasedOnRecentServices: stats.samples > 0,
    capacity: row.capacity,
    status: row.status,
    current: await currentCode(row)
  };
}

function cartItemDto(row) {
  return {
    id: row.id,
    customerId: row.customer_id,
    productId: row.product_id,
    productName: row.product_name,
    sectorName: row.sector_name,
    price: row.price,
    quantity: row.quantity,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function userDto(row) {
  return {
    id: row.id,
    customerId: row.id,
    name: row.name,
    email: row.email,
    role: normalizeRole(row.role),
    status: row.status,
    sectorIds: row.sectorIds || [],
    createdAt: row.created_at || row.createdAt || null
  };
}

async function upsertSession(body, userAgent) {
  const customerId = cleanId(body.customerId);
  const deviceId = cleanId(body.deviceId) || `device-${crypto.randomUUID()}`;
  if (!customerId) return { customerId, deviceId };
  await upsert("devices", { id: deviceId, customer_id: customerId, user_agent: userAgent, last_seen_at: isoNow() }, "id");
  return { customerId, deviceId };
}

async function runScheduledJobs() {
  await expireAbsentCalls();
  await expireExpiredStandbyTickets();
  await autoCallReadyTickets();
}

async function autoCallReadyTickets() {
  for (const sector of await getSectors()) {
    if (sector.status !== "open") continue;
    const active = await getActiveSectorTicket(sector.id);
    if (active) continue;
    await callNextTicket(sector.id, { requireEligible: true });
  }
}

async function expireAbsentCalls() {
  const cutoff = new Date(Date.now() - CALL_ABSENCE_SECONDS * 1000).toISOString();
  const expired = await select("tickets", `status=eq.chamado&service_started_at=is.null&finished_at=is.null&called_at=lt.${encodeURIComponent(cutoff)}`);
  for (const ticket of expired) {
    const absenceCount = Number(ticket.absence_count || 0) + 1;
    const now = isoNow();
    if (absenceCount >= 2) {
      await update("tickets", ticket.id, {
        status: "cancelado",
        absence_count: absenceCount,
        canceled_at: now,
        called_at: null,
        standby_started_at: null,
        standby_expires_at: null,
        updated_at: now
      });
      await registerEvent("senha_cancelada_por_ausencia", "ticket", ticket.id, ticket.customer_id, ticket.sector_id, { absenceCount });
      continue;
    }
    await update("tickets", ticket.id, {
      status: "standby",
      absence_count: absenceCount,
      called_at: null,
      standby_started_at: now,
      standby_expires_at: new Date(Date.now() + STANDBY_SECONDS * 1000).toISOString(),
      queue_order: Number(ticket.queue_order || 0) + 1000,
      updated_at: now
    });
    await registerEvent("senha_em_standby_por_ausencia", "ticket", ticket.id, ticket.customer_id, ticket.sector_id, { absenceCount });
  }
}

async function expireExpiredStandbyTickets() {
  const now = isoNow();
  const expired = await select("tickets", `status=eq.standby&standby_expires_at=not.is.null&standby_expires_at=lt.${encodeURIComponent(now)}`);
  for (const ticket of expired) {
    await update("tickets", ticket.id, { status: "cancelado", canceled_at: now, standby_started_at: null, standby_expires_at: null, updated_at: now });
    await registerEvent("senha_cancelada_por_standby_expirado", "ticket", ticket.id, ticket.customer_id, ticket.sector_id, { code: ticket.code });
  }
}

async function expireStaleActiveTickets() {
  const today = businessDateFor();
  const active = await select("tickets", `status=in.(${ACTIVE_STATUSES.join(",")})`);
  const stale = active.filter((ticket) => businessDateFor(ticket.created_at) !== today);
  for (const ticket of stale) {
    const now = isoNow();
    await update("tickets", ticket.id, {
      status: "expirado",
      expired_at: now,
      called_at: null,
      smart_wait_reason: null,
      blocked_by_ticket_id: null,
      smart_wait_since: null,
      updated_at: now
    });
    await registerEvent("senha_expirada_por_reset_diario", "ticket", ticket.id, ticket.customer_id, ticket.sector_id, { code: ticket.code });
  }
}

async function nextTicketNumber(sectorId) {
  const now = isoNow();
  const businessDate = businessDateFor(now);
  const rows = await select("ticket_counters", `sector_id=eq.${encodeURIComponent(sectorId)}&limit=1`);
  const current = rows[0];
  const shouldReset = !current || current.business_date !== businessDate || Number(current.last_number) >= TICKET_MAX_NUMBER;
  const nextNumber = shouldReset ? TICKET_MIN_NUMBER : Number(current.last_number) + 1;
  await upsert("ticket_counters", { sector_id: sectorId, business_date: businessDate, last_number: nextNumber, updated_at: now }, "sector_id");
  return nextNumber;
}

async function nextQueueOrder(sectorId) {
  const rows = await select("tickets", `sector_id=eq.${encodeURIComponent(sectorId)}&select=queue_order&order=queue_order.desc&limit=1`);
  return Number(rows[0]?.queue_order || 0) + 1;
}

async function getSectors() {
  return select("sectors", "order=id.asc");
}

async function getSector(id) {
  return (await select("sectors", `id=eq.${encodeURIComponent(id)}&limit=1`))[0] || null;
}

async function getTicket(id) {
  return (await select("tickets", `id=eq.${encodeURIComponent(id)}&limit=1`))[0] || null;
}

async function getActiveSectorTicket(sectorId) {
  return (await select("tickets", `sector_id=eq.${encodeURIComponent(sectorId)}&status=in.(${CALL_BLOCKING_STATUSES.join(",")})&order=updated_at.desc&limit=1`))[0] || null;
}

async function getBlockingTicket(candidate) {
  const rows = await select("tickets", `id=neq.${encodeURIComponent(candidate.id)}&or=(customer_id.eq.${encodeURIComponent(candidate.customer_id)},device_id.eq.${encodeURIComponent(candidate.device_id)})&status=in.(${CALL_BLOCKING_STATUSES.join(",")})&order=updated_at.desc&limit=1`);
  return rows[0] || null;
}

async function countAhead(ticket) {
  if (!CALL_ELIGIBLE_STATUSES.includes(ticket.status)) return 0;
  const rows = await select("tickets", `sector_id=eq.${encodeURIComponent(ticket.sector_id)}&status=in.(${CALL_ELIGIBLE_STATUSES.join(",")})&select=id,priority,queue_order`);
  return rows.filter((row) => Number(row.priority || 0) > Number(ticket.priority || 0) || (Number(row.priority || 0) === Number(ticket.priority || 0) && Number(row.queue_order) < Number(ticket.queue_order))).length;
}

async function activeServiceDelaySeconds(sectorId, averageSeconds) {
  const active = await getActiveSectorTicket(sectorId);
  if (!active) return 0;
  const startedAt = active.service_started_at || active.called_at || active.updated_at;
  const elapsed = secondsBetween(startedAt, isoNow());
  const limit = active.status === "chamado" ? CALL_ABSENCE_SECONDS : averageSeconds;
  return Math.max(0, limit - elapsed);
}

async function averageServiceStats(sector) {
  const rows = await select("tickets", `sector_id=eq.${encodeURIComponent(sector.id)}&service_started_at=not.is.null&finished_at=not.is.null&select=service_started_at,finished_at&order=finished_at.desc&limit=20`);
  const durations = rows.map((row) => secondsBetween(row.service_started_at, row.finished_at)).filter((seconds) => Number.isFinite(seconds) && seconds > 0);
  const measured = average(durations);
  return { seconds: measured || sector.average_service_seconds, samples: durations.length };
}

async function currentCode(sector) {
  const active = await getActiveSectorTicket(sector.id);
  if (active) return active.code;
  const counter = (await select("ticket_counters", `sector_id=eq.${encodeURIComponent(sector.id)}&limit=1`))[0];
  const currentNumber = counter?.business_date === businessDateFor() ? Number(counter.last_number) : TICKET_MIN_NUMBER;
  return formatTicket(sector.prefix, currentNumber);
}

async function recentSectorCalls(sectorId) {
  const calls = await select("calls", `sector_id=eq.${encodeURIComponent(sectorId)}&select=action,created_at,ticket_id&order=created_at.desc&limit=6`);
  return mapAsync(calls, async (call) => {
    const ticket = call.ticket_id ? await getTicket(call.ticket_id) : null;
    return {
      action: call.action,
      ticket: ticket?.code || "--",
      status: ticket?.status || "",
      priority: Boolean(ticket?.priority),
      createdAt: call.created_at
    };
  });
}

async function canOperateOnTicket(user, ticketId) {
  const ticket = await getTicket(ticketId);
  if (!ticket) return false;
  if (hasAnyRole(user, STAFF_ROLES)) return canAccessSectorSync(user, ticket.sector_id);
  if (hasAnyRole(user, CUSTOMER_ROLES)) return ticket.customer_id === user.customerId;
  return false;
}

async function canAccessSector(user, sectorId) {
  return canAccessSectorSync(user, sectorId);
}

function canAccessSectorSync(user, sectorId) {
  if (hasAnyRole(user, ADMIN_ROLES)) return true;
  return Array.isArray(user?.sectorIds) && user.sectorIds.includes(sectorId);
}

async function setUserSectorPermissions(userId, sectorIds) {
  const current = await select("profile_sector_permissions", `profile_id=eq.${encodeURIComponent(userId)}`);
  await Promise.all(current.map((row) => removePermission(row.profile_id, row.sector_id)));
  const valid = sectorIds.filter(Boolean);
  await Promise.all(valid.map((sectorId) => insert("profile_sector_permissions", { profile_id: userId, sector_id: sectorId }, false)));
}

async function removePermission(profileId, sectorId) {
  await supabaseFetch(`/rest/v1/profile_sector_permissions?profile_id=eq.${encodeURIComponent(profileId)}&sector_id=eq.${encodeURIComponent(sectorId)}`, { method: "DELETE" });
}

async function getProfile(userId, fallbackEmail = "") {
  const profile = (await select("profiles", `id=eq.${encodeURIComponent(userId)}&limit=1`))[0];
  if (!profile) return null;
  const permissions = await select("profile_sector_permissions", `profile_id=eq.${encodeURIComponent(userId)}&select=sector_id`);
  return userDto({ ...profile, email: profile.email || fallbackEmail, sectorIds: permissions.map((item) => item.sector_id) });
}

async function getAuthUser(request) {
  const token = getCookie(request, "fz_auth");
  const session = verifySessionToken(token);
  if (!session?.user?.id) return null;
  const profile = await getProfile(session.user.id, session.email);
  if (!profile || profile.status !== "active") return null;
  return { ...profile, csrf_token: session.csrfToken };
}

async function requireUser(request, roles) {
  const user = await getAuthUser(request);
  if (!user) return { response: json({ error: "Autenticacao necessaria." }, 401) };
  if (!hasAnyRole(user, roles)) return { response: json({ error: "Acesso negado." }, 403) };
  return user;
}

async function verifyCsrf(request, user) {
  if (!user || !["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return Boolean(user);
  const headerToken = String(request.headers.get("x-csrf-token") || "");
  const cookieToken = getCookie(request, "fz_csrf") || "";
  const expected = user.csrf_token || "";
  return safeEqual(headerToken, expected) && safeEqual(cookieToken, expected);
}

async function isLoginLocked(key) {
  const entry = (await select("login_attempts", `attempt_key=eq.${encodeURIComponent(key)}&limit=1`))[0];
  return Boolean(entry && Number(entry.locked_until) > Date.now());
}

async function registerLoginFailure(key) {
  const now = Date.now();
  const entry = (await select("login_attempts", `attempt_key=eq.${encodeURIComponent(key)}&limit=1`))[0];
  const firstAttemptAt = entry && now - Number(entry.first_attempt_at) < LOGIN_ATTEMPT_WINDOW_MS ? Number(entry.first_attempt_at) : now;
  const attempts = entry && firstAttemptAt === Number(entry.first_attempt_at) ? Number(entry.count) + 1 : 1;
  const lockedUntil = attempts >= LOGIN_ATTEMPT_LIMIT ? now + LOGIN_LOCK_MS : 0;
  await upsert("login_attempts", { attempt_key: key, count: attempts, first_attempt_at: firstAttemptAt, locked_until: lockedUntil, updated_at: isoNow() }, "attempt_key");
}

async function clearLoginFailures(key) {
  await supabaseFetch(`/rest/v1/login_attempts?attempt_key=eq.${encodeURIComponent(key)}`, { method: "DELETE" });
}

async function registerEvent(type, entityType, entityId, customerId, sectorId, payload = {}) {
  await insert("events", { type, entity_type: entityType, entity_id: String(entityId), customer_id: customerId, sector_id: sectorId, payload, created_at: isoNow() }, false);
}

async function select(table, query = "") {
  const separator = query ? (query.startsWith("?") ? "" : "?") : "?";
  const path = `/rest/v1/${table}${separator}${query || "select=*"}`;
  const result = await supabaseFetch(path);
  return Array.isArray(result) ? result : [];
}

async function count(table, query = "") {
  const result = await supabaseFetch(`/rest/v1/${table}?select=id&${query}`, { headers: { Prefer: "count=exact" }, raw: true });
  return Number(result.count || 0);
}

async function insert(table, body, returning = true) {
  const result = await supabaseFetch(`/rest/v1/${table}${returning ? "?select=*" : ""}`, {
    method: "POST",
    headers: { Prefer: returning ? "return=representation" : "return=minimal" },
    body
  });
  if (result.error) throw new Error(result.error);
  return Array.isArray(result) ? result[0] : result;
}

async function update(table, id, body) {
  const result = await supabaseFetch(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&select=*`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body
  });
  if (result.error) throw new Error(result.error);
  return Array.isArray(result) ? result[0] : result;
}

async function upsert(table, body, onConflict) {
  const result = await supabaseFetch(`/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}&select=*`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body
  });
  if (result.error) throw new Error(result.error);
  return Array.isArray(result) ? result[0] : result;
}

async function rpc(name, body) {
  const result = await supabaseFetch(`/rest/v1/rpc/${name}`, {
    method: "POST",
    body
  });
  return Array.isArray(result) ? result[0] : result;
}

async function remove(table, id) {
  return supabaseFetch(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
}

async function supabaseFetch(pathname, options = {}) {
  const headers = {
    "content-type": "application/json",
    apikey: options.apiKey || SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${options.bearer || SUPABASE_SERVICE_ROLE_KEY}`,
    ...(options.headers || {})
  };
  const response = await fetch(`${SUPABASE_URL}${pathname}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (options.raw) {
    return { payload, count: response.headers.get("content-range")?.split("/")?.[1] };
  }
  if (!response.ok) return { error: payload?.error_description || payload?.message || response.statusText, status: response.status };
  return payload;
}

function isSupabaseReady() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);
}

function validateCustomerRegistration(body) {
  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.name || "").trim();
  const password = String(body.password || "");
  if (!name || name.length < 2) return { error: "Informe seu nome completo." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Informe um e-mail valido." };
  if (password.length < 8) return { error: "A senha precisa ter ao menos 8 caracteres." };
  return { email, name, password };
}

function validateStrongPassword(password, minimum = 12) {
  return (
    typeof password === "string" &&
    password.length >= minimum &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password)
  );
}

function normalizePriority(body) {
  const enabled = body.priority === true || body.priority === "true" || body.priority === "1";
  const reason = cleanId(body.priorityReason);
  return { enabled, reason: enabled && PRIORITY_CATEGORIES.has(reason) ? reason : null };
}

function hasAnyRole(user, roles) {
  return Boolean(user && roles.includes(normalizeRole(user.role)));
}

function normalizeRole(role) {
  return role === "admin" ? "manager" : role;
}

function formatTicket(prefix, number) {
  return `${prefix}${String(number).padStart(3, "0")}`;
}

function progressFor(status, position) {
  if (status === "em_atendimento") return 100;
  if (status === "chamado") return 95;
  if (status === "espera_inteligente") return 92;
  if (status === "standby") return 48;
  if (status === "proximo") return 82;
  return Math.max(14, Math.min(76, 80 - position * 7));
}

function satisfactionSummary(rows) {
  const scoreMap = { Ruim: 1, Regular: 2, "Otima": 3, "Ótima": 3 };
  const scores = rows.map((row) => scoreMap[row.score]).filter(Boolean);
  return { count: scores.length, average: scores.length ? Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2)) : 0 };
}

function authSecret() {
  const secret = process.env.AUTH_SECRET || "";
  if (secret.length >= 32) return secret;
  if (process.env.NODE_ENV !== "production") return "fila-zero-demo-auth-secret-change-before-production";
  throw new Error("AUTH_SECRET precisa ter ao menos 32 caracteres em producao.");
}

function signSessionToken(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `session.${encoded}.${signValue(encoded)}`;
}

function verifySessionToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts[0] !== "session") return null;
  const [, encoded, signature] = parts;
  if (!safeEqual(signature, signValue(encoded))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!payload.email || !payload.csrfToken || new Date(payload.expiresAt).getTime() <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function signValue(value) {
  return crypto.createHmac("sha256", AUTH_SECRET).update(value).digest("base64url");
}

function safeEqual(left, right) {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function authCookies(sessionToken, csrfToken) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return {
    "set-cookie": [
      `fz_auth=${encodeURIComponent(sessionToken)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secure}`,
      `fz_csrf=${encodeURIComponent(csrfToken)}; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secure}`
    ]
  };
}

function clearAuthCookies() {
  return {
    "set-cookie": [
      "fz_auth=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
      "fz_csrf=; SameSite=Lax; Path=/; Max-Age=0"
    ]
  };
}

function getCookie(request, name) {
  const cookies = String(request.headers.get("cookie") || "").split(";").map((item) => item.trim());
  const match = cookies.find((item) => item.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function clientIp(request) {
  return String(request.headers.get("x-forwarded-for") || "local").split(",")[0].trim();
}

async function readJson(request) {
  const text = await request.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function json(payload, status = 200, extraHeaders = {}) {
  const headers = new Headers(securityHeaders({ "content-type": "application/json; charset=utf-8" }));
  Object.entries(extraHeaders).forEach(([name, value]) => {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else headers.set(name, value);
  });
  return new Response(JSON.stringify(payload), { status, headers });
}

function securityHeaders(extra = {}) {
  return {
    "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https://source.unsplash.com https://images.unsplash.com; connect-src 'self'; font-src 'self' https://fonts.gstatic.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
    "referrer-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), payment=(), usb=()",
    ...extra
  };
}

function fail(message) {
  return { error: message };
}

function cleanId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toPositiveInt(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
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

function average(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (!clean.length) return 0;
  return Math.round(clean.reduce((sum, value) => sum + value, 0) / clean.length);
}

function isoNow() {
  return new Date().toISOString();
}

function businessDateFor(value = isoNow()) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

async function mapAsync(items, mapper) {
  return Promise.all(items.map(mapper));
}

module.exports = { handleRequest };
