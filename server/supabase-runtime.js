const crypto = require("node:crypto");
const {
  DEFAULT_PREFERENCES,
  PushNotificationService,
  isAllowedPushEndpoint,
  loadPushConfiguration,
  normalizePreferences,
  preferencesToRow,
  validatePushSubscription
} = require("./push-notification-service");
const {
  clearKioskCookies,
  createKioskSession,
  kioskCookies,
  loadKioskConfiguration,
  printJobDto,
  validatePhysicalTicketBundleInput,
  validatePhysicalTicketInput,
  verifyKioskRequest,
  verifyKioskSession,
  verifyPrintAgentRequest
} = require("./print-kiosk-service");
const {
  evaluatePasswordPolicy,
  isStrongPassword,
  passwordPolicyError
} = require("./password-policy");
const {
  createRequestContext,
  dispatchObservabilityAlert,
  durationMs,
  errorDetails,
  finishRequest,
  logStructured,
  summarizePrintAttempts
} = require("./observability");
const { healthResponse } = require("./production-readiness");

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_ANON_KEY = String(process.env.SUPABASE_ANON_KEY || "");
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
const AUTH_SECRET = authSecret();
const CRON_SECRET = String(process.env.CRON_SECRET || "");
const KIOSK_CONFIGURATION = loadKioskConfiguration(process.env);
const AUTO_CONFIRM_PUBLIC_CUSTOMERS = process.env.SUPABASE_AUTO_CONFIRM_CUSTOMERS === "1";
const PRESENCE_CHECK_ENABLED = false;
const PUSH_CONFIGURATION = loadPushConfiguration(process.env);
const pushNotificationService = new PushNotificationService({
  repository: createSupabasePushRepository(),
  configuration: PUSH_CONFIGURATION
});

const BUSINESS_TIME_ZONE = "America/Sao_Paulo";
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const MAX_ACTIVE_TICKETS_PER_CUSTOMER = 3;
const AUTO_CALL_DELAY_SECONDS = 30;
const TRACKING_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const CALL_ABSENCE_SECONDS = 10 * 60;
const STANDBY_SECONDS = 10 * 60;
const STANDBY_WARNING_SECONDS = 2 * 60;
const TICKET_MIN_NUMBER = 0;
const TICKET_MAX_NUMBER = 999;
const ACTIVE_STATUSES = ["aguardando", "proximo", "chamado", "em_atendimento", "espera_inteligente", "standby"];
const CALL_ELIGIBLE_STATUSES = ["aguardando", "proximo", "standby"];
const QUEUE_WAITING_STATUSES = ["aguardando", "proximo", "espera_inteligente", "standby"];
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
const SCHEDULED_JOBS_MIN_INTERVAL_MS = 15000;
const PROFILE_CACHE_TTL_MS = 10 * 1000;
const METRICS_CACHE_TTL_MS = 60 * 1000;
const OFFER_INSIGHTS_CACHE_TTL_MS = 60 * 1000;

const profileCache = new Map();
let scheduledJobsLastRun = 0;
let scheduledJobsPromise = null;
let metricsCache = null;
let offerInsightsCache = null;

async function handleRequest(request) {
  const url = new URL(request.url);
  const context = createRequestContext({
    method: request.method,
    path: url.pathname,
    headers: request.headers
  });
  logStructured("info", "request.started", {
    requestId: context.requestId,
    method: context.method,
    path: context.path
  });
  let response;
  try {
    response = await handleRequestInternal(request, context);
  } catch (error) {
    if (error?.code === "INVALID_JSON") {
      response = json({ error: "O corpo da requisicao precisa ser um JSON valido." }, 400);
    } else {
      logStructured("error", "request.unhandled_error", {
        requestId: context.requestId,
        method: context.method,
        path: context.path,
        ...errorDetails(error)
      });
      response = json({ error: "Erro interno do servidor." }, 500);
    }
  }
  const decorated = withRequestId(response, context.requestId);
  finishRequest(context, decorated.status);
  return decorated;
}

