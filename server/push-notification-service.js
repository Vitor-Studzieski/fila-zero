const crypto = require("node:crypto");
const webPush = require("web-push");

const MAX_PAYLOAD_BYTES = 3072;
const DEFAULT_PREFERENCES = Object.freeze({
  queueNear: true,
  queueCalled: true,
  standby: true,
  queueChanges: true,
  promotions: false
});
const EVENT_PREFERENCES = Object.freeze({
  queue_near: "queueNear",
  queue_next: "queueCalled",
  queue_called: "queueCalled",
  queue_recalled: "queueCalled",
  queue_standby: "standby",
  queue_standby_expiring: "standby",
  queue_standby_expired: "standby",
  queue_changed: "queueChanges",
  push_test: null
});
const EVENT_DELIVERY = Object.freeze({
  queue_near: { ttl: 300, urgency: "normal" },
  queue_next: { ttl: 300, urgency: "high" },
  queue_called: { ttl: 600, urgency: "high" },
  queue_recalled: { ttl: 600, urgency: "high" },
  queue_standby: { ttl: 600, urgency: "normal" },
  queue_standby_expiring: { ttl: 180, urgency: "high" },
  queue_standby_expired: { ttl: 900, urgency: "normal" },
  queue_changed: { ttl: 300, urgency: "normal" },
  push_test: { ttl: 60, urgency: "normal" }
});

class PushNotificationService {
  constructor({ repository, configuration, sender, logger = console }) {
    if (!repository) throw new Error("Repositorio de Web Push nao configurado.");
    this.repository = repository;
    this.configuration = configuration;
    this.sender = sender || createWebPushSender(configuration);
    this.logger = logger;
  }

  isConfigured() {
    return Boolean(this.configuration?.enabled);
  }

  publicKey() {
    return this.isConfigured() ? this.configuration.publicKey : "";
  }

  async sendBusinessEvent(input) {
    if (!this.isConfigured()) return { configured: false, status: "disabled" };
    const event = normalizeBusinessEvent(input);
    const claimed = await this.repository.claimEvent({
      eventKey: event.eventKey,
      userId: event.userId,
      ticketId: event.ticketId,
      eventType: event.type,
      payloadVersion: event.payloadVersion
    });
    if (!claimed) return { configured: true, status: "duplicate" };

    const preferences = normalizePreferences(await this.repository.getPreferences(event.userId));
    const preference = EVENT_PREFERENCES[event.type];
    if (preference && preferences[preference] === false) {
      await this.repository.completeEvent(claimed.id, {
        status: "skipped",
        attempts: 0,
        failureReason: "preference_disabled"
      });
      return { configured: true, status: "skipped", reason: "preference_disabled" };
    }

    const subscriptions = await this.repository.getEnabledSubscriptions(event.userId);
    if (!subscriptions.length) {
      await this.repository.completeEvent(claimed.id, {
        status: "skipped",
        attempts: 0,
        failureReason: "no_subscription"
      });
      return { configured: true, status: "skipped", reason: "no_subscription" };
    }

    const payload = buildNotificationPayload(event.type, {
      ...event.context,
      ticketId: event.ticketId,
      eventId: claimed.id
    });
    const delivery = EVENT_DELIVERY[event.type];
    const results = await Promise.all(
      subscriptions.map((subscription) => this.sendToSubscription(subscription, payload, delivery, event.eventKey))
    );
    const sent = results.filter((result) => result.sent).length;
    const failed = results.length - sent;
    const status = sent === results.length ? "sent" : sent > 0 ? "partial" : "failed";

    await this.repository.completeEvent(claimed.id, {
      status,
      attempts: results.length,
      sentAt: sent > 0 ? new Date().toISOString() : null,
      failedAt: failed > 0 ? new Date().toISOString() : null,
      failureReason: failed > 0 ? "provider_failure" : null
    });
    this.logger.info?.("push_delivery_completed", {
      eventType: event.type,
      status,
      recipients: results.length,
      sent,
      failed
    });
    return { configured: true, status, recipients: results.length, sent, failed };
  }

  async sendToSubscription(subscription, payload, delivery, eventKey) {
    try {
      await this.sender(subscription, payload, {
        ...delivery,
        topic: eventTopic(eventKey)
      });
      await this.repository.markSubscriptionSuccess(subscription.id, new Date().toISOString());
      return { sent: true };
    } catch (error) {
      const statusCode = Number(error?.statusCode || 0);
      const invalid = statusCode === 404 || statusCode === 410;
      await this.repository.markSubscriptionFailure(subscription.id, {
        at: new Date().toISOString(),
        invalid,
        failureCount: Number(subscription.failure_count || subscription.failureCount || 0) + 1,
        statusCode
      });
      this.logger.warn?.("push_provider_failure", {
        statusCode: statusCode || null,
        invalidSubscription: invalid
      });
      return { sent: false, invalid, statusCode };
    }
  }
}

