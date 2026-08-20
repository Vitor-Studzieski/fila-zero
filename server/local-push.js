const crypto = require("node:crypto");
const { query, withTransaction } = require("./local-postgres");
const {
  DEFAULT_PREFERENCES,
  PushNotificationService,
  isAllowedPushEndpoint,
  loadPushConfiguration,
  normalizePreferences,
  preferencesToRow,
  validatePushSubscription
} = require("./push-notification-service");

const localPushConfiguration = loadPushConfiguration(process.env);

const localPushRepository = {
  async claimEvent(event) {
    const result = await query(
      `
        INSERT INTO public.push_notification_events (
          id, event_key, user_id, ticket_id, event_type, payload_version,
          status, attempts, created_at, updated_at
        )
        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'processing', 0, now(), now())
        ON CONFLICT (event_key) DO NOTHING
        RETURNING *
      `,
      [event.eventKey, event.userId, event.ticketId || null, event.eventType, event.payloadVersion]
    );
    return result.rows[0] || null;
  },

  async getPreferences(userId) {
    const result = await query(
      "SELECT * FROM public.push_notification_preferences WHERE user_id = $1 LIMIT 1",
      [userId]
    );
    return normalizePreferences(result.rows[0] || DEFAULT_PREFERENCES);
  },

  async getEnabledSubscriptions(userId) {
    const result = await query(
      `
        SELECT *
        FROM public.web_push_subscriptions
        WHERE user_id = $1 AND enabled = true
        ORDER BY created_at ASC
      `,
      [userId]
    );
    return result.rows;
  },

  async completeEvent(eventId, result) {
    await query(
      `
        UPDATE public.push_notification_events
        SET status = $2,
            attempts = $3,
            failure_reason = $4,
            sent_at = $5,
            failed_at = $6,
            updated_at = now()
        WHERE id = $1
      `,
      [
        eventId,
        result.status,
        Number(result.attempts || 0),
        result.failureReason || null,
        result.sentAt || null,
        result.failedAt || null
      ]
    );
  },

  async markSubscriptionSuccess(subscriptionId, at) {
    await query(
      `
        UPDATE public.web_push_subscriptions
        SET last_success_at = $2,
            last_failure_at = NULL,
            failure_count = 0,
            updated_at = $2
        WHERE id = $1
      `,
      [subscriptionId, at]
    );
  },

  async markSubscriptionFailure(subscriptionId, failure) {
    await query(
      `
        UPDATE public.web_push_subscriptions
        SET last_failure_at = $2,
            failure_count = $3,
            enabled = $4,
            revoked_at = CASE WHEN $5 THEN $2 ELSE revoked_at END,
            updated_at = $2
        WHERE id = $1
      `,
      [subscriptionId, failure.at, failure.failureCount, !failure.invalid, Boolean(failure.invalid)]
    );
  }
};

const localPushService = new PushNotificationService({
  repository: localPushRepository,
  configuration: localPushConfiguration
});

async function getLocalPushStatus(userId, canTest) {
  const [preferences, subscriptions] = await Promise.all([
    localPushRepository.getPreferences(userId),
    localPushRepository.getEnabledSubscriptions(userId)
  ]);
  return {
    configured: localPushService.isConfigured(),
    publicKey: localPushService.publicKey(),
    canTest: Boolean(canTest),
    preferences,
    devices: subscriptions.map(pushDeviceDto)
  };
}

async function subscribeLocalPush(userId, body, userAgent) {
  if (!localPushService.isConfigured()) {
    throw new Error("As notificacoes ainda nao foram configuradas no servidor.");
  }
  const subscription = validatePushSubscription(body?.subscription);
  if (subscription.error) throw new Error(subscription.error);
  const now = new Date().toISOString();
  const deviceName = cleanText(body?.device?.deviceName, 120) || "Navegador atual";
  const platform = cleanText(body?.device?.platform, 80) || "unknown";
  const result = await query(
    `
      INSERT INTO public.web_push_subscriptions (
        id, user_id, endpoint, p256dh, auth, user_agent, device_name,
        platform, enabled, created_at, updated_at, last_success_at,
        last_failure_at, failure_count, revoked_at
      )
      VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, true, now(), now(), NULL, NULL, 0, NULL)
      ON CONFLICT (endpoint) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        p256dh = EXCLUDED.p256dh,
        auth = EXCLUDED.auth,
        user_agent = EXCLUDED.user_agent,
        device_name = EXCLUDED.device_name,
        platform = EXCLUDED.platform,
        enabled = true,
        updated_at = now(),
        last_failure_at = NULL,
        failure_count = 0,
        revoked_at = NULL
      RETURNING *
    `,
    [
      userId,
      subscription.endpoint,
      subscription.p256dh,
      subscription.auth,
      cleanText(userAgent, 512) || null,
      deviceName,
      platform
    ]
  );
  const preferences = await setLocalPushPreferences(userId, body?.preferences);
  return { subscription: pushDeviceDto(result.rows[0]), preferences };
}