async function handleRequestInternal(request, context = null) {
  const url = new URL(request.url);
  try {
    if (request.method === "GET" && url.pathname === "/api/health") {
      const health = healthResponse(process.env);
      return json(health, health.ok ? 200 : 503);
    }
    if (!isSupabaseReady()) {
      return json({ error: "Supabase nao configurado." }, 500);
    }
    if (request.method === "GET" && url.pathname === "/api/internal/jobs") return internalJobsRoute(request, context);
    if (request.method === "GET" && url.pathname === "/api/observability") return observabilityRoute(request);
    if (request.method === "GET" && url.pathname === "/api/config") {
      return json({ presenceCheckEnabled: PRESENCE_CHECK_ENABLED });
    }
    await maybeRunScheduledJobs({
      wait: url.pathname === "/api/state" || url.pathname === "/api/staff/state" || url.pathname === "/api/events"
    });

    if (request.method === "POST" && url.pathname === "/api/auth/login") return login(request);
    if (request.method === "POST" && url.pathname === "/api/auth/change-password") return changePassword(request);
    if (request.method === "POST" && url.pathname === "/api/auth/forgot-password") return forgotPassword(request);
    if (request.method === "POST" && url.pathname === "/api/auth/reset-password") return resetPassword(request);
    if (request.method === "POST" && url.pathname === "/api/auth/register") return registerCustomer(request);
    if (request.method === "POST" && url.pathname === "/api/auth/logout") return logout(request);
    if (request.method === "GET" && url.pathname === "/api/auth/me") return me(request);
    if (request.method === "GET" && url.pathname === "/api/kiosk/status") return kioskStatusRoute(request);
    const trackedTicket = url.pathname.match(/^\/api\/tickets\/track\/([A-Za-z0-9_-]{20,100})$/);
    if (request.method === "GET" && trackedTicket) return ticketTrackingRoute(request, decodeURIComponent(trackedTicket[1]));
    if (request.method === "POST" && url.pathname === "/api/kiosk/pair") return pairKioskRoute(request);
    if (request.method === "POST" && url.pathname === "/api/kiosk/unpair") return unpairKioskRoute(request);
    if (request.method === "POST" && url.pathname === "/api/kiosk/tickets") return createPhysicalTicketRoute(request);
    if (request.method === "POST" && url.pathname === "/api/print/jobs/claim") return claimPrintJobRoute(request);
    if (request.method === "GET" && url.pathname === "/api/push/status") return pushStatusRoute(request);
    if (request.method === "POST" && url.pathname === "/api/push/subscribe") return pushSubscribeRoute(request);
    if (request.method === "DELETE" && url.pathname === "/api/push/unsubscribe") return pushUnsubscribeRoute(request);
    if (request.method === "PATCH" && url.pathname === "/api/push/preferences") return pushPreferencesRoute(request);
    if (request.method === "POST" && url.pathname === "/api/push/test") return pushTestRoute(request);
    if (request.method === "GET" && url.pathname === "/api/events") return events(request, url);
    if (request.method === "POST" && url.pathname === "/api/sessions") return sessions(request);
    if (request.method === "GET" && url.pathname === "/api/state") return state(request);
    if (request.method === "GET" && url.pathname === "/api/history") return history(request);
    if (request.method === "GET" && url.pathname === "/api/staff/state") return staffState(request);
    if (request.method === "GET" && url.pathname === "/api/metrics") return metrics(request);
    if (request.method === "GET" && url.pathname === "/api/offer-insights") return offerInsights(request, url);
    if (request.method === "POST" && url.pathname === "/api/tickets") return createTicketRoute(request);
    if (request.method === "GET" && url.pathname === "/api/cart") return cart(request);
    if (request.method === "GET" && url.pathname === "/api/shopping-agent") return shoppingAgent(request);
    if (request.method === "POST" && url.pathname === "/api/shopping-signals") return shoppingSignal(request);
    if (request.method === "POST" && url.pathname === "/api/cart/items") return addCartItemRoute(request);
    if (request.method === "POST" && url.pathname === "/api/ratings") return rating(request);
    if (request.method === "GET" && url.pathname === "/api/users") return users(request);
    if (request.method === "POST" && url.pathname === "/api/users") return createUserRoute(request);

    const confirmMatch = url.pathname.match(/^\/api\/tickets\/([^/]+)\/confirm$/);
    if (request.method === "POST" && confirmMatch) return confirmTicketRoute(request, confirmMatch[1]);

    const kioskPrintJobMatch = url.pathname.match(/^\/api\/kiosk\/print-jobs\/([^/]+)$/);
    if (request.method === "GET" && kioskPrintJobMatch) return kioskPrintJobRoute(request, kioskPrintJobMatch[1]);

    const printFinishMatch = url.pathname.match(/^\/api\/print\/jobs\/([^/]+)\/finish$/);
    if (request.method === "POST" && printFinishMatch) return finishPrintJobRoute(request, printFinishMatch[1]);

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
    if (request.method === "PATCH" && cartDeleteMatch) return updateCartItemRoute(request, cartDeleteMatch[1]);
    if (request.method === "DELETE" && cartDeleteMatch) return removeCartItemRoute(request, cartDeleteMatch[1]);

    return json({ error: "Rota nao encontrada." }, 404);
  } catch (error) {
    if (error?.code === "INVALID_JSON") throw error;
    logStructured("error", "request.handler_error", {
      requestId: context?.requestId,
      method: request.method,
      path: url.pathname,
      ...errorDetails(error)
    });
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
  const sessionId = crypto.randomUUID();
  await createAuthSession(sessionId, profile.id, csrfToken, expiresAt);
  const sessionToken = signSessionToken({ sessionId, provider: "supabase", email: profile.email, user: profile, csrfToken, expiresAt });
  return json({ user: profile, csrfToken }, 200, authCookies(sessionToken, csrfToken));
}

async function changePassword(request) {
  const body = await readJson(request);
  const email = String(body.email || "").trim().toLowerCase();
  const currentPassword = String(body.currentPassword || "");
  const newPassword = String(body.newPassword || "");
  if (!email || !currentPassword || !validateStrongPassword(newPassword)) {
    return json({ error: "Informe e-mail, senha atual e uma nova senha forte com ao menos 12 caracteres, letras maiusculas, minusculas e numeros." }, 400);
  }
  const passwordPolicy = await validatePasswordPolicy(newPassword);
  if (passwordPolicy.error) return json({ error: passwordPolicy.error }, passwordPolicy.httpStatus);

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
  await revokeAuthSessionsForUser(auth.user.id);
  await clearLoginFailures(attemptKey);
  return json({ ok: true, message: "Senha alterada com sucesso. Entre usando a nova senha." });
}

async function forgotPassword(request) {
  const body = await readJson(request);
  const email = String(body.email || "").trim().toLowerCase();
  const response = {
    ok: true,
    message: "Se o e-mail estiver cadastrado, enviaremos um link para redefinir a senha."
  };
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(response, 202);

  const attemptKey = `${clientIp(request)}:${email}:forgot-password`;
  if (await isLoginLocked(attemptKey)) return json(response, 202);
  await registerLoginFailure(attemptKey);

  const redirectTo = `${String(process.env.PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/+$/, "")}/login?mode=reset`;
  const result = await supabaseFetch("/auth/v1/recover", {
    method: "POST",
    apiKey: SUPABASE_ANON_KEY,
    bearer: SUPABASE_ANON_KEY,
    body: { email, redirect_to: redirectTo }
  });
  if (result?.error) console.error("password_recovery_request_failed", result.error);
  return json(response, 202);
}

async function resetPassword(request) {
  const body = await readJson(request);
  const accessToken = String(body.accessToken || body.access_token || "");
  const newPassword = String(body.newPassword || "");
  if (!accessToken || !validateStrongPassword(newPassword)) {
    return json({ error: "Link de recuperacao invalido ou senha fraca. Use ao menos 12 caracteres, letras maiusculas, minusculas e numeros." }, 400);
  }
  const passwordPolicy = await validatePasswordPolicy(newPassword);
  if (passwordPolicy.error) return json({ error: passwordPolicy.error }, passwordPolicy.httpStatus);

  const attemptKey = `${clientIp(request)}:reset-password`;
  if (await isLoginLocked(attemptKey)) return json({ error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." }, 429);
  await registerLoginFailure(attemptKey);

  const authUser = await supabaseFetch("/auth/v1/user", {
    method: "GET",
    apiKey: SUPABASE_ANON_KEY,
    bearer: accessToken
  });
  if (authUser?.error || !authUser?.id) return json({ error: "Link de recuperacao invalido ou expirado." }, 400);

  const updated = await supabaseFetch("/auth/v1/user", {
    method: "PUT",
    apiKey: SUPABASE_ANON_KEY,
    bearer: accessToken,
    body: { password: newPassword }
  });
  if (updated?.error) return json({ error: "Nao foi possivel redefinir a senha agora." }, 400);

  await revokeAuthSessionsForUser(authUser.id);
  return json({ ok: true, message: "Senha redefinida com sucesso. Entre usando a nova senha." });
}

async function registerCustomer(request) {
  const body = await readJson(request);
  const data = validateCustomerRegistration(body);
  if (data.error) return json(data, 400);
  const passwordPolicy = await validatePasswordPolicy(data.password);
  if (passwordPolicy.error) return json({ error: passwordPolicy.error }, passwordPolicy.httpStatus);

  const ipRate = await consumeSecurityRateLimit("register:ip", clientIp(request), 12, 15 * 60);
  if (ipRate !== true) {
    return json({ error: ipRate === false ? "Muitas tentativas de cadastro. Aguarde alguns minutos." : "Cadastro temporariamente indisponivel." }, ipRate === false ? 429 : 503);
  }
  const emailRate = await consumeSecurityRateLimit("register:email", data.email, 5, 60 * 60);
  if (emailRate !== true) {
    return json({ error: emailRate === false ? "Muitas tentativas de cadastro. Aguarde alguns minutos." : "Cadastro temporariamente indisponivel." }, emailRate === false ? 429 : 503);
  }
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
  await revokeAuthSession(user.session_id);
  await revokePushSubscriptionsForUser(user.id);
  return json({ ok: true }, 200, clearAuthCookies());
}

async function me(request) {
  const user = await getAuthUser(request);
  return json({ user: user ? userDto(user) : null, csrfToken: user?.csrf_token || null });
}

async function internalJobsRoute(request, context = null) {
  const requestId = context?.requestId || request.headers.get("x-request-id") || null;
  const executionId = crypto.randomUUID();
  const startedAt = isoNow();
  if (!CRON_SECRET) {
    await recordCronExecutionStart(executionId, requestId, startedAt);
    const finishedAt = isoNow();
    await recordCronExecutionFinish(executionId, {
      finishedAt,
      status: "failed",
      durationMs: durationMs(startedAt, finishedAt),
      errorCode: "CRON_SECRET_MISSING",
      errorMessage: "CRON_SECRET nao configurado."
    });
    await dispatchObservabilityAlert({
      event: "cron.failed",
      requestId,
      jobName: "internal_jobs",
      executionId,
      errorCode: "CRON_SECRET_MISSING",
      errorMessage: "CRON_SECRET nao configurado."
    });
    return json({ error: "CRON_SECRET nao configurado." }, 503);
  }
  const authorization = String(request.headers.get("authorization") || "");
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const supplied = String(request.headers.get("x-cron-secret") || bearer || "");
  if (!safeEqual(supplied, CRON_SECRET)) return json({ error: "Nao autorizado." }, 401);

  await recordCronExecutionStart(executionId, requestId, startedAt);
  logStructured("info", "cron.started", {
    requestId,
    jobName: "internal_jobs",
    executionId
  });
  try {
    await maybeRunScheduledJobs({ wait: true });
    const finishedAt = isoNow();
    const executionDurationMs = durationMs(startedAt, finishedAt);
    await recordCronExecutionFinish(executionId, {
      finishedAt,
      status: "succeeded",
      durationMs: executionDurationMs,
      result: { ok: true }
    });
    logStructured("info", "cron.finished", {
      requestId,
      jobName: "internal_jobs",
      executionId,
      status: "succeeded",
      durationMs: executionDurationMs
    });
    return json({ ok: true, durationMs: executionDurationMs, executedAt: finishedAt, requestId });
  } catch (error) {
    const finishedAt = isoNow();
    const details = errorDetails(error);
    const executionDurationMs = durationMs(startedAt, finishedAt);
    await recordCronExecutionFinish(executionId, {
      finishedAt,
      status: "failed",
      durationMs: executionDurationMs,
      errorCode: details.errorCode,
      errorMessage: details.errorMessage
    });
    logStructured("error", "cron.finished", {
      requestId,
      jobName: "internal_jobs",
      executionId,
      status: "failed",
      durationMs: executionDurationMs,
      ...details
    });
    await dispatchObservabilityAlert({
      event: "cron.failed",
      requestId,
      jobName: "internal_jobs",
      executionId,
      durationMs: executionDurationMs,
      ...details
    });
    return json({ error: "Falha ao executar jobs internos." }, 500);
  }
}

async function recordCronExecutionStart(id, requestId, startedAt) {
  try {
    await insert("cron_executions", {
      id,
      job_name: "internal_jobs",
      request_id: requestId || null,
      started_at: startedAt,
      status: "running",
      created_at: startedAt
    }, false);
  } catch (error) {
    logStructured("warn", "observability.persistence_failed", {
      entity: "cron_execution",
      operation: "start",
      ...errorDetails(error)
    });
  }
}

async function recordCronExecutionFinish(id, { finishedAt, status, durationMs: elapsedMs, result, errorCode, errorMessage }) {
  try {
    await update("cron_executions", id, {
      finished_at: finishedAt,
      duration_ms: Number.isFinite(Number(elapsedMs)) ? Number(elapsedMs) : null,
      status,
      result: result || null,
      error_code: errorCode || null,
      error_message: errorMessage || null
    });
  } catch (error) {
    logStructured("warn", "observability.persistence_failed", {
      entity: "cron_execution",
      operation: "finish",
      ...errorDetails(error)
    });
  }
}

async function observabilityRoute(request) {
  const user = await requireUser(request, ADMIN_ROLES);
  if (user.response) return user.response;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [cronRecent, cronExecutionsLast24h, cronFailuresLast24h, pendingJobs, printingJobs, failedJobs, printedJobs, attempts] = await Promise.all([
    select("cron_executions", "select=id,job_name,request_id,started_at,finished_at,duration_ms,status,result,error_code,error_message&order=started_at.desc&limit=20"),
    count("cron_executions", `started_at=gte.${encodeURIComponent(since)}`),
    count("cron_executions", `started_at=gte.${encodeURIComponent(since)}&status=eq.failed`),
    count("print_jobs", "status=eq.pending"),
    count("print_jobs", "status=eq.printing"),
    count("print_jobs", "status=eq.failed"),
    count("print_jobs", "status=eq.printed"),
    select("print_job_attempts", "select=job_id,attempt_number,duration_ms,status,started_at,finished_at&order=started_at.desc&limit=1000")
  ]);
  const attemptMetrics = summarizePrintAttempts(attempts);
  const latestCron = cronRecent[0] || null;
  const latestCronFailure = cronRecent.find((item) => item.status === "failed") || null;

  return json({
    generatedAt: isoNow(),
    alerts: {
      webhookConfigured: Boolean(String(process.env.OBSERVABILITY_ALERT_WEBHOOK_URL || "").trim())
    },
    cron: {
      executionsLast24h: Number(cronExecutionsLast24h || 0),
      failuresLast24h: Number(cronFailuresLast24h || 0),
      latest: latestCron,
      latestFailure: latestCronFailure,
      recent: cronRecent
    },
    printing: {
      pendingJobs: Number(pendingJobs || 0),
      printingJobs: Number(printingJobs || 0),
      failedJobs: Number(failedJobs || 0),
      printedJobs: Number(printedJobs || 0),
      ...attemptMetrics
    }
  });
}

async function kioskStatusRoute(request, sessionOverride = null) {
  const session = sessionOverride || verifyKioskSession(getCookie(request, "senhahub_kiosk"), AUTH_SECRET);
  const [user, kioskRows, sectors] = await Promise.all([
    getAuthUser(request),
    session ? select("print_kiosks", `id=eq.${encodeURIComponent(session.kioskId)}&session_nonce=eq.${encodeURIComponent(session.sessionNonce)}&active=eq.true&limit=1`) : [],
    getSectors()
  ]);
  if (!session && !hasAnyRole(user, ADMIN_ROLES)) return json({ error: "Acesso do totem nao autorizado." }, 401);
  const kiosk = kioskRows[0];
  const openSectors = await kioskSectorDtos(sectors
    .filter((sector) => sector.status === "open")
    .filter((sector) => !kiosk || kiosk.mode !== "sector" || kiosk.sector_id === sector.id));
  return json({
    paired: Boolean(kiosk),
    canPair: hasAnyRole(user, ADMIN_ROLES),
    kiosk: kiosk ? kioskDto(kiosk) : null,
    sectors: openSectors
  });
}

async function pairKioskRoute(request) {
  const user = await requireUser(request, ADMIN_ROLES);
  if (user.response) return user.response;
  if (!(await verifyCsrf(request, user))) {
    return json({ error: "Token de seguranca invalido. Recarregue a pagina e tente novamente." }, 403);
  }
  const body = await readJson(request);
  if (body.kioskId && body.kioskId !== KIOSK_CONFIGURATION.id) {
    return json({ error: "Totem nao encontrado." }, 400);
  }
  const now = isoNow();
  const sessionNonce = crypto.randomBytes(24).toString("base64url");
  await upsert("print_kiosks", {
    id: KIOSK_CONFIGURATION.id,
    name: KIOSK_CONFIGURATION.name,
    active: true,
    mode: KIOSK_CONFIGURATION.mode,
    sector_id: KIOSK_CONFIGURATION.sectorId || null,
    printer_name: KIOSK_CONFIGURATION.printerName,
    printer_port: KIOSK_CONFIGURATION.printerPort,
    paper_width_mm: KIOSK_CONFIGURATION.paperWidthMm,
    install_url: KIOSK_CONFIGURATION.installUrl,
    app_url: KIOSK_CONFIGURATION.appUrl,
    session_nonce: sessionNonce,
    created_at: now,
    updated_at: now
  }, "id");
  const session = createKioskSession(KIOSK_CONFIGURATION.id, AUTH_SECRET, Date.now(), sessionNonce);
  await registerEvent("totem_vinculado", "kiosk", KIOSK_CONFIGURATION.id, null, null, { userId: user.id });
  const response = await kioskStatusRoute(request, session);
  const payload = await response.json();
  return json(payload, 200, { "set-cookie": kioskCookies(session, process.env.NODE_ENV === "production") });
}

async function unpairKioskRoute(request) {
  const user = await requireUser(request, ADMIN_ROLES);
  if (user.response) return user.response;
  if (!(await verifyCsrf(request, user))) {
    return json({ error: "Token de seguranca invalido. Recarregue a pagina e tente novamente." }, 403);
  }
  await update("print_kiosks", KIOSK_CONFIGURATION.id, {
    active: false,
    session_nonce: crypto.randomBytes(24).toString("base64url"),
    updated_at: isoNow()
  });
  return json(
    { ok: true },
    200,
    { "set-cookie": clearKioskCookies(process.env.NODE_ENV === "production") }
  );
}

async function createPhysicalTicketRoute(request) {
  const kiosk = verifyKioskRequest(request.headers, AUTH_SECRET);
  if (kiosk.error) return json({ error: kiosk.error }, kiosk.status);
  const body = await readJson(request);
  if (Array.isArray(body.sectorIds) && body.sectorIds.length > 1) {
    return createPhysicalTicketBundleRoute(kiosk, body);
  }
  const input = validatePhysicalTicketInput(body);
  if (input.error) return json(input, 400);
  const kioskRows = await select("print_kiosks", `id=eq.${encodeURIComponent(kiosk.kioskId)}&active=eq.true&limit=1`);
  const configuredKiosk = kioskRows[0];
  if (!configuredKiosk) return json({ error: "Totem indisponivel." }, 400);
  if (!safeEqual(configuredKiosk.session_nonce, kiosk.sessionNonce)) return json({ error: "Sessao do totem revogada. Vincule o totem novamente." }, 401);
  if (configuredKiosk.mode === "sector" && configuredKiosk.sector_id !== input.sectorId) {
    return json({ error: "Este totem esta configurado para outro setor." }, 400);
  }
  const kioskRate = await consumeSecurityRateLimit("kiosk:issue", kiosk.kioskId, 12, 60);
  if (kioskRate !== true) return json({ error: kioskRate === false ? "Limite de emissao atingido. Aguarde um minuto." : "Emissao temporariamente indisponivel." }, kioskRate === false ? 429 : 503);
  const priority = normalizePriority(body);
  const result = await rpc("issue_physical_ticket", {
    p_kiosk_id: kiosk.kioskId,
    p_sector_id: input.sectorId,
    p_idempotency_key: input.idempotencyKey,
    p_install_url: KIOSK_CONFIGURATION.installUrl,
    p_app_url: KIOSK_CONFIGURATION.appUrl,
    p_priority: priority.enabled,
    p_priority_reason: priority.reason,
    p_auto_call_delay_seconds: AUTO_CALL_DELAY_SECONDS
  });
  if (!result || result.error || !result.ticket) {
    return json({ error: "Nao foi possivel emitir a senha fisica agora." }, 400);
  }
  await registerEvent("senha_fisica_emitida", "ticket", result.ticket.id, null, result.ticket.sector_id, {
    code: result.ticket.code,
    kioskId: kiosk.kioskId,
    printJobId: result.printJob?.id
  });
  return json({
    ticket: await safeTicketDto(result.ticket),
    printJob: printJobDto(result.printJob),
    alreadyExists: Boolean(result.alreadyExists)
  }, 201);
}

async function createPhysicalTicketBundleRoute(kiosk, body) {
  const input = validatePhysicalTicketBundleInput(body);
  if (input.error) return json(input, 400);
  const kioskRows = await select("print_kiosks", `id=eq.${encodeURIComponent(kiosk.kioskId)}&active=eq.true&limit=1`);
  const configuredKiosk = kioskRows[0];
  if (!configuredKiosk) return json({ error: "Totem indisponivel." }, 400);
  if (!safeEqual(configuredKiosk.session_nonce, kiosk.sessionNonce)) return json({ error: "Sessao do totem revogada. Vincule o totem novamente." }, 401);
  if (configuredKiosk.mode === "sector") return json({ error: "Este totem permite apenas uma senha por vez." }, 400);
  const kioskRate = await consumeSecurityRateLimit("kiosk:issue", kiosk.kioskId, 12, 60);
  if (kioskRate !== true) return json({ error: kioskRate === false ? "Limite de emissao atingido. Aguarde um minuto." : "Emissao temporariamente indisponivel." }, kioskRate === false ? 429 : 503);
  const priority = normalizePriority(body);
  const result = await rpc("issue_physical_ticket_bundle", {
    p_kiosk_id: kiosk.kioskId,
    p_sector_ids: input.sectorIds,
    p_idempotency_key: input.idempotencyKey,
    p_install_url: KIOSK_CONFIGURATION.installUrl,
    p_app_url: KIOSK_CONFIGURATION.appUrl,
    p_priority: priority.enabled,
    p_priority_reason: priority.reason,
    p_auto_call_delay_seconds: AUTO_CALL_DELAY_SECONDS
  });
  if (!result || result.error || !result.ticket) {
    return json({ error: "Nao foi possivel emitir as senhas fisicas agora." }, 400);
  }
  const tickets = await Promise.all((Array.isArray(result.tickets) ? result.tickets : [result.ticket]).map((ticket) => safeTicketDto(ticket)));
  for (const ticket of tickets) {
    await registerEvent("senha_fisica_emitida", "ticket", ticket.id, null, ticket.sector_id, {
      code: ticket.code,
      kioskId: kiosk.kioskId,
      printJobId: result.printJob?.id,
      bundle: true
    });
  }
  return json({
    ticket: tickets[0],
    tickets,
    printJob: printJobDto(result.printJob),
    alreadyExists: Boolean(result.alreadyExists)
  }, 201);
}

async function ticketTrackingRoute(request, token) {
  const rows = await select("tickets", `tracking_token=eq.${encodeURIComponent(token)}&limit=1`);
  const row = rows[0];
  if (!row) return json({ error: "Senha nao encontrada." }, 404);
  const createdAt = new Date(row.created_at).getTime();
  if (!Number.isFinite(createdAt) || Date.now() - createdAt > TRACKING_TOKEN_TTL_MS) {
    return json({ error: "Este QR Code expirou." }, 404);
  }
  const trackedRows = await trackedTicketRows(row);
  const tickets = await Promise.all(trackedRows.map((ticket) => safeTicketDto(ticket)));
  return json({ ticket: publicTicketView(tickets[0]), tickets: tickets.map(publicTicketView) });
}

async function trackedTicketRows(row) {
  const jobs = await select("print_jobs", `ticket_id=eq.${encodeURIComponent(row.id)}&order=created_at.desc&limit=1`);
  const payload = parsePayload(jobs[0]?.payload);
  const ticketIds = Array.isArray(payload.ticketIds) && payload.ticketIds.length
    ? payload.ticketIds.filter((ticketId) => /^[A-Za-z0-9_-]{8,120}$/.test(String(ticketId)))
    : [row.id];
  if (ticketIds.length === 1 && ticketIds[0] === row.id) return [row];
  const rows = await select("tickets", `id=in.(${ticketIds.map(encodeURIComponent).join(",")})`);
  const byId = new Map(rows.map((ticket) => [ticket.id, ticket]));
  return ticketIds.map((ticketId) => byId.get(ticketId)).filter(Boolean).length
    ? ticketIds.map((ticketId) => byId.get(ticketId)).filter(Boolean)
    : [row];
}

function parsePayload(payload) {
  if (!payload) return {};
  if (typeof payload === "object") return payload;
  try {
    return JSON.parse(payload);
  } catch {
    return {};
  }
}

function publicTicketView(ticket) {
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
    progress: ticket.progress,
    calledAt: ticket.calledAt,
    finishedAt: ticket.finishedAt,
    createdAt: ticket.createdAt
  };
}

async function kioskPrintJobRoute(request, jobId) {
  const kiosk = verifyKioskSession(getCookie(request, "senhahub_kiosk"), AUTH_SECRET);
  if (!kiosk) return json({ error: "Totem nao vinculado." }, 401);
  const configuredKiosk = (await select("print_kiosks", `id=eq.${encodeURIComponent(kiosk.kioskId)}&session_nonce=eq.${encodeURIComponent(kiosk.sessionNonce)}&active=eq.true&limit=1`))[0];
  if (!configuredKiosk) return json({ error: "Sessao do totem revogada." }, 401);
  const row = (await select(
    "print_jobs",
    `id=eq.${encodeURIComponent(jobId)}&kiosk_id=eq.${encodeURIComponent(kiosk.kioskId)}&limit=1`
  ))[0];
  if (!row) return json({ error: "Trabalho de impressao nao encontrado." }, 404);
  return json({ job: printJobDto(row) });
}

async function claimPrintJobRoute(request) {
  const agent = verifyPrintAgentRequest(request.headers);
  if (agent.error) return json({ error: agent.error }, agent.status);
  const body = await readJson(request);
  const kioskId = cleanId(body.kioskId) || KIOSK_CONFIGURATION.id;
  if (kioskId !== agent.kioskId) return json({ error: "Agente nao autorizado para este totem." }, 403);
  const row = await rpc("claim_next_print_job", { p_kiosk_id: kioskId });
  if (row?.error) return json({ error: "Nao foi possivel consultar a fila de impressao." }, 500);
  if (row?.id) await recordPrintAttemptStart(row, kioskId);
  return json({ job: printJobDto(row) });
}

async function finishPrintJobRoute(request, jobId) {
  const agent = verifyPrintAgentRequest(request.headers);
  if (agent.error) return json({ error: agent.error }, agent.status);
  const body = await readJson(request);
  const kioskId = cleanId(body.kioskId) || KIOSK_CONFIGURATION.id;
  if (kioskId !== agent.kioskId) return json({ error: "Agente nao autorizado para este totem." }, 403);
  const row = await rpc("finish_print_job", {
    p_job_id: jobId,
    p_kiosk_id: kioskId,
    p_success: body.success === true,
    p_error: cleanLimitedText(body.error, 500) || null
  });
  if (!row || row.error) return json({ error: "Nao foi possivel concluir o trabalho de impressao." }, 400);
  await recordPrintAttemptFinish(jobId, row.status, pErrorOrNull(body.error));
  if (row.status === "failed") {
    await dispatchObservabilityAlert({
      event: "print_job.failed",
      jobId,
      kioskId,
      errorMessage: pErrorOrNull(body.error) || "Falha de impressao."
    });
  }
  return json({ ok: true, job: printJobDto(row) });
}

function pErrorOrNull(value) {
  return cleanLimitedText(value, 500) || null;
}

async function recordPrintAttemptStart(row, kioskId) {
  const now = isoNow();
  try {
    const previous = (await select(
      "print_job_attempts",
      `job_id=eq.${encodeURIComponent(row.id)}&status=eq.printing&order=started_at.desc&limit=20`
    ));
    for (const attempt of previous) {
      await update("print_job_attempts", attempt.id, {
        status: "reprocessed",
        finished_at: now,
        duration_ms: durationMs(attempt.started_at, now),
        error_message: "Tentativa retomada após expirar o tempo de processamento."
      });
    }
    await insert("print_job_attempts", {
      id: crypto.randomUUID(),
      job_id: row.id,
      kiosk_id: kioskId,
      attempt_number: Number(row.attempts || 1),
      started_at: row.claimed_at || now,
      status: "printing",
      created_at: now
    }, false);
  } catch (error) {
    logStructured("warn", "observability.persistence_failed", {
      entity: "print_job_attempt",
      operation: "start",
      jobId: row.id,
      ...errorDetails(error)
    });
  }
}

async function recordPrintAttemptFinish(jobId, status, errorMessage) {
  try {
    const attempt = (await select(
      "print_job_attempts",
      `job_id=eq.${encodeURIComponent(jobId)}&status=eq.printing&order=started_at.desc&limit=1`
    ))[0];
    if (!attempt) return;
    const finishedAt = isoNow();
    await update("print_job_attempts", attempt.id, {
      status: status === "printed" ? "printed" : "failed",
      finished_at: finishedAt,
      duration_ms: durationMs(attempt.started_at, finishedAt),
      error_message: errorMessage || null
    });
  } catch (error) {
    logStructured("warn", "observability.persistence_failed", {
      entity: "print_job_attempt",
      operation: "finish",
      jobId,
      ...errorDetails(error)
    });
  }
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
    appUrl: row.app_url || KIOSK_CONFIGURATION.appUrl,
    lastSeenAt: row.last_seen_at
  };
}

async function pushStatusRoute(request) {
  const user = await requireUser(request, CUSTOMER_ROLES);
  if (user.response) return user.response;
  const [preferences, subscriptions] = await Promise.all([
    getSupabasePushPreferences(user.id),
    select("web_push_subscriptions", `user_id=eq.${encodeURIComponent(user.id)}&enabled=eq.true&order=updated_at.desc`)
  ]);
  return json({
    configured: pushNotificationService.isConfigured(),
    publicKey: pushNotificationService.publicKey(),
    canTest: process.env.NODE_ENV !== "production" || hasAnyRole(user, ADMIN_ROLES),
    preferences,
    devices: subscriptions.map(pushDeviceDto)
  });
}

async function pushSubscribeRoute(request) {
  const user = await requireUser(request, CUSTOMER_ROLES);
  if (user.response) return user.response;
  if (!(await verifyCsrf(request, user))) return json({ error: "Token de seguranca invalido. Recarregue a pagina e tente novamente." }, 403);
  if (!verifyPushRequestOrigin(request)) return json({ error: "Origem da requisicao nao autorizada." }, 403);
  if (!(await consumePushRateLimit(user, request, "subscribe", 10, 60 * 60))) {
    return json({ error: "Muitas tentativas de inscricao. Aguarde e tente novamente." }, 429);
  }
  if (!pushNotificationService.isConfigured()) return json({ error: "As notificacoes ainda nao foram configuradas no servidor." }, 503);

  const body = await readJson(request);
  const subscription = validatePushSubscription(body?.subscription);
  if (subscription.error) return json(subscription, 400);
  const existing = (await select("web_push_subscriptions", `endpoint=eq.${encodeURIComponent(subscription.endpoint)}&limit=1`))[0];
  const now = isoNow();
  const row = await upsert("web_push_subscriptions", {
    id: existing?.id || crypto.randomUUID(),
    user_id: user.id,
    endpoint: subscription.endpoint,
    p256dh: subscription.p256dh,
    auth: subscription.auth,
    user_agent: cleanLimitedText(request.headers.get("user-agent"), 512) || null,
    device_name: cleanLimitedText(body?.device?.deviceName, 120) || "Navegador atual",
    platform: cleanLimitedText(body?.device?.platform, 80) || "unknown",
    enabled: true,
    created_at: existing?.created_at || now,
    updated_at: now,
    last_failure_at: null,
    failure_count: 0,
    revoked_at: null
  }, "endpoint");
  const preferences = await setSupabasePushPreferences(user.id, body?.preferences);
  return json({ ok: true, subscription: pushDeviceDto(row), preferences }, 201);
}

async function pushUnsubscribeRoute(request) {
  const user = await requireUser(request, CUSTOMER_ROLES);
  if (user.response) return user.response;
  if (!(await verifyCsrf(request, user))) return json({ error: "Token de seguranca invalido. Recarregue a pagina e tente novamente." }, 403);
  if (!verifyPushRequestOrigin(request)) return json({ error: "Origem da requisicao nao autorizada." }, 403);
  if (!(await consumePushRateLimit(user, request, "unsubscribe", 20, 60 * 60))) {
    return json({ error: "Muitas tentativas. Aguarde e tente novamente." }, 429);
  }
  const body = await readJson(request);
  const endpoint = String(body?.endpoint || "").trim();
  if (!isAllowedPushEndpoint(endpoint)) return json({ error: "Endpoint de notificacao invalido." }, 400);
  const now = isoNow();
  const result = await supabaseFetch(
    `/rest/v1/web_push_subscriptions?user_id=eq.${encodeURIComponent(user.id)}&endpoint=eq.${encodeURIComponent(endpoint)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: { enabled: false, revoked_at: now, updated_at: now }
    }
  );
  if (result?.error) return json({ error: "Nao foi possivel remover este dispositivo." }, 500);
  return json({ ok: true });
}

async function pushPreferencesRoute(request) {
  const user = await requireUser(request, CUSTOMER_ROLES);
  if (user.response) return user.response;
  if (!(await verifyCsrf(request, user))) return json({ error: "Token de seguranca invalido. Recarregue a pagina e tente novamente." }, 403);
  if (!verifyPushRequestOrigin(request)) return json({ error: "Origem da requisicao nao autorizada." }, 403);
  if (!(await consumePushRateLimit(user, request, "preferences", 30, 60 * 60))) {
    return json({ error: "Muitas alteracoes em pouco tempo. Aguarde e tente novamente." }, 429);
  }
  const body = await readJson(request);
  return json({ ok: true, preferences: await setSupabasePushPreferences(user.id, body?.preferences) });
}

async function pushTestRoute(request) {
  const roles = process.env.NODE_ENV !== "production" ? CUSTOMER_ROLES : ADMIN_ROLES;
  const user = await requireUser(request, roles);
  if (user.response) return user.response;
  if (!(await verifyCsrf(request, user))) return json({ error: "Token de seguranca invalido. Recarregue a pagina e tente novamente." }, 403);
  if (!verifyPushRequestOrigin(request)) return json({ error: "Origem da requisicao nao autorizada." }, 403);
  if (!(await consumePushRateLimit(user, request, "test", 5, 15 * 60))) {
    return json({ error: "Limite de testes atingido. Aguarde antes de tentar novamente." }, 429);
  }
  const delivery = await pushNotificationService.sendBusinessEvent({
    type: "push_test",
    eventKey: `push-test:${user.id}:${crypto.randomUUID()}`,
    userId: user.id,
    payloadVersion: 1,
    context: { customerName: user.name, url: "/?view=account" }
  });
  return json({ ok: delivery.status !== "failed", delivery }, delivery.status === "failed" ? 502 : 200);
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
  const requestedDate = metricsDateFromQuery(new URL(request.url).searchParams.get("date"));
  if (metricsCache?.date === requestedDate && metricsCache.expiresAt > Date.now()) return json(metricsCache.value);
  const value = await getMetrics(requestedDate);
  metricsCache = { date: requestedDate, value, expiresAt: Date.now() + METRICS_CACHE_TTL_MS };
  return json(value);
}

async function offerInsights(request, url) {
  const user = await requireUser(request, ADMIN_ROLES);
  if (user.response) return user.response;
  const days = Math.max(1, Math.min(90, Number(url.searchParams.get("days") || 30)));
  const cacheKey = String(days);
  if (offerInsightsCache?.key === cacheKey && offerInsightsCache.expiresAt > Date.now()) return json(offerInsightsCache.value);
  const value = await getOfferInsights(days);
  offerInsightsCache = { key: cacheKey, value, expiresAt: Date.now() + OFFER_INSIGHTS_CACHE_TTL_MS };
  return json(value);
}

async function createTicketRoute(request) {
  const user = await requireUser(request, CUSTOMER_ROLES);
  if (user.response) return user.response;
  if (!(await verifyCsrf(request, user))) return json({ error: "Token de seguranca invalido. Recarregue a pagina e tente novamente." }, 403);
  const result = await createTicket({ ...(await readJson(request)), customerId: user.customerId, customerName: user.name });
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

async function shoppingAgent(request) {
  const user = await requireUser(request, CUSTOMER_ROLES);
  if (user.response) return user.response;
  return json(await getShoppingAgent(user.customerId));
}

async function shoppingSignal(request) {
  const user = await requireUser(request, CUSTOMER_ROLES);
  if (user.response) return user.response;
  if (!(await verifyCsrf(request, user))) return json({ error: "Token de seguranca invalido. Recarregue a pagina e tente novamente." }, 403);
  const result = await createShoppingSignal(user.customerId, await readJson(request));
  return json(result, result.error ? 400 : 201);
}

async function addCartItemRoute(request) {
  const user = await requireUser(request, CUSTOMER_ROLES);
  if (user.response) return user.response;
  if (!(await verifyCsrf(request, user))) return json({ error: "Token de seguranca invalido. Recarregue a pagina e tente novamente." }, 403);
  const result = await addCartItem({ ...(await readJson(request)), customerId: user.customerId });
  return json(result, result.error ? 400 : 201);
}

async function updateCartItemRoute(request, itemId) {
  const user = await requireUser(request, CUSTOMER_ROLES);
  if (user.response) return user.response;
  if (!(await verifyCsrf(request, user))) return json({ error: "Token de seguranca invalido. Recarregue a pagina e tente novamente." }, 403);
  const result = await updateCartItemQuantity(itemId, user.customerId, await readJson(request));
  return json(result, result.error ? 400 : 200);
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
  const existing = active.find((ticket) => ticket.sector_id === sector.id);
  if (existing) return { ticket: await safeTicketDto(existing), alreadyExists: true };
  if (active.length >= MAX_ACTIVE_TICKETS_PER_CUSTOMER) return fail(`Limite de ${MAX_ACTIVE_TICKETS_PER_CUSTOMER} senhas ativas por cliente atingido.`);
  const presence = validatePresence(body, sector.id);
  if (!presence.ok) return fail(presence.error);
  const priority = normalizePriority(body);
  const row = await rpc("issue_verified_ticket", {
    p_customer_id: session.customerId,
    p_device_id: session.deviceId,
    p_sector_id: sector.id,
    p_priority: priority.enabled,
    p_priority_reason: priority.reason,
    p_qr_verified: presence.qrVerified,
    p_location_verified: presence.locationVerified,
    p_location_lat: presence.location?.latitude ?? null,
    p_location_lng: presence.location?.longitude ?? null,
    p_location_accuracy: presence.location?.accuracy ?? null,
    p_location_distance_meters: presence.distanceMeters,
    p_auto_call_delay_seconds: AUTO_CALL_DELAY_SECONDS,
    p_max_active_tickets: MAX_ACTIVE_TICKETS_PER_CUSTOMER
  });
  if (!row || row.error) return fail("Nao foi possivel emitir a senha agora.");
  await registerEvent("senha_emitida", "ticket", row.id, row.customer_id, row.sector_id, {
    code: row.code,
    priority,
    presence: {
      qrVerified: presence.qrVerified,
      locationVerified: presence.locationVerified,
      distanceMeters: presence.distanceMeters
    }
  });
  await notifyQueueMilestones(row.sector_id);
  return { ticket: await safeTicketDto(row), alreadyExists: false };
}

async function dispatchTicketPush(ticket, type, version, extraContext = {}) {
  if (!ticket?.id || !ticket.customer_id) return;
  try {
    const sector = await getSector(ticket.sector_id);
    if (!sector) return;
    await pushNotificationService.sendBusinessEvent({
      type,
      eventKey: `${ticket.id}:${type}:${version}:v1`,
      userId: ticket.customer_id,
      ticketId: ticket.id,
      payloadVersion: 1,
      context: {
        customerName: ticket.customer_name || "Cliente",
        sector: sector.name,
        counterLabel: sector.counter_label,
        ...extraContext
      }
    });
  } catch (error) {
    console.error("push_business_event_failed", { eventType: type, message: error.message });
  }
}

async function notifyQueueMilestones(sectorId) {
  const rows = await select(
    "tickets",
    `sector_id=eq.${encodeURIComponent(sectorId)}&status=in.(${CALL_ELIGIBLE_STATUSES.join(",")})&order=priority.desc,queue_order.asc`
  );
  const notifications = [];
  for (const ticket of rows.filter((row) => ["aguardando", "proximo"].includes(row.status))) {
    const ahead = countAheadInRows(ticket, rows);
    if (ahead === 2) notifications.push(dispatchTicketPush(ticket, "queue_near", "ahead-2", { ahead }));
    if (ahead === 0) notifications.push(dispatchTicketPush(ticket, "queue_next", "position-1", { ahead }));
  }
  await Promise.all(notifications);
}

async function notifyStandbyExpiringTickets() {
  if (!pushNotificationService.isConfigured()) return;
  const now = isoNow();
  const warningAt = new Date(Date.now() + STANDBY_WARNING_SECONDS * 1000).toISOString();
  const tickets = await select(
    "tickets",
    `status=eq.standby&standby_expires_at=not.is.null&standby_expires_at=gt.${encodeURIComponent(now)}&standby_expires_at=lte.${encodeURIComponent(warningAt)}`
  );
  for (const ticket of tickets) {
    await dispatchTicketPush(ticket, "queue_standby_expiring", `absence-${Number(ticket.absence_count || 0)}`);
  }
}

async function callNextTicket(sectorId, options = {}) {
  const called = await rpc("call_next_ticket", {
    p_sector_id: sectorId,
    p_require_eligible: Boolean(options.requireEligible),
    p_prefer_standby: Boolean(options.preferStandby)
  });
  if (called.error) return fail("Finalize a senha atual antes de chamar a proxima.");
  if (called?.id) {
    const pushType = Number(called.absence_count || 0) > 0 ? "queue_recalled" : "queue_called";
    const ticket = safeTicketDto(called);
    await Promise.all([
      registerEvent("senha_chamada", "ticket", called.id, called.customer_id, called.sector_id, { code: called.code }),
      dispatchTicketPush(called, pushType, `absence-${Number(called.absence_count || 0)}`),
      notifyQueueMilestones(sectorId)
    ]);
    return { ticket: await ticket };
  }
  return { ticket: null, message: "Nenhuma senha elegivel para chamada." };
}

async function confirmTicket(ticketId) {
  const updated = await rpc("confirm_ticket", { p_ticket_id: ticketId });
  if (!updated || updated.error) return fail("A senha nao esta mais disponivel para iniciar atendimento. Atualize a fila.");
  await registerEvent("atendimento_iniciado", "ticket", updated.id, updated.customer_id, updated.sector_id, { code: updated.code });
  return { ticket: await safeTicketDto(updated) };
}

async function finishTicket(ticketId) {
  const finished = await rpc("finish_ticket", { p_ticket_id: ticketId });
  if (!finished || finished.error) return fail("A senha nao esta mais em atendimento. Atualize a fila.");
  await registerEvent("pedido_finalizado", "ticket", finished.id, finished.customer_id, finished.sector_id, { code: finished.code });
  const released = await releaseSmartWaitTicket(finished.customer_id);
  const nextInSector = await callNextTicket(finished.sector_id, { preferStandby: true });
  await notifyQueueMilestones(finished.sector_id);
  return {
    finishedTicket: await safeTicketDto(finished),
    releasedTicket: released ? await safeTicketDto(released) : null,
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
  const skipped = await updateTicketIfStatus(ticket.id, [ticket.status], patch);
  if (!skipped) return fail("A senha foi alterada por outra operacao. Atualize a fila.");
  await insert("calls", { ticket_id: ticket.id, sector_id: ticket.sector_id, action: `senha_pulada:${reason}`, created_at: now });
  await registerEvent("senha_pulada_pelo_atendente", "ticket", ticket.id, ticket.customer_id, ticket.sector_id, { code: ticket.code, previousStatus: ticket.status, reason });
  if (reason === "cliente_ausente") {
    await dispatchTicketPush(skipped, "queue_standby", `absence-${absenceCount}`);
  } else {
    await dispatchTicketPush(skipped, "queue_changed", `skipped-${reason}`);
  }
  const released = CALL_BLOCKING_STATUSES.includes(ticket.status) ? await releaseSmartWaitTicket(ticket.customer_id) : null;
  const nextInSector = CALL_BLOCKING_STATUSES.includes(ticket.status) ? await callNextTicket(ticket.sector_id) : null;
  await notifyQueueMilestones(ticket.sector_id);
  return { skippedTicket: await safeTicketDto(skipped), releasedTicket: released ? await safeTicketDto(released) : null, nextTicket: nextInSector?.ticket || null };
}

async function cancelTicket(ticketId, customerId) {
  const ticket = await getTicket(ticketId);
  if (!ticket || ticket.customer_id !== customerId) return fail("Senha nao encontrada.");
  if (!CUSTOMER_CANCELABLE_STATUSES.includes(ticket.status)) return fail("Esta senha nao pode mais ser cancelada pelo cliente.");
  const now = isoNow();
  const canceled = await updateTicketIfStatus(ticket.id, [ticket.status], {
    status: "cancelado",
    canceled_at: now,
    called_at: null,
    smart_wait_reason: null,
    blocked_by_ticket_id: null,
    smart_wait_since: null,
    updated_at: now
  });
  if (!canceled) return fail("A senha foi alterada por outra operacao. Atualize a fila.");
  await registerEvent("senha_cancelada_pelo_cliente", "ticket", ticket.id, ticket.customer_id, ticket.sector_id, { code: ticket.code, previousStatus: ticket.status });
  const released = CALL_BLOCKING_STATUSES.includes(ticket.status) ? await releaseSmartWaitTicket(ticket.customer_id) : null;
  await notifyQueueMilestones(ticket.sector_id);
  return { canceledTicket: await safeTicketDto(canceled), releasedTicket: released ? await safeTicketDto(released) : null };
}

async function releaseSmartWaitTicket(customerId) {
  if (!customerId) return null;
  const rows = await select("tickets", `customer_id=eq.${encodeURIComponent(customerId)}&status=eq.espera_inteligente&order=smart_wait_since.asc,created_at.asc&limit=1`);
  const next = rows[0];
  if (!next) return null;
  const now = isoNow();
  const updated = await updateTicketIfStatus(next.id, ["espera_inteligente"], {
    status: "aguardando",
    called_at: null,
    eligible_at: now,
    smart_wait_reason: null,
    blocked_by_ticket_id: null,
    smart_wait_since: null,
    updated_at: now
  });
  if (!updated) return null;
  await registerEvent("espera_inteligente_liberada", "ticket", next.id, next.customer_id, next.sector_id, { code: next.code });
  await dispatchTicketPush(updated, "queue_changed", "smart-wait-released");
  await callNextTicket(next.sector_id, { preferStandby: true });
  await notifyQueueMilestones(next.sector_id);
  return getTicket(next.id);
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
  const [sectorRows, tickets, profile] = await Promise.all([
    getSectors(),
    customerId
      ? select("tickets", `customer_id=eq.${encodeURIComponent(customerId)}&status=in.(${ACTIVE_STATUSES.join(",")})&order=created_at.asc`)
      : [],
    customerId ? getProfile(customerId).catch(() => null) : null
  ]);
  const sectors = await customerSectorDtos(sectorRows);
  return { serverTime: isoNow(), sectors, tickets: await mapAsync(hydrateTicketNames(tickets, new Map(profile ? [[profile.id, profile.name]] : [])), ticketDto) };
}

async function getStaffState(user) {
  const sectors = (await getSectors()).filter((sector) => canAccessSectorSync(user, sector.id));
  if (!sectors.length) return { serverTime: isoNow(), sectors: [] };

  const sectorIds = sectors.map((sector) => sector.id);
  const encodedSectorIds = sectorIds.map(encodeURIComponent).join(",");
  const [tickets, counters, recentStats, recentCallsBySector] = await Promise.all([
    select("tickets", `sector_id=in.(${encodedSectorIds})&status=in.(${ACTIVE_STATUSES.join(",")})&order=priority.desc,queue_order.asc`),
    select("ticket_counters", `sector_id=in.(${encodedSectorIds})`),
    staffAverageStats(sectorIds),
    staffRecentCalls(sectorIds)
  ]);
  const profilesById = await profilesByTicketCustomer(tickets);
  const namedTickets = hydrateTicketNames(tickets, profilesById);
  const ticketsBySector = groupBy(namedTickets, "sector_id");
  const countersBySector = new Map(counters.map((counter) => [counter.sector_id, counter]));
  const data = sectors.map((sector) => {
    const sectorTickets = ticketsBySector.get(sector.id) || [];
    const stats = recentStats.get(sector.id) || { seconds: sector.average_service_seconds, samples: 0 };
    const active = sectorTickets.find((ticket) => CALL_BLOCKING_STATUSES.includes(ticket.status));
    const current = active?.code || currentCodeFromCounter(sector, countersBySector.get(sector.id));
    const currentCustomerName = active ? ticketName(active) : "";
    const activeDelay = active ? activeServiceDelayFromTicket(active, stats.seconds) : 0;
    return {
      ...sectorDtoFromStats(sector, stats, current, currentCustomerName),
      tickets: sectorTickets.map((ticket) => staffTicketDto(ticket, sector, stats, current, sectorTickets, activeDelay)),
      recentCalls: recentCallsBySector.get(sector.id) || []
    };
  });
  return { serverTime: isoNow(), sectors: data };
}

async function getCustomerHistory(customerId) {
  const tickets = await select("tickets", `customer_id=eq.${encodeURIComponent(customerId)}&status=not.in.(${ACTIVE_STATUSES.join(",")})&order=updated_at.desc&limit=30`);
  const ratings = await select("ratings", `customer_id=eq.${encodeURIComponent(customerId)}&order=created_at.desc&limit=30`);
  return { tickets: await mapAsync(tickets, ticketDto), ratings };
}

async function getMetrics(metricsDate = businessDateFor()) {
  const { start, end } = businessDayBounds(metricsDate);
  const encodedStart = encodeURIComponent(start);
  const encodedEnd = encodeURIComponent(end);
  const sectors = await mapAsync(await getSectors(), async (sector) => {
    const sectorFilter = `sector_id=eq.${encodeURIComponent(sector.id)}`;
    const issued = await count("tickets", `${sectorFilter}&created_at=gte.${encodedStart}&created_at=lt.${encodedEnd}`);
    const finished = await count("tickets", `${sectorFilter}&status=eq.atendido&finished_at=gte.${encodedStart}&finished_at=lt.${encodedEnd}`);
    const [expired, canceled] = await Promise.all([
      count("tickets", `${sectorFilter}&status=eq.expirado&expired_at=gte.${encodedStart}&expired_at=lt.${encodedEnd}`),
      count("tickets", `${sectorFilter}&status=eq.cancelado&canceled_at=gte.${encodedStart}&canceled_at=lt.${encodedEnd}`)
    ]);
    const abandoned = expired + canceled;
    const smartWaitRows = await select("tickets", `${sectorFilter}&smart_wait_since=not.is.null&called_at=gte.${encodedStart}&called_at=lt.${encodedEnd}&select=smart_wait_since,called_at`);
    const serviceRows = await select("tickets", `${sectorFilter}&service_started_at=not.is.null&finished_at=gte.${encodedStart}&finished_at=lt.${encodedEnd}&select=service_started_at,finished_at`);
    return {
      id: sector.id,
      name: sector.name,
      issued,
      finished,
      abandoned,
      avgServiceSeconds: average(serviceRows.map((row) => secondsBetween(row.service_started_at, row.finished_at))),
      avgSmartWaitSeconds: average(smartWaitRows.map((row) => secondsBetween(row.smart_wait_since, row.called_at || isoNow())))
    };
  });
  return {
    date: metricsDate,
    sectors,
    satisfaction: satisfactionSummary(await select("ratings", `created_at=gte.${encodedStart}&created_at=lt.${encodedEnd}&select=score`)),
    generatedAt: isoNow()
  };
}

async function getOfferInsights(days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const cartRows = await select("cart_items", `created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=1000`);
  const customerIds = [...new Set(cartRows.map((row) => row.customer_id).filter(Boolean))];
  const [sectors, ticketRows] = await Promise.all([
    getSectors(),
    customerIds.length
      ? select("tickets", `customer_id=in.(${customerIds.map(encodeURIComponent).join(",")})&created_at=gte.${encodeURIComponent(since)}&select=customer_id,sector_id,created_at&limit=2000`)
      : []
  ]);
  const sectorNames = new Map(sectors.map((sector) => [sector.id, sector.name]));
  const ticketsByCustomer = groupBy(ticketRows, "customer_id");
  const rows = cartRows.map((row) => {
    const nearest = nearestTicket(row, ticketsByCustomer.get(row.customer_id) || []);
    return {
      ...row,
      visit_sector_id: nearest?.sector_id || null,
      visit_sector_name: nearest ? sectorNames.get(nearest.sector_id) : null
    };
  });
  return buildOfferInsights(rows, { days });
}

function nearestTicket(cartItem, tickets) {
  const itemTime = new Date(cartItem.created_at).getTime();
  if (!Number.isFinite(itemTime)) return null;
  return tickets
    .map((ticket) => ({ ticket, distance: Math.abs(new Date(ticket.created_at).getTime() - itemTime) }))
    .filter((entry) => Number.isFinite(entry.distance) && entry.distance <= 6 * 60 * 60 * 1000)
    .sort((left, right) => left.distance - right.distance)[0]?.ticket || null;
}

function buildOfferInsights(rows, options = {}) {
  const events = rows.map(offerEvent).filter(Boolean);
  const productRanking = rankOfferGroups(events, (event) => event.productId, productSummary).slice(0, 8);
  const sectorPatterns = rankOfferGroups(events, (event) => event.visitSectorId || slugifyLabel(event.productSector), sectorSummary).slice(0, 6);
  const timePatterns = rankOfferGroups(events, (event) => `${event.dayName}|${event.hourBucket}|${event.visitSectorId || slugifyLabel(event.productSector)}`, timeSummary).slice(0, 8);
  const clusters = buildOfferClusters(events);
  return {
    periodDays: options.days || 30,
    totalSelections: events.reduce((sum, event) => sum + event.quantity, 0),
    totalCustomers: new Set(events.map((event) => event.customerId)).size,
    generatedAt: isoNow(),
    productRanking,
    sectorPatterns,
    timePatterns,
    clusters,
    suggestions: buildOfferSuggestions(clusters, productRanking, timePatterns),
    confidence: insightConfidence(events.length)
  };
}

function offerEvent(row) {
  const createdAt = new Date(row.created_at);
  if (Number.isNaN(createdAt.getTime())) return null;
  const hour = Number(createdAt.toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: BUSINESS_TIME_ZONE }));
  return {
    customerId: row.customer_id,
    productId: row.product_id,
    productName: row.product_name,
    productSector: row.sector_name || "Oferta",
    visitSectorId: row.visit_sector_id || null,
    visitSectorName: row.visit_sector_name || null,
    price: row.price || "",
    quantity: Number(row.quantity || 1),
    createdAt: row.created_at,
    hour,
    hourBucket: hourBucketFor(hour),
    dayName: weekdayName(createdAt),
    dayKey: weekdayKey(createdAt)
  };
}

function rankOfferGroups(events, keyFn, summaryFn) {
  const groups = new Map();
  events.forEach((event) => {
    const key = keyFn(event);
    if (!key) return;
    const group = groups.get(key) || { key, events: [], quantity: 0, customers: new Set() };
    group.events.push(event);
    group.quantity += event.quantity;
    group.customers.add(event.customerId);
    groups.set(key, group);
  });
  return [...groups.values()]
    .map((group) => summaryFn(group))
    .sort((left, right) => right.quantity - left.quantity || right.customers - left.customers);
}

function productSummary(group) {
  const first = group.events[0];
  return {
    productId: first.productId,
    productName: first.productName,
    sectorName: first.productSector,
    quantity: group.quantity,
    customers: group.customers.size,
    shareLabel: `${group.quantity} selecoes`
  };
}

function sectorSummary(group) {
  const first = group.events[0];
  return {
    sectorId: first.visitSectorId || slugifyLabel(first.productSector),
    sectorName: sectorNameForEvent(first),
    quantity: group.quantity,
    customers: group.customers.size,
    topProducts: topProducts(group.events, 4)
  };
}

function timeSummary(group) {
  const first = group.events[0];
  return {
    label: `${first.dayName}, ${first.hourBucket} em ${sectorNameForEvent(first)}`,
    dayName: first.dayName,
    hourBucket: first.hourBucket,
    sectorName: sectorNameForEvent(first),
    quantity: group.quantity,
    customers: group.customers.size,
    topProducts: topProducts(group.events, 5)
  };
}

function buildOfferClusters(events) {
  const definitions = [
    {
      id: "churrasco-sexta",
      name: "Churrasco de sexta",
      matches: (event) => event.dayKey === 5 && event.hour >= 16 && event.hour <= 19 && matchesSector(event, "acougue")
    },
    {
      id: "padaria-manha",
      name: "Padaria de manha",
      matches: (event) => event.hour >= 6 && event.hour < 11 && matchesSector(event, "padaria")
    },
    {
      id: "frios-lanche",
      name: "Lanche rapido de frios",
      matches: (event) => matchesSector(event, "frios") || /queijo|presunto|requeij|pao|pão/i.test(event.productName)
    },
    {
      id: "compra-complementar",
      name: "Compra complementar",
      matches: () => true
    }
  ];
  const buckets = new Map(definitions.map((definition) => [definition.id, { ...definition, events: [] }]));
  events.forEach((event) => {
    const definition = definitions.find((candidate) => candidate.matches(event));
    buckets.get(definition.id).events.push(event);
  });
  return [...buckets.values()]
    .filter((cluster) => cluster.events.length)
    .map(clusterSummary)
    .sort((left, right) => right.quantity - left.quantity)
    .slice(0, 6);
}

function clusterSummary(cluster) {
  const quantity = cluster.events.reduce((sum, event) => sum + event.quantity, 0);
  const customers = new Set(cluster.events.map((event) => event.customerId)).size;
  const top = topProducts(cluster.events, 6);
  const dominantTime = rankOfferGroups(cluster.events, (event) => event.hourBucket, (group) => ({ label: group.key, quantity: group.quantity, customers: group.customers.size }))[0]?.label || "Horario variado";
  const dominantSector = rankOfferGroups(cluster.events, (event) => event.visitSectorId || slugifyLabel(event.productSector), sectorSummary)[0]?.sectorName || "Setores variados";
  return {
    id: cluster.id,
    name: cluster.name,
    quantity,
    customers,
    dominantTime,
    dominantSector,
    topProducts: top,
    confidence: insightConfidence(cluster.events.length),
    recommendation: recommendationForCluster(cluster.name, dominantSector, dominantTime, top)
  };
}

function buildOfferSuggestions(clusters, products, timePatterns) {
  const suggestions = clusters.slice(0, 3).map((cluster) => cluster.recommendation);
  const topProduct = products[0];
  if (topProduct) suggestions.push(`Dar destaque para ${topProduct.productName} nas ofertas: foi o item mais selecionado no periodo.`);
  const topTime = timePatterns[0];
  if (topTime) suggestions.push(`Criar vitrine contextual para ${topTime.label.toLowerCase()} com ${topTime.topProducts.map((item) => item.productName).join(", ")}.`);
  return [...new Set(suggestions)].slice(0, 5);
}

function topProducts(events, limit = 5) {
  return rankOfferGroups(events, (event) => event.productId, productSummary).slice(0, limit);
}

function recommendationForCluster(name, sector, time, products) {
  const productNames = products.slice(0, 3).map((item) => item.productName).join(", ");
  return `Para ${name.toLowerCase()}, montar oferta em ${sector} no periodo ${time} com ${productNames || "produtos relacionados"}.`;
}

function matchesSector(event, sectorId) {
  const sector = `${event.visitSectorId || ""} ${event.visitSectorName || ""} ${event.productSector || ""}`.toLowerCase();
  return sector.includes(sectorId) || (sectorId === "acougue" && sector.includes("açougue"));
}

function sectorNameForEvent(event) {
  return event.visitSectorName || event.productSector || "Oferta";
}

function hourBucketFor(hour) {
  if (hour >= 6 && hour < 11) return "manha";
  if (hour >= 11 && hour < 14) return "almoco";
  if (hour >= 14 && hour < 18) return "tarde";
  if (hour >= 18 && hour < 22) return "noite";
  return "madrugada";
}

function weekdayName(date) {
  return ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"][weekdayKey(date)];
}

function weekdayKey(date) {
  return new Date(date.toLocaleString("en-US", { timeZone: BUSINESS_TIME_ZONE })).getDay();
}

function slugifyLabel(value) {
  return String(value || "oferta").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "oferta";
}

function insightConfidence(sampleSize) {
  if (sampleSize >= 40) return "alta";
  if (sampleSize >= 12) return "media";
  return "baixa";
}

async function customerSectorDtos(sectors) {
  if (!sectors.length) return [];
  const sectorIds = sectors.map((sector) => sector.id);
  const [counters, recentStats] = await Promise.all([
    select("ticket_counters", `sector_id=in.(${sectorIds.map(encodeURIComponent).join(",")})`),
    staffAverageStats(sectorIds)
  ]);
  const countersBySector = new Map(counters.map((counter) => [counter.sector_id, counter]));
  return sectors.map((sector) => {
    const stats = recentStats.get(sector.id) || { seconds: sector.average_service_seconds, samples: 0 };
    return sectorDtoFromStats(sector, stats, currentCodeFromCounter(sector, countersBySector.get(sector.id)));
  });
}

async function kioskSectorDtos(sectors) {
  const [sectorDtos, queueCounts] = await Promise.all([
    customerSectorDtos(sectors),
    Promise.all(sectors.map(async (sector) => [
      sector.id,
      await count(
        "tickets",
        `sector_id=eq.${encodeURIComponent(sector.id)}&status=in.(${QUEUE_WAITING_STATUSES.join(",")})`
      )
    ]))
  ]);
  const countsBySector = new Map(queueCounts);
  return sectorDtos.map((sector) => ({
    ...sector,
    queueSize: countsBySector.get(sector.id) || 0
  }));
}

async function staffAverageStats(sectorIds) {
  const uniqueSectorIds = [...new Set(sectorIds.filter(Boolean))];
  const map = new Map(uniqueSectorIds.map((sectorId) => [sectorId, { seconds: 0, samples: 0 }]));
  if (!uniqueSectorIds.length) return map;
  const rows = await select(
    "tickets",
    `sector_id=in.(${uniqueSectorIds.map(encodeURIComponent).join(",")})&service_started_at=not.is.null&finished_at=not.is.null&select=sector_id,service_started_at,finished_at&order=finished_at.desc&limit=${uniqueSectorIds.length * 20}`
  );
  const grouped = groupBy(rows, "sector_id");
  uniqueSectorIds.forEach((sectorId) => {
    const durations = (grouped.get(sectorId) || [])
      .slice(0, 20)
      .map((row) => secondsBetween(row.service_started_at, row.finished_at))
      .filter((seconds) => Number.isFinite(seconds) && seconds > 0);
    map.set(sectorId, { seconds: average(durations), samples: durations.length });
  });
  return map;
}

async function staffRecentCalls(sectorIds) {
  const map = new Map(sectorIds.map((sectorId) => [sectorId, []]));
  const callsBySector = await Promise.all(sectorIds.map(async (sectorId) => {
    const calls = await select("calls", `sector_id=eq.${encodeURIComponent(sectorId)}&select=action,created_at,ticket_id&order=created_at.desc&limit=6`);
    return [sectorId, calls];
  }));
  const ticketIds = [...new Set(callsBySector.flatMap(([, calls]) => calls.map((call) => call.ticket_id).filter(Boolean)))];
  const tickets = ticketIds.length
    ? await select("tickets", `id=in.(${ticketIds.map(encodeURIComponent).join(",")})`)
    : [];
  const namedTickets = hydrateTicketNames(tickets, await profilesByTicketCustomer(tickets));
  const ticketsById = new Map(namedTickets.map((ticket) => [ticket.id, ticket]));
  callsBySector.forEach(([sectorId, calls]) => {
    map.set(sectorId, calls.map((call) => {
      const ticket = ticketsById.get(call.ticket_id);
      return {
        action: call.action,
        customerName: ticketName(ticket),
        ticketNumber: ticket?.number,
        ticket: ticket?.code || "--",
        status: ticket?.status || "",
        priority: Boolean(ticket?.priority),
        createdAt: call.created_at
      };
    }));
  });
  return map;
}

async function profilesByTicketCustomer(tickets) {
  const ids = [...new Set(tickets.map((ticket) => ticket.customer_id).filter(Boolean))];
  if (!ids.length) return new Map();
  const profiles = await select("profiles", `id=in.(${ids.map(encodeURIComponent).join(",")})&select=id,name`);
  return new Map(profiles.map((profile) => [profile.id, profile.name]));
}

function hydrateTicketNames(tickets, profilesById) {
  return tickets.map((ticket) => ({
    ...ticket,
    customer_name: ticketName(ticket, profilesById.get(ticket.customer_id))
  }));
}

function ticketName(ticket, fallback = "") {
  const name = String(ticket?.customer_name || fallback || "").trim();
  return name || "Cliente";
}

async function customerNameForTicket(ticket) {
  if (!ticket) return "Cliente";
  if (String(ticket.customer_name || "").trim()) return ticketName(ticket);
  const profile = ticket.customer_id ? await getProfile(ticket.customer_id).catch(() => null) : null;
  return profile?.name || "Cliente";
}

function sectorDtoFromStats(row, stats, current, currentCustomerName = "") {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    counterLabel: row.counter_label,
    serviceLabel: row.service_label,
    queueSize: row.queue_size,
    averageServiceSeconds: stats.seconds || row.average_service_seconds,
    averageServiceSamples: stats.samples || 0,
    estimateBasedOnRecentServices: Number(stats.samples || 0) > 0,
    capacity: row.capacity,
    status: row.status,
    current,
    currentCustomerName
  };
}

function staffTicketDto(row, sector, stats, current, sectorTickets, activeDelay) {
  const isWaiting = CALL_ELIGIBLE_STATUSES.includes(row.status);
  const ahead = isWaiting ? countAheadInRows(row, sectorTickets) : 0;
  const position = isWaiting ? ahead + 1 : 1;
  const averageSeconds = stats.seconds || sector.average_service_seconds;
  const eligibleDelay = isWaiting ? secondsUntil(row.eligible_at || row.created_at) : 0;
  const secondsToCall = isWaiting ? Math.max(eligibleDelay, activeDelay + ahead * averageSeconds) : 0;
  const estimatedCallAt = isWaiting ? new Date(Date.now() + secondsToCall * 1000).toISOString() : null;
  return {
    id: row.id,
    customerId: row.customer_id,
    customerName: ticketName(row),
    ticketNumber: row.number,
    deviceId: row.device_id,
    sectorId: row.sector_id,
    sector: sector.name,
    ticket: row.code,
    current,
    counterLabel: sector.counter_label,
    serviceLabel: sector.service_label,
    status: row.status,
    source: row.source || "digital",
    kioskId: row.kiosk_id || null,
    priority: Boolean(row.priority),
    priorityReason: row.priority_reason,
    position,
    ahead,
    secondsToCall,
    averageServiceSeconds: averageSeconds,
    averageServiceSamples: stats.samples || 0,
    estimateBasedOnRecentServices: Number(stats.samples || 0) > 0,
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

function countAheadInRows(ticket, rows) {
  return rows.filter((row) => CALL_ELIGIBLE_STATUSES.includes(row.status) && (
    Number(row.priority || 0) > Number(ticket.priority || 0)
    || (Number(row.priority || 0) === Number(ticket.priority || 0) && Number(row.queue_order) < Number(ticket.queue_order))
  )).length;
}

function activeServiceDelayFromTicket(active, averageSeconds) {
  const startedAt = active.service_started_at || active.called_at || active.updated_at;
  const elapsed = secondsBetween(startedAt, isoNow());
  const limit = active.status === "chamado" ? CALL_ABSENCE_SECONDS : averageSeconds;
  return Math.max(0, limit - elapsed);
}

function currentCodeFromCounter(sector, counter) {
  const currentNumber = counter?.business_date === businessDateFor() ? Number(counter.last_number) : TICKET_MIN_NUMBER;
  return formatTicket(sector.prefix, currentNumber);
}

function groupBy(rows, key) {
  const map = new Map();
  rows.forEach((row) => {
    const value = row[key];
    const group = map.get(value) || [];
    group.push(row);
    map.set(value, group);
  });
  return map;
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

async function updateCartItemQuantity(itemId, customerId, body = {}) {
  const quantity = Math.max(1, Math.min(99, Number.parseInt(body.quantity, 10) || 1));
  const item = (await select("cart_items", `id=eq.${encodeURIComponent(itemId)}&customer_id=eq.${encodeURIComponent(customerId)}&limit=1`))[0];
  if (!item) return fail("Item nao encontrado.");
  const updated = await update("cart_items", item.id, { quantity, updated_at: isoNow() });
  await registerEvent("carrinho_item_quantidade_atualizada", "cart_item", item.id, customerId, null, { productId: item.product_id, quantity });
  return { item: cartItemDto(updated) };
}

async function createShoppingSignal(customerId, body = {}) {
  const signalType = ["search", "view"].includes(body.type) ? body.type : "view";
  const signal = await insert("shopping_signals", {
    customer_id: customerId,
    signal_type: signalType,
    query: String(body.query || "").slice(0, 120),
    product_id: cleanId(body.productId || ""),
    product_name: String(body.productName || "").slice(0, 160),
    sector_name: String(body.sectorName || "").slice(0, 80),
    created_at: isoNow()
  });
  return { ok: true, id: signal.id, createdAt: signal.created_at };
}

async function getShoppingAgent(customerId) {
  const [cartRows, signalRows, ticketRows, sectors] = await Promise.all([
    select("cart_items", `customer_id=eq.${encodeURIComponent(customerId)}&order=updated_at.desc&limit=200`),
    select("shopping_signals", `customer_id=eq.${encodeURIComponent(customerId)}&order=created_at.desc&limit=200`),
    select("tickets", `customer_id=eq.${encodeURIComponent(customerId)}&order=created_at.desc&limit=100`),
    getSectors()
  ]);
  const sectorNames = new Map(sectors.map((sector) => [sector.id, sector.name]));
  return buildShoppingAgentProfile(
    cartRows,
    signalRows,
    ticketRows.map((ticket) => ({ ...ticket, sector_name: sectorNames.get(ticket.sector_id) || ticket.sector_id }))
  );
}

function buildShoppingAgentProfile(cartRows, signalRows, ticketRows) {
  const sectorEvents = [
    ...cartRows.map((row) => ({ sectorName: row.sector_name, createdAt: row.updated_at, weight: Number(row.quantity || 1) * 2 })),
    ...signalRows.filter((row) => row.sector_name).map((row) => ({ sectorName: row.sector_name, createdAt: row.created_at, weight: 1 })),
    ...ticketRows.map((row) => ({ sectorName: row.sector_name || row.sector_id, createdAt: row.created_at, weight: 3 }))
  ];
  const productEvents = [
    ...cartRows.map((row) => ({ productId: row.product_id, productName: row.product_name, sectorName: row.sector_name, quantity: Number(row.quantity || 1) * 2 })),
    ...signalRows.filter((row) => row.product_id).map((row) => ({ productId: row.product_id, productName: row.product_name, sectorName: row.sector_name, quantity: 1 }))
  ];
  return {
    favoriteSectors: rankShoppingSignals(sectorEvents, (event) => event.sectorName, (group) => ({ sectorName: group.key, quantity: group.quantity })).slice(0, 6),
    favoriteProducts: rankShoppingSignals(productEvents, (event) => event.productId, (group) => ({
      productId: group.key,
      productName: group.events[0].productName,
      sectorName: group.events[0].sectorName,
      quantity: group.quantity
    })).slice(0, 10),
    recentSearches: rankShoppingSignals(signalRows.filter((row) => row.signal_type === "search" && row.query), (row) => normalizeSignalText(row.query), (group) => ({ query: group.events[0].query, quantity: group.quantity })).slice(0, 6),
    clusterSuggestions: buildShoppingClusterSuggestions(cartRows, signalRows, ticketRows),
    preferredHourBucket: preferredShoppingHourBucket([...cartRows, ...signalRows, ...ticketRows]),
    generatedAt: isoNow()
  };
}

function buildShoppingClusterSuggestions(cartRows, signalRows, ticketRows) {
  const definitions = [
    {
      id: "acougue-complementar",
      name: "Açougue com complementos",
      triggerSectors: ["acougue"],
      sectors: ["Açougue", "Bebidas", "Padaria", "Mercearia", "Hortifruti"],
      keywords: ["carvao", "carvão", "refrigerante", "suco", "pao", "cebola", "tomate", "batata", "molho", "oleo"],
      reason: "Quando o cliente passa pelo açougue, o cluster busca itens de preparo, bebida e acompanhamento."
    },
    {
      id: "padaria-manha",
      name: "Padaria de manhã",
      triggerSectors: ["padaria"],
      sectors: ["Padaria", "Frios e Laticínios", "Mercearia", "Bebidas", "Hortifruti"],
      keywords: ["cafe", "leite", "pao", "manteiga", "requeijao", "queijo", "presunto", "suco", "banana", "iogurte"],
      reason: "Perfil de café da manhã com produtos que combinam com padaria e reposição diária."
    },
    {
      id: "frios-lanche",
      name: "Frios para lanche",
      triggerSectors: ["frios"],
      sectors: ["Frios e Laticínios", "Padaria", "Mercearia", "Bebidas"],
      keywords: ["queijo", "presunto", "requeijao", "pao", "baguete", "manteiga", "cafe", "suco", "molho", "macarrao"],
      reason: "Cluster voltado a lanches rápidos, frios fatiados e complementos próximos."
    },
    {
      id: "reposicao-recorrente",
      name: "Reposição recorrente",
      triggerSectors: [],
      sectors: ["Mercearia", "Frios e Laticínios", "Hortifruti", "Bebidas"],
      keywords: ["arroz", "feijao", "leite", "cafe", "macarrao", "molho", "banana", "suco"],
      reason: "Produtos básicos ligados ao histórico de seleção e busca do cliente."
    }
  ];
  const events = [
    ...cartRows.map((row) => ({ sector: row.sector_name, product: row.product_name, quantity: Number(row.quantity || 1) * 2 })),
    ...signalRows.map((row) => ({ sector: row.sector_name, product: `${row.product_name || ""} ${row.query || ""}`, quantity: 1 })),
    ...ticketRows.map((row) => ({ sector: row.sector_name || row.sector_id, product: "", quantity: 3 }))
  ];
  return definitions
    .map((definition) => {
      const score = events.reduce((sum, event) => {
        const text = normalizeSignalText(`${event.sector || ""} ${event.product || ""}`);
        const sectorMatch = definition.sectors.some((sector) => text.includes(normalizeSignalText(sector))) || definition.triggerSectors.some((sector) => text.includes(sector));
        const keywordMatch = definition.keywords.some((keyword) => text.includes(normalizeSignalText(keyword)));
        return sum + (sectorMatch ? event.quantity * 3 : 0) + (keywordMatch ? event.quantity * 2 : 0);
      }, 0);
      return { ...definition, score };
    })
    .sort((first, second) => second.score - first.score)
    .slice(0, 4);
}

function rankShoppingSignals(events, keyFn, summaryFn) {
  const groups = new Map();
  events.forEach((event) => {
    const key = keyFn(event);
    if (!key) return;
    const group = groups.get(key) || { key, events: [], quantity: 0 };
    group.events.push(event);
    group.quantity += Number(event.quantity || event.weight || 1);
    groups.set(key, group);
  });
  return [...groups.values()].map(summaryFn).sort((left, right) => right.quantity - left.quantity);
}

function preferredShoppingHourBucket(events) {
  return rankShoppingSignals(events, (event) => hourBucketFor(Number(new Date(event.created_at || event.createdAt).toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: BUSINESS_TIME_ZONE }))), (group) => ({ label: group.key, quantity: group.quantity }))[0]?.label || "";
}

function normalizeSignalText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

async function removeCartItem(itemId, customerId) {
  const item = (await select("cart_items", `id=eq.${encodeURIComponent(itemId)}&customer_id=eq.${encodeURIComponent(customerId)}&limit=1`))[0];
  if (!item) return fail("Item nao encontrado.");
  await remove("cart_items", itemId);
  await registerEvent("carrinho_item_removido", "cart_item", itemId, customerId, null, { productId: item.product_id });
  return { ok: true };
}

async function createRating(body) {
  const customerId = cleanId(body.customerId);
  const ticketId = cleanId(body.ticketId);
  if (!customerId || !ticketId) return fail("Avalie uma senha atendida.");
  const ticket = (await select("tickets", `id=eq.${encodeURIComponent(ticketId)}&customer_id=eq.${encodeURIComponent(customerId)}&limit=1`))[0];
  if (!ticket || (!ticket.finished_at && ticket.status !== "atendido")) return fail("A senha ainda nao pode ser avaliada.");
  const previous = (await select("ratings", `customer_id=eq.${encodeURIComponent(customerId)}&ticket_id=eq.${encodeURIComponent(ticketId)}&limit=1`))[0];
  if (previous) return fail("Esta senha ja foi avaliada.");
  const score = String(body.score || "sem_nota").slice(0, 30);
  if (!["Ruim", "Regular", "Ótima", "sem_nota"].includes(score)) return fail("Nota de avaliacao invalida.");
  const rating = await insert("ratings", {
    customer_id: customerId,
    ticket_id: ticketId,
    score,
    comment: String(body.comment || "").slice(0, 500),
    created_at: isoNow()
  });
  await registerEvent("avaliacao_recebida", "rating", rating.id, customerId, null, { score });
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
  const passwordPolicy = await validatePasswordPolicy(password);
  if (passwordPolicy.error) return fail(passwordPolicy.error);
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
  const customerName = await customerNameForTicket(row);
  const currentTicket = await getActiveSectorTicket(sector.id);
  const currentCustomerName = currentTicket ? await customerNameForTicket(currentTicket) : "";
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
    customerName,
    ticketNumber: row.number,
    deviceId: row.device_id,
    sectorId: row.sector_id,
    sector: sector.name,
    ticket: row.code,
    current: currentTicket?.code || await currentCode(sector),
    currentCustomerName,
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

async function safeTicketDto(row) {
  try {
    return await ticketDto(row);
  } catch (error) {
    console.error("ticket_dto_failed", error);
    const sector = row?.sector_id ? await getSector(row.sector_id).catch(() => null) : null;
    return fallbackTicketDto(row, sector);
  }
}

function fallbackTicketDto(row, sector) {
  if (!row) return null;
  const waiting = CALL_ELIGIBLE_STATUSES.includes(row.status);
  return {
    id: row.id,
    customerId: row.customer_id,
    customerName: ticketName(row),
    ticketNumber: row.number,
    deviceId: row.device_id,
    sectorId: row.sector_id,
    sector: sector?.name || row.sector_id,
    ticket: row.code,
    current: row.code,
    currentCustomerName: ticketName(row),
    counterLabel: sector?.counter_label || "",
    serviceLabel: sector?.service_label || "",
    status: row.status,
    source: row.source || "digital",
    kioskId: row.kiosk_id || null,
    priority: Boolean(row.priority),
    priorityReason: row.priority_reason,
    position: 1,
    ahead: 0,
    secondsToCall: 0,
    averageServiceSeconds: Number(sector?.average_service_seconds || 60),
    averageServiceSamples: 0,
    estimateBasedOnRecentServices: false,
    countdownTotalSeconds: 0,
    estimatedCallAt: null,
    progress: progressFor(row.status, 1),
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
  await Promise.all([
    expireAbsentCalls(),
    notifyStandbyExpiringTickets(),
    expireExpiredStandbyTickets(),
    purgeExpiredAuthSessions()
  ]);
  await autoCallReadyTickets();
}

async function purgeExpiredAuthSessions() {
  const result = await supabaseFetch(`/rest/v1/app_sessions?expires_at=lt.${encodeURIComponent(isoNow())}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" }
  });
  if (result?.error) throw new Error(result.error);
}