function loadPushConfiguration(environment = process.env) {
  const enabled = envFlag(environment.PUSH_NOTIFICATIONS_ENABLED, false);
  if (!enabled) return { enabled: false, publicKey: "", privateKey: "", subject: "" };

  const publicKey = String(environment.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "").trim();
  const privateKey = String(environment.VAPID_PRIVATE_KEY || "").trim();
  const subject = String(environment.VAPID_SUBJECT || "").trim();
  validateVapidConfiguration({ publicKey, privateKey, subject });
  return { enabled: true, publicKey, privateKey, subject };
}

function validateVapidConfiguration({ publicKey, privateKey, subject }) {
  if (decodeBase64Url(publicKey)?.length !== 65) throw new Error("NEXT_PUBLIC_VAPID_PUBLIC_KEY invalida.");
  if (decodeBase64Url(privateKey)?.length !== 32) throw new Error("VAPID_PRIVATE_KEY invalida.");
  if (!isValidVapidSubject(subject)) throw new Error("VAPID_SUBJECT deve usar mailto: ou uma URL HTTPS valida.");
  webPush.setVapidDetails(subject, publicKey, privateKey);
}

function createWebPushSender(configuration) {
  return async (subscription, payload, delivery) => {
    if (!configuration?.enabled) throw new Error("Web Push desativado.");
    return webPush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth
        }
      },
      JSON.stringify(payload),
      {
        vapidDetails: {
          subject: configuration.subject,
          publicKey: configuration.publicKey,
          privateKey: configuration.privateKey
        },
        TTL: delivery.ttl,
        urgency: delivery.urgency,
        topic: delivery.topic,
        timeout: 10000
      }
    );
  };
}

function validatePushSubscription(input) {
  const subscription = input?.subscription || input;
  if (!subscription || typeof subscription !== "object") return { error: "Assinatura ausente." };
  const endpoint = String(subscription.endpoint || "").trim();
  const p256dh = String(subscription.keys?.p256dh || subscription.p256dh || "").trim();
  const auth = String(subscription.keys?.auth || subscription.auth || "").trim();

  if (!isAllowedPushEndpoint(endpoint)) return { error: "Endpoint de notificacao invalido." };
  if (decodeBase64Url(p256dh)?.length !== 65) return { error: "Chave p256dh invalida." };
  if (decodeBase64Url(auth)?.length !== 16) return { error: "Chave auth invalida." };
  return {
    endpoint,
    p256dh,
    auth
  };
}

function isAllowedPushEndpoint(value) {
  if (!value || String(value).length > 2048) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || !url.pathname) return false;
    const host = url.hostname.toLowerCase();
    return (
      host === "fcm.googleapis.com"
      || host === "android.googleapis.com"
      || host === "updates.push.services.mozilla.com"
      || host === "push.services.mozilla.com"
      || host === "web.push.apple.com"
      || host.endsWith(".push.apple.com")
      || host.endsWith(".notify.windows.com")
    );
  } catch {
    return false;
  }
}

function normalizePreferences(input = {}) {
  return {
    queueNear: booleanValue(input.queueNear ?? input.queue_near_enabled, DEFAULT_PREFERENCES.queueNear),
    queueCalled: booleanValue(input.queueCalled ?? input.queue_called_enabled, DEFAULT_PREFERENCES.queueCalled),
    standby: booleanValue(input.standby ?? input.standby_enabled, DEFAULT_PREFERENCES.standby),
    queueChanges: booleanValue(input.queueChanges ?? input.queue_changes_enabled, DEFAULT_PREFERENCES.queueChanges),
    promotions: booleanValue(input.promotions ?? input.promotions_enabled, DEFAULT_PREFERENCES.promotions)
  };
}

function preferencesToRow(preferences) {
  const normalized = normalizePreferences(preferences);
  return {
    queue_near_enabled: normalized.queueNear,
    queue_called_enabled: normalized.queueCalled,
    standby_enabled: normalized.standby,
    queue_changes_enabled: normalized.queueChanges,
    promotions_enabled: normalized.promotions
  };
}