async function unsubscribeLocalPush(userId, endpoint) {
  const normalizedEndpoint = String(endpoint || "").trim();
  if (!isAllowedPushEndpoint(normalizedEndpoint)) throw new Error("Endpoint de notificacao invalido.");
  await query(
    `
      UPDATE public.web_push_subscriptions
      SET enabled = false, revoked_at = now(), updated_at = now()
      WHERE user_id = $1 AND endpoint = $2
    `,
    [userId, normalizedEndpoint]
  );
}

async function setLocalPushPreferences(userId, input) {
  const preferences = normalizePreferences(input);
  const row = preferencesToRow(preferences);
  const result = await query(
    `
      INSERT INTO public.push_notification_preferences (
        user_id, queue_near_enabled, queue_called_enabled, standby_enabled,
        queue_changes_enabled, promotions_enabled, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, now(), now())
      ON CONFLICT (user_id) DO UPDATE SET
        queue_near_enabled = EXCLUDED.queue_near_enabled,
        queue_called_enabled = EXCLUDED.queue_called_enabled,
        standby_enabled = EXCLUDED.standby_enabled,
        queue_changes_enabled = EXCLUDED.queue_changes_enabled,
        promotions_enabled = EXCLUDED.promotions_enabled,
        updated_at = now()
      RETURNING *
    `,
    [
      userId,
      row.queue_near_enabled,
      row.queue_called_enabled,
      row.standby_enabled,
      row.queue_changes_enabled,
      row.promotions_enabled
    ]
  );
  return normalizePreferences(result.rows[0]);
}

async function consumeLocalPushRateLimit(userId, action, limit, windowSeconds, requestKey = "local") {
  const raw = `${userId}:${requestKey}:${action}`;
  const rateKey = `push:${crypto.createHash("sha256").update(raw).digest("hex")}`;
  return withTransaction(async (client) => {
    const result = await client.query(
      "SELECT * FROM public.push_rate_limits WHERE rate_key = $1 FOR UPDATE",
      [rateKey]
    );
    const row = result.rows[0];
    if (!row) {
      await client.query(
        `
          INSERT INTO public.push_rate_limits (rate_key, window_started_at, request_count, updated_at)
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
          UPDATE public.push_rate_limits
          SET window_started_at = now(), request_count = 1, updated_at = now()
          WHERE rate_key = $1
        `,
        [rateKey]
      );
      return true;
    }
    if (Number(row.request_count) >= Number(limit)) return false;
    await client.query(
      "UPDATE public.push_rate_limits SET request_count = request_count + 1, updated_at = now() WHERE rate_key = $1",
      [rateKey]
    );
    return true;
  });
}

function verifyLocalPushOrigin(request) {
  const origin = String(request.headers.get("origin") || "");
  if (!origin && process.env.NODE_ENV !== "production") return true;
  const configuredOrigins = [
    process.env.PUBLIC_APP_URL,
    ...String(process.env.API_ALLOWED_ORIGINS || "").split(",")
  ].map((value) => String(value || "").trim().replace(/\/+$/, "")).filter(Boolean);
  try {
    const requestOrigin = new URL(request.url).origin;
    return Boolean(origin && (origin === requestOrigin || configuredOrigins.includes(origin)));
  } catch {
    return false;
  }
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

function dispatchLocalPushEvent(input) {
  if (!input?.userId) return Promise.resolve({ configured: localPushService.isConfigured(), status: "skipped" });
  return localPushService.sendBusinessEvent(input).catch((error) => {
    console.error("Falha ao entregar notificacao local:", error.message);
    return { configured: localPushService.isConfigured(), status: "failed" };
  });
}

function cleanText(value, maximum) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

module.exports = {
  consumeLocalPushRateLimit,
  dispatchLocalPushEvent,
  getLocalPushStatus,
  localPushService,
  setLocalPushPreferences,
  subscribeLocalPush,
  unsubscribeLocalPush,
  verifyLocalPushOrigin
};