async function maybeRunScheduledJobs(options = {}) {
  const now = Date.now();
  if (scheduledJobsPromise) {
    if (options.wait) await scheduledJobsPromise;
    return;
  }
  if (now - scheduledJobsLastRun < SCHEDULED_JOBS_MIN_INTERVAL_MS) return;
  scheduledJobsLastRun = now;
  scheduledJobsPromise = runScheduledJobs()
    .catch((error) => console.error("scheduled_jobs_failed", error))
    .finally(() => {
      scheduledJobsPromise = null;
    });
  if (options.wait) await scheduledJobsPromise;
}

async function autoCallReadyTickets() {
  const [sectors, eligibleTickets] = await Promise.all([
    getSectors(),
    select("tickets", `status=in.(${CALL_ELIGIBLE_STATUSES.join(",")})&or=(eligible_at.lte.${encodeURIComponent(isoNow())},eligible_at.is.null)&select=sector_id`)
  ]);
  const eligibleSectorIds = new Set(eligibleTickets.map((ticket) => ticket.sector_id));
  for (const sector of sectors) {
    if (sector.status !== "open" || !eligibleSectorIds.has(sector.id)) continue;
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
      const updated = await updateTicketIfStatus(ticket.id, ["chamado"], {
        status: "cancelado",
        absence_count: absenceCount,
        canceled_at: now,
        called_at: null,
        standby_started_at: null,
        standby_expires_at: null,
        updated_at: now
      });
      if (!updated) continue;
      await registerEvent("senha_cancelada_por_ausencia", "ticket", ticket.id, ticket.customer_id, ticket.sector_id, { absenceCount });
      await dispatchTicketPush(updated, "queue_changed", `absence-canceled-${absenceCount}`);
      await releaseSmartWaitTicket(ticket.customer_id);
      await notifyQueueMilestones(ticket.sector_id);
      continue;
    }
    const updated = await updateTicketIfStatus(ticket.id, ["chamado"], {
      status: "standby",
      absence_count: absenceCount,
      called_at: null,
      standby_started_at: now,
      standby_expires_at: new Date(Date.now() + STANDBY_SECONDS * 1000).toISOString(),
      queue_order: Number(ticket.queue_order || 0) + 1000,
      updated_at: now
    });
    if (!updated) continue;
    await registerEvent("senha_em_standby_por_ausencia", "ticket", ticket.id, ticket.customer_id, ticket.sector_id, { absenceCount });
    await dispatchTicketPush(updated, "queue_standby", `absence-${absenceCount}`);
    await releaseSmartWaitTicket(ticket.customer_id);
    await notifyQueueMilestones(ticket.sector_id);
  }
}