function buildNotificationPayload(type, context = {}) {
  if (!Object.prototype.hasOwnProperty.call(EVENT_PREFERENCES, type)) throw new Error("Tipo de notificacao invalido.");
  const sector = cleanText(context.sector, 80, "setor informado");
  const counter = cleanText(context.counterLabel, 80, "balcao do setor");
  const firstName = cleanFirstName(context.customerName);
  const ahead = Math.max(0, Math.min(99, Number(context.ahead || 0)));
  const messages = {
    queue_near: {
      title: "Sua vez está próxima",
      body: `Existem apenas ${ahead || 2} atendimentos antes de você no setor ${sector}.`
    },
    queue_next: {
      title: "Prepare-se para o atendimento",
      body: `Você é o próximo cliente no setor ${sector}.`
    },
    queue_called: {
      title: `${firstName}, é a sua vez!`,
      body: `Dirija-se ao ${counter} do setor ${sector}.`
    },
    queue_recalled: {
      title: "Você está sendo chamado novamente",
      body: `Compareça ao ${counter} do setor ${sector}.`
    },
    queue_standby: {
      title: "Atendimento em standby",
      body: "Seu atendimento ficará reservado por até 10 minutos."
    },
    queue_standby_expiring: {
      title: "Seu tempo de espera está terminando",
      body: "Compareça ao balcão antes que o período de standby termine."
    },
    queue_standby_expired: {
      title: "Período de standby encerrado",
      body: "O limite de 10 minutos foi atingido e sua vez foi encerrada."
    },
    queue_changed: {
      title: "Sua fila foi atualizada",
      body: `Abra o SenhaHub para consultar a situação atual no setor ${sector}.`
    },
    push_test: {
      title: "Alertas do SenhaHub estão ativos",
      body: "Este dispositivo está pronto para receber avisos da sua fila."
    }
  };
  const message = messages[type];
  const payload = {
    type,
    title: cleanText(message.title, 80, "SenhaHub"),
    body: cleanText(message.body, 180),
    url: safeNotificationPath(context.url || (type === "push_test" ? "/?view=account" : "/?view=status")),
    ticketId: cleanText(context.ticketId, 80),
    eventId: cleanText(context.eventId, 120),
    urgency: EVENT_DELIVERY[type].urgency
  };
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > MAX_PAYLOAD_BYTES) {
    throw new Error("Payload de notificacao excede o limite permitido.");
  }
  return payload;
}

function normalizeBusinessEvent(input = {}) {
  const type = String(input.type || "");
  if (!Object.prototype.hasOwnProperty.call(EVENT_PREFERENCES, type)) throw new Error("Evento de Web Push invalido.");
  const eventKey = cleanText(input.eventKey, 240);
  const userId = cleanText(input.userId, 80);
  if (!eventKey || !userId) throw new Error("Evento de Web Push incompleto.");
  return {
    type,
    eventKey,
    userId,
    ticketId: cleanText(input.ticketId, 80) || null,
    payloadVersion: Math.max(1, Number.parseInt(input.payloadVersion || 1, 10)),
    context: input.context && typeof input.context === "object" ? input.context : {}
  };
}

function safeNotificationPath(value) {
  try {
    const url = new URL(String(value || "/"), "https://senhahub.local");
    if (url.origin !== "https://senhahub.local" || url.pathname !== "/") return "/?view=status";
    if ([...url.searchParams.keys()].some((key) => key !== "view")) return "/?view=status";
    const view = url.searchParams.get("view");
    if (view && !["status", "account"].includes(view)) return "/?view=status";
    return `${url.pathname}${url.search}`;
  } catch {
    return "/?view=status";
  }
}

function eventTopic(eventKey) {
  return crypto.createHash("sha256").update(String(eventKey)).digest("base64url").slice(0, 32);
}

function decodeBase64Url(value) {
  const input = String(value || "").trim();
  if (!input || input.length > 256 || !/^[A-Za-z0-9_-]+$/.test(input)) return null;
  try {
    return Buffer.from(input, "base64url");
  } catch {
    return null;
  }
}

function isValidVapidSubject(value) {
  if (typeof value !== "string" || value.length > 320) return false;
  if (/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && url.hostname !== "localhost";
  } catch {
    return false;
  }
}

function cleanFirstName(value) {
  return cleanText(value, 80, "Cliente").split(/\s+/)[0] || "Cliente";
}

function cleanText(value, maximum, fallback = "") {
  const text = String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, maximum);
}

function booleanValue(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function envFlag(value, fallback = false) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

module.exports = {
  DEFAULT_PREFERENCES,
  EVENT_DELIVERY,
  PushNotificationService,
  buildNotificationPayload,
  eventTopic,
  isAllowedPushEndpoint,
  loadPushConfiguration,
  normalizePreferences,
  preferencesToRow,
  safeNotificationPath,
  validatePushSubscription,
  validateVapidConfiguration
};
