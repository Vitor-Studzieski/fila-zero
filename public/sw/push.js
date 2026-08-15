(function exposeSenhaHubPush(scope) {
  const utils = scope.SenhaHubPwaUtils;
  const allowedTypes = new Set([
    "queue_near",
    "queue_next",
    "queue_called",
    "queue_recalled",
    "queue_standby",
    "queue_standby_expiring",
    "queue_standby_expired",
    "queue_changed",
    "push_test"
  ]);

  function cleanText(value, maximum, fallback = "") {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return (text || fallback).slice(0, maximum);
  }

  function parsePayload(event) {
    let input = {};
    try {
      input = event.data?.json() || {};
    } catch {
      input = {};
    }
    const type = allowedTypes.has(input.type) ? input.type : "queue_changed";
    const url = utils.safeAppUrl(input.url, scope.location.origin) || `${scope.location.origin}/?view=status`;
    return {
      type,
      title: cleanText(input.title, 80, "SenhaHub"),
      body: cleanText(input.body, 180, "Abra o aplicativo para consultar a situação atual da fila."),
      url,
      eventId: cleanText(input.eventId, 120, `push-${Date.now()}`),
      ticketId: cleanText(input.ticketId, 80),
      urgency: input.urgency === "high" ? "high" : "normal"
    };
  }

  async function visibleWindowClients() {
    const windows = await scope.clients.matchAll({ type: "window", includeUncontrolled: true });
    return windows.filter((client) => client.visibilityState === "visible");
  }

  async function handlePush(event) {
    const payload = parsePayload(event);
    const visible = await visibleWindowClients();
    if (visible.length) {
      visible.forEach((client) => client.postMessage({ type: "PUSH_EVENT", payload }));
      return;
    }
    await scope.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/senhahub-192.png",
      badge: "/icons/favicon-32.png",
      tag: payload.eventId,
      renotify: payload.type === "queue_recalled",
      requireInteraction: ["queue_called", "queue_recalled"].includes(payload.type),
      data: {
        type: payload.type,
        url: payload.url,
        eventId: payload.eventId,
        ticketId: payload.ticketId
      },
      actions: [
        { action: "open", title: "Ver atendimento" },
        { action: "dismiss", title: "Fechar" }
      ]
    });
  }

  async function handleNotificationClick(event) {
    event.notification.close();
    if (event.action === "dismiss") return;
    const target = utils.safeAppUrl(event.notification.data?.url, scope.location.origin)
      || `${scope.location.origin}/?view=status`;
    const windows = await scope.clients.matchAll({ type: "window", includeUncontrolled: true });
    const current = windows.find((client) => new URL(client.url).origin === scope.location.origin);
    if (current) {
      if ("navigate" in current && current.url !== target) await current.navigate(target);
      current.postMessage({
        type: "NOTIFICATION_CLICK",
        payload: {
          type: event.notification.data?.type || "queue_changed",
          url: target
        }
      });
      await current.focus();
      return;
    }
    await scope.clients.openWindow(target);
  }

  async function handleNotificationClose(event) {
    const windows = await scope.clients.matchAll({ type: "window", includeUncontrolled: true });
    windows.forEach((client) => client.postMessage({
      type: "NOTIFICATION_CLOSED",
      eventId: cleanText(event.notification.data?.eventId, 120)
    }));
  }

  scope.SenhaHubPush = {
    handleNotificationClick,
    handleNotificationClose,
    handlePush,
    parsePayload
  };
})(self);