async function expireExpiredStandbyTickets() {
  const now = isoNow();
  const expired = await select("tickets", `status=eq.standby&standby_expires_at=not.is.null&standby_expires_at=lt.${encodeURIComponent(now)}`);
  for (const ticket of expired) {
    const updated = await updateTicketIfStatus(ticket.id, ["standby"], { status: "cancelado", canceled_at: now, standby_started_at: null, standby_expires_at: null, updated_at: now });
    if (!updated) continue;
    await registerEvent("senha_cancelada_por_standby_expirado", "ticket", ticket.id, ticket.customer_id, ticket.sector_id, { code: ticket.code });
    await dispatchTicketPush(updated, "queue_standby_expired", `absence-${Number(ticket.absence_count || 0)}`);
    await notifyQueueMilestones(ticket.sector_id);
  }
}

async function expireStaleActiveTickets() {
  const today = businessDateFor();
  const active = await select("tickets", `status=in.(${ACTIVE_STATUSES.join(",")})`);
  const stale = active.filter((ticket) => businessDateFor(ticket.created_at) !== today);
  for (const ticket of stale) {
    const now = isoNow();
    const updated = await updateTicketIfStatus(ticket.id, [ticket.status], {
      status: "expirado",
      expired_at: now,
      called_at: null,
      smart_wait_reason: null,
      blocked_by_ticket_id: null,
      smart_wait_since: null,
      updated_at: now
    });
    if (!updated) continue;
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

async function getProfile(userId, fallbackEmail = "", options = {}) {
  const cached = profileCache.get(userId);
  if (!options.bypassCache && cached && cached.expiresAt > Date.now()) {
    return { ...cached.profile, email: cached.profile.email || fallbackEmail };
  }
  const [profileRows, permissions] = await Promise.all([
    select("profiles", `id=eq.${encodeURIComponent(userId)}&limit=1`),
    select("profile_sector_permissions", `profile_id=eq.${encodeURIComponent(userId)}&select=sector_id`)
  ]);
  const profile = profileRows[0];
  if (!profile) return null;
  const dto = userDto({ ...profile, email: profile.email || fallbackEmail, sectorIds: permissions.map((item) => item.sector_id) });
  profileCache.set(userId, { profile: dto, expiresAt: Date.now() + PROFILE_CACHE_TTL_MS });
  return dto;
}

async function getAuthUser(request) {
  const token = getCookie(request, "senhahub_auth");
  const session = verifySessionToken(token);
  if (!session?.user?.id) return null;
  const [profile, appSession] = await Promise.all([
    getProfile(session.user.id, session.email, { bypassCache: true }),
    getActiveAuthSession(session)
  ]);
  if (!profile || profile.status !== "active" || !appSession) return null;
  return { ...profile, csrf_token: session.csrfToken, session_id: session.sessionId };
}

async function createAuthSession(sessionId, userId, csrfToken, expiresAt) {
  const session = await insert("app_sessions", {
    id: sessionId,
    user_id: userId,
    csrf_token_hash: hashSessionValue(csrfToken),
    expires_at: expiresAt,
    last_seen_at: isoNow()
  });
  if (!session?.id) throw new Error("Nao foi possivel registrar a sessao.");
  return session;
}

async function getActiveAuthSession(session) {
  if (!session?.sessionId || !session?.user?.id || !session?.csrfToken) return null;
  const rows = await select(
    "app_sessions",
    `id=eq.${encodeURIComponent(session.sessionId)}&user_id=eq.${encodeURIComponent(session.user.id)}&revoked_at=is.null&expires_at=gt.${encodeURIComponent(isoNow())}&limit=1`
  );
  const active = rows[0];
  return active && safeEqual(active.csrf_token_hash, hashSessionValue(session.csrfToken)) ? active : null;
}

async function revokeAuthSession(sessionId) {
  if (!sessionId) return;
  const result = await supabaseFetch(`/rest/v1/app_sessions?id=eq.${encodeURIComponent(sessionId)}&revoked_at=is.null`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: { revoked_at: isoNow() }
  });
  if (result?.error) console.error("auth_session_revoke_failed", result.error);
}

async function revokeAuthSessionsForUser(userId) {
  if (!userId) return;
  const result = await supabaseFetch(`/rest/v1/app_sessions?user_id=eq.${encodeURIComponent(userId)}&revoked_at=is.null`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: { revoked_at: isoNow() }
  });
  if (result?.error) console.error("auth_sessions_revoke_failed", result.error);
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
  const cookieToken = getCookie(request, "senhahub_csrf") || "";
  const expected = user.csrf_token || "";
  return safeEqual(headerToken, expected) && safeEqual(cookieToken, expected);
}

async function getSupabasePushPreferences(userId) {
  const row = (await select("push_notification_preferences", `user_id=eq.${encodeURIComponent(userId)}&limit=1`))[0];
  return normalizePreferences(row || DEFAULT_PREFERENCES);
}

async function setSupabasePushPreferences(userId, input) {
  const preferences = normalizePreferences(input);
  const existing = (await select("push_notification_preferences", `user_id=eq.${encodeURIComponent(userId)}&limit=1`))[0];
  await upsert("push_notification_preferences", {
    user_id: userId,
    ...preferencesToRow(preferences),
    created_at: existing?.created_at || isoNow(),
    updated_at: isoNow()
  }, "user_id");
  return preferences;
}

function pushDeviceDto(row) {
  return {
    id: row.id,
    endpointHash: crypto.createHash("sha256").update(String(row.endpoint || "")).digest("base64url"),
    deviceName: row.device_name || "Navegador atual",
    platform: row.platform || "unknown",
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSuccessAt: row.last_success_at,
    lastFailureAt: row.last_failure_at
  };
}

async function revokePushSubscriptionsForUser(userId) {
  const now = isoNow();
  const result = await supabaseFetch(`/rest/v1/web_push_subscriptions?user_id=eq.${encodeURIComponent(userId)}&enabled=eq.true`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: { enabled: false, revoked_at: now, updated_at: now }
  });
  if (result?.error) console.error("push_logout_revoke_failed");
}

function verifyPushRequestOrigin(request) {
  const origin = String(request.headers.get("origin") || "");
  if (!origin && process.env.NODE_ENV !== "production") return true;
  try {
    return Boolean(origin && new URL(origin).origin === new URL(request.url).origin);
  } catch {
    return false;
  }
}

async function consumePushRateLimit(user, request, action, limit, windowSeconds) {
  const raw = `${user.id}:${clientIp(request)}:${action}`;
  const rateKey = `push:${crypto.createHash("sha256").update(raw).digest("hex")}`;
  const result = await rpc("consume_push_rate_limit", {
    p_rate_key: rateKey,
    p_limit: limit,
    p_window_seconds: windowSeconds
  });
  return result === true;
}

async function consumeSecurityRateLimit(scope, value, limit, windowSeconds) {
  const raw = `${scope}:${String(value || "unknown")}`;
  const rateKey = `security:${crypto.createHash("sha256").update(raw).digest("hex")}`;
  try {
    const result = await rpc("consume_security_rate_limit", {
      p_rate_key: rateKey,
      p_limit: limit,
      p_window_seconds: windowSeconds
    });
    return result === true;
  } catch (error) {
    console.error("security_rate_limit_failed", error.message);
    return null;
  }
}

function cleanLimitedText(value, maximum) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function createSupabasePushRepository() {
  return {
    async claimEvent(event) {
      const claimed = await rpc("claim_push_notification_event", {
        p_event_key: event.eventKey,
        p_user_id: event.userId,
        p_ticket_id: event.ticketId || null,
        p_event_type: event.eventType,
        p_payload_version: event.payloadVersion
      });
      return claimed?.id ? claimed : null;
    },
    async getPreferences(userId) {
      return getSupabasePushPreferences(userId);
    },
    async getEnabledSubscriptions(userId) {
      return select("web_push_subscriptions", `user_id=eq.${encodeURIComponent(userId)}&enabled=eq.true&order=created_at.asc`);
    },
    async completeEvent(eventId, result) {
      await update("push_notification_events", eventId, {
        status: result.status,
        attempts: Number(result.attempts || 0),
        failure_reason: result.failureReason || null,
        sent_at: result.sentAt || null,
        failed_at: result.failedAt || null,
        updated_at: isoNow()
      });
    },
    async markSubscriptionSuccess(subscriptionId, at) {
      await update("web_push_subscriptions", subscriptionId, {
        last_success_at: at,
        last_failure_at: null,
        failure_count: 0,
        updated_at: at
      });
    },
    async markSubscriptionFailure(subscriptionId, failure) {
      await update("web_push_subscriptions", subscriptionId, {
        last_failure_at: failure.at,
        failure_count: failure.failureCount,
        enabled: !failure.invalid,
        revoked_at: failure.invalid ? failure.at : null,
        updated_at: failure.at
      });
    }
  };
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
  try {
    await insert("events", { type, entity_type: entityType, entity_id: String(entityId), customer_id: customerId, sector_id: sectorId, payload, created_at: isoNow() }, false);
  } catch (error) {
    console.error("event_register_failed", error);
  }
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
  if (result?.error) throw new Error(result.error);
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

async function updateTicketIfStatus(id, expectedStatuses, body) {
  const statuses = [...new Set(expectedStatuses)].filter((status) => ACTIVE_STATUSES.includes(status));
  if (!statuses.length) return null;
  const statusFilter = statuses.length === 1
    ? `status=eq.${encodeURIComponent(statuses[0])}`
    : `status=in.(${statuses.map(encodeURIComponent).join(",")})`;
  const result = await supabaseFetch(`/rest/v1/tickets?id=eq.${encodeURIComponent(id)}&${statusFilter}&select=*`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body
  });
  if (result.error) throw new Error(result.error);
  return Array.isArray(result) ? result[0] || null : null;
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
  const payload = parseSupabasePayload(text);
  if (options.raw) {
    return { payload, count: response.headers.get("content-range")?.split("/")?.[1] };
  }
  if (!response.ok) return { error: supabaseErrorMessage(payload, response), status: response.status };
  return payload;
}

function parseSupabasePayload(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: String(text).slice(0, 240) };
  }
}

function supabaseErrorMessage(payload, response) {
  return payload?.error_description || payload?.message || payload?.hint || response.statusText || "Falha ao comunicar com o Supabase.";
}

function isSupabaseReady() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY);
}

function envFlag(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function validatePresence() {
  return { ok: true, qrVerified: false, locationVerified: false, location: null, distanceMeters: null };
}

function validateCustomerRegistration(body) {
  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.name || "").trim();
  const password = String(body.password || "");
  if (!name || name.length < 2) return { error: "Informe seu nome completo." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Informe um e-mail valido." };
  if (!validateStrongPassword(password)) return { error: "A senha precisa ter ao menos 12 caracteres, letras maiusculas, minusculas e numeros." };
  return { email, name, password };
}

function validateStrongPassword(password, minimum = 12) {
  return isStrongPassword(password, minimum);
}

async function validatePasswordPolicy(password) {
  return passwordPolicyError(await evaluatePasswordPolicy(password));
}

function normalizePriority(body) {
  const requested = body.priority === true || body.priority === "true" || body.priority === "1";
  const reason = cleanId(body.priorityReason);
  const enabled = requested && PRIORITY_CATEGORIES.has(reason);
  return { enabled, reason: enabled ? reason : null };
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
  if (process.env.NODE_ENV !== "production") return "senhahub-demo-auth-secret-change-before-production";
  throw new Error("AUTH_SECRET precisa ter ao menos 32 caracteres em producao.");
}

function hashSessionValue(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
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
      `senhahub_auth=${encodeURIComponent(sessionToken)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secure}`,
      `senhahub_csrf=${encodeURIComponent(csrfToken)}; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secure}`
    ]
  };
}

function clearAuthCookies() {
  return {
    "set-cookie": [
      "senhahub_auth=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
      "senhahub_csrf=; SameSite=Lax; Path=/; Max-Age=0"
    ]
  };
}

function getCookie(request, name) {
  const cookies = String(request.headers.get("cookie") || "").split(";").map((item) => item.trim());
  const match = cookies.find((item) => item.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function clientIp(request) {
  const trusted = request.headers.get("x-vercel-forwarded-for") || request.headers.get("x-real-ip");
  return String(trusted || "unknown").split(",")[0].trim() || "unknown";
}

async function readJson(request) {
  const text = await request.text();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      const error = new Error("JSON body must be an object.");
      error.code = "INVALID_JSON";
      throw error;
    }
    return parsed;
  } catch {
    const error = new Error("Invalid JSON body.");
    error.code = "INVALID_JSON";
    throw error;
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

function withRequestId(response, requestId) {
  if (!response) return json({ error: "Resposta vazia do servidor." }, 500, { "x-request-id": requestId });
  const headers = new Headers(response.headers);
  headers.set("x-request-id", requestId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function securityHeaders(extra = {}) {
  return {
    "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https://source.unsplash.com https://images.unsplash.com; connect-src 'self'; font-src 'self' https://fonts.gstatic.com; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
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

function metricsDateFromQuery(value) {
  const requested = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(requested) && businessDateFor(`${requested}T12:00:00-03:00`) === requested) {
    return requested;
  }
  return businessDateFor();
}

function businessDayBounds(metricsDate) {
  const start = new Date(`${metricsDate}T00:00:00-03:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

async function mapAsync(items, mapper) {
  return Promise.all(items.map(mapper));
}

module.exports = { handleRequest };
