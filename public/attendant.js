let staffState = { sectors: [] };
let staffSource = null;
let currentUser = null;
let staffPollingTimer = null;
let staffRealtimeRetryTimer = null;
let staffLoadInFlight = null;
let pendingSkipTicketId = null;
const callNextInFlight = new Set();
const callNextFeedback = new Map();
const STAFF_POLL_INTERVAL_MS = 5000;
const CALL_HIGHLIGHT_DURATION_MS = 15000;
let callHighlightExpiryTimer = null;

initAttendant();

async function initAttendant() {
  currentUser = await requireSession(["attendant", "manager"]);
  document.querySelector("#logoutButton").addEventListener("click", logout);
  document.querySelector("#skipCancel").addEventListener("click", closeSkipModal);
  document.querySelector("#skipForm").addEventListener("submit", submitSkipTicket);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    loadStaffState().catch(() => {});
    if (!staffSource) connectStaffRealtime();
  });
  await loadStaffState();
  connectStaffRealtime();
}

async function loadStaffState() {
  if (staffLoadInFlight) return staffLoadInFlight;
  staffLoadInFlight = api("/api/staff/state")
    .then(applyStaffState)
    .finally(() => {
      staffLoadInFlight = null;
    });
  return staffLoadInFlight;
}

function connectStaffRealtime() {
  staffSource?.close();
  staffSource = null;
  clearTimeout(staffRealtimeRetryTimer);
  clearInterval(staffPollingTimer);
  staffPollingTimer = null;

  if (typeof EventSource !== "function") {
    startStaffPolling();
    return;
  }

  const source = new EventSource("/api/events?scope=staff");
  staffSource = source;
  source.addEventListener("state", (event) => {
    try {
      applyStaffState(JSON.parse(event.data));
      clearInterval(staffPollingTimer);
      staffPollingTimer = null;
    } catch {
      // A resposta inválida não deve derrubar o painel; o polling assume.
      startStaffPolling();
    }
  });
  source.onerror = () => {
    if (staffSource !== source) return;
    source.close();
    staffSource = null;
    startStaffPolling();
    clearTimeout(staffRealtimeRetryTimer);
    staffRealtimeRetryTimer = setTimeout(connectStaffRealtime, STAFF_POLL_INTERVAL_MS * 2);
  };

}

function startStaffPolling() {
  if (staffPollingTimer) return;
  staffPollingTimer = setInterval(() => {
    if (document.hidden) return;
    loadStaffState().catch(() => {});
  }, STAFF_POLL_INTERVAL_MS);
}

function applyStaffState(nextState) {
  const nextSignature = JSON.stringify(nextState?.sectors || []);
  const previousSignature = JSON.stringify(staffState?.sectors || []);
  staffState = nextState || { sectors: [] };
  if (nextSignature !== previousSignature || !document.querySelector("#attendantSectors article")) {
    renderAttendant();
  }
}

function renderAttendant() {
  document.querySelector("#attendantSectors").innerHTML = staffState.sectors.map((sector) => {
    const waiting = (sector.tickets || []).filter((ticket) => ["aguardando", "proximo", "espera_inteligente", "standby"].includes(ticket.status));
    const recentCalls = sector.recentCalls || [];
    const latestCall = latestRecentCall(recentCalls);
    const callHighlight = isCallHighlightActive(latestCall) ? latestCall : null;
    const isCallingNext = callNextInFlight.has(sector.id);
    const canCallNext = sector.status === "open" && waiting.length > 0 && !isCallingNext;
    const callNextLabel = isCallingNext
      ? "Chamando próxima senha..."
      : "Chamar próxima senha";
    const feedback = callNextFeedback.get(sector.id);
    return `
      <article class="ops-card">
        <div class="ops-card-head">
          <div>
            <strong>${escapeHtml(sector.name)}</strong>
            <span>${escapeHtml(sector.counterLabel)}</span>
          </div>
          <b class="status-pill ${escapeHtml(sector.status)}">${escapeHtml(statusLabel(sector.status))}</b>
        </div>
        <div class="ops-call-panel ${callHighlight ? "call-highlight" : ""} ${callHighlight?.priority ? "priority-current" : ""}">
          <div class="ops-call-panel-topline">
            <span>${callHighlight ? "Última senha chamada" : "Próxima chamada"}</span>
            <b>${waiting.length} ${waiting.length === 1 ? "senha na fila" : "senhas na fila"}</b>
          </div>
          <div class="ops-call-main">
            <strong>${escapeHtml(callHighlight ? supportCode(callHighlight) : "--")}</strong>
            <div>
              <b>${escapeHtml(callHighlight ? displayCustomerName(callHighlight) : "Nenhuma senha em destaque")}</b>
              <small>${escapeHtml(callHighlight ? `Chamada registrada às ${formatClock(callHighlight.createdAt)}` : "A fila está pronta para a próxima chamada")}</small>
            </div>
          </div>
          ${callHighlight ? ticketTypeBadgeMarkup(callHighlight, "priority-large") : ""}
        </div>
        <button class="blue-action ops-call-button" data-call-next="${escapeHtml(sector.id)}" data-online-required ${canCallNext ? "" : "disabled"}>${callNextLabel}</button>
        ${!waiting.length ? `<p class="ops-call-note">Nenhuma senha aguardando neste setor.</p>` : ""}
        ${feedback ? `<p class="ops-action-feedback" role="alert">${escapeHtml(feedback)}</p>` : ""}
        ${ticketSection("Fila", waiting, "ops-queue-section")}
        ${callHistory(recentCalls)}
      </article>
    `;
  }).join("");

  document.querySelectorAll("[data-call-next]").forEach((button) => {
    button.addEventListener("click", () => callNext(button.dataset.callNext));
  });
  scheduleCallHighlightExpiry();
}

function ticketSection(title, tickets, extraClass = "") {
  return `
    <section class="ops-ticket-section ${extraClass}">
      <h2>${title}</h2>
      ${tickets.length ? tickets.map(ticketRow).join("") : `<p class="ops-empty">Nenhuma senha.</p>`}
    </section>
  `;
}

function ticketRow(ticket) {
  return `
    <div class="ops-ticket-row ${ticket.priority ? "priority-ticket" : ""}">
      <div>
        <strong>${escapeHtml(displayCustomerName(ticket))}</strong>
        ${ticketTypeBadgeMarkup(ticket)}
        <span>${escapeHtml(ticket.sector)} - ${escapeHtml(supportCode(ticket))}</span>
        <small>${escapeHtml(ticketDetailLine(ticket))}</small>
      </div>
    </div>
  `;
}

function ticketActions(ticket) {
  return "";
}

function ticketDetailLine(ticket) {
  if (ticket.status === "standby") return `Standby por ausencia - ${formatStandbyTime(ticket)} restantes`;
  if (ticket.position === 1) return "Proxima senha da fila";
  return `${ticket.ahead} pessoas na frente - estimativa ${formatEstimateMinutes(ticket.secondsToCall)}`;
}

function displayCustomerName(ticket) {
  return String(ticket?.customerName || "Cliente").trim() || "Cliente";
}

function supportCode(ticket) {
  if (Number.isFinite(Number(ticket?.ticketNumber))) return `Senha ${String(Number(ticket.ticketNumber)).padStart(3, "0")}`;
  const match = String(ticket?.ticket || "").match(/(\d{3})$/);
  return `Senha ${match ? match[1] : ticket?.ticket || "--"}`;
}

function formatAverageService(sector) {
  const basis = sector.estimateBasedOnRecentServices
    ? `${sector.averageServiceSamples} atendimentos recentes`
    : "media base configurada";
  return `${formatEstimateMinutes(sector.averageServiceSeconds)} (${basis})`;
}

function formatEstimateMinutes(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds) || 0);
  if (seconds < 60) return "menos de 1 min";
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} min`;
}

function formatStandbyTime(ticket) {
  const seconds = Math.max(0, Number(ticket.standbySecondsRemaining) || 0);
  const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
  const rest = String(seconds % 60).padStart(2, "0");
  return `${minutes}:${rest}`;
}

function callHistory(items) {
  return `
    <section class="ops-ticket-section ops-call-history">
      <h2>Últimas chamadas</h2>
      ${items.length ? items.map((item) => `
        <div class="history-row">
          <span>${escapeHtml(item.customerName || "Cliente")} - ${escapeHtml(supportCode(item))} - ${escapeHtml(callActionLabel(item.action))} ${item.action === "senha_chamada" ? escapeHtml(item.priority ? "· preferencial" : "· comum") : ""}</span>
          <b>${escapeHtml(formatClock(item.createdAt))}</b>
        </div>
      `).join("") : `<p class="ops-empty">Nenhum registro recente.</p>`}
    </section>
  `;
}

function callActionLabel(action) {
  if (action === "senha_chamada") return "chamada";
  if (action?.startsWith("senha_pulada:")) return `pulada - ${skipReasonLabel(action.split(":")[1])}`;
  return action || "registro";
}

function skipReasonLabel(reason) {
  return {
    cliente_ausente: "cliente ausente",
    cancelamento: "cancelamento",
    erro_operacional: "erro operacional"
  }[reason] || reason;
}

function priorityIcon() {
  return `
    <svg class="priority-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="4.5" r="2.2"></circle>
      <path d="M12 8v6"></path>
      <path d="M8.5 10.5h7"></path>
      <path d="M9.5 21l2.5-7 2.5 7"></path>
    </svg>
  `;
}

function priorityBadgeMarkup(extraClass = "") {
  return `<em class="priority-badge ${extraClass}">${priorityIcon()}<span>PREFERENCIAL</span></em>`;
}

function ticketTypeBadgeMarkup(ticket, extraClass = "") {
  return ticket?.priority
    ? priorityBadgeMarkup(extraClass)
    : `<em class="ticket-type-badge ${extraClass}">COMUM</em>`;
}

function latestRecentCall(items) {
  return items.find((item) => item.action === "senha_chamada") || null;
}

function isCallHighlightActive(item) {
  if (!item?.createdAt) return false;
  const age = Date.now() - new Date(item.createdAt).getTime();
  return Number.isFinite(age) && age >= 0 && age <= CALL_HIGHLIGHT_DURATION_MS;
}

function scheduleCallHighlightExpiry() {
  clearTimeout(callHighlightExpiryTimer);
  const expiresAt = staffState.sectors
    .flatMap((sector) => (sector.recentCalls || []))
    .filter((item) => item.action === "senha_chamada" && item.createdAt)
    .map((item) => new Date(item.createdAt).getTime() + CALL_HIGHLIGHT_DURATION_MS)
    .filter((value) => Number.isFinite(value) && value > Date.now())
    .sort((left, right) => left - right)[0];
  if (!expiresAt) return;
  const delay = Math.max(50, expiresAt - Date.now() + 50);
  callHighlightExpiryTimer = setTimeout(renderAttendant, delay);
}

async function callNext(sectorId) {
  if (callNextInFlight.has(sectorId)) return;
  callNextInFlight.add(sectorId);
  callNextFeedback.delete(sectorId);
  renderAttendant();
  try {
    const result = await api(`/api/sectors/${encodeURIComponent(sectorId)}/call-next`, { method: "POST" });
    if (result.ticket) {
      applyCalledTicket(sectorId, result.ticket);
      callNextFeedback.delete(sectorId);
    } else if (result.message) {
      callNextFeedback.set(sectorId, result.message);
    }
    void loadStaffState().catch(() => {});
  } catch (error) {
    callNextFeedback.set(sectorId, error.message || "Nao foi possivel chamar a proxima senha.");
    void loadStaffState().catch(() => {});
  } finally {
    callNextInFlight.delete(sectorId);
    renderAttendant();
  }
}

function applyCalledTicket(sectorId, ticket) {
  if (!ticket?.id) return;
  const nextState = {
    ...staffState,
    sectors: staffState.sectors.map((sector) => {
      if (sector.id !== sectorId) return sector;
      const calledTicket = {
        ...ticket,
        sectorId: ticket.sectorId || sector.id,
        sector: ticket.sector || sector.name,
        counterLabel: ticket.counterLabel || sector.counterLabel,
        serviceLabel: ticket.serviceLabel || sector.serviceLabel
      };
      const recentCall = {
        action: "senha_chamada",
        customerName: calledTicket.customerName,
        ticketNumber: calledTicket.ticketNumber,
        ticket: calledTicket.ticket,
        status: calledTicket.status,
        priority: Boolean(calledTicket.priority),
        createdAt: new Date().toISOString()
      };
      return {
        ...sector,
        current: calledTicket.current || calledTicket.ticket || sector.current,
        currentCustomerName: calledTicket.currentCustomerName || calledTicket.customerName || sector.currentCustomerName || "",
        recentCalls: [recentCall, ...(sector.recentCalls || []).filter((item) => item.ticket !== recentCall.ticket || item.action !== "senha_chamada")].slice(0, 6),
        tickets: [calledTicket, ...sector.tickets.filter((item) => item.id !== calledTicket.id)]
      };
    })
  };
  applyStaffState(nextState);
}

async function startTicket(ticketId) {
  await api(`/api/tickets/${ticketId}/confirm`, { method: "POST" });
  await loadStaffState();
}

async function finishTicket(ticketId) {
  await api(`/api/tickets/${ticketId}/finish`, { method: "POST" });
  await loadStaffState();
}

function openSkipModal(ticketId) {
  pendingSkipTicketId = ticketId;
  document.querySelector("#skipForm").reset();
  document.querySelector("#skipModal").hidden = false;
}

function closeSkipModal() {
  pendingSkipTicketId = null;
  document.querySelector("#skipModal").hidden = true;
}

async function submitSkipTicket(event) {
  event.preventDefault();
  if (!pendingSkipTicketId) return;
  const reason = new FormData(event.currentTarget).get("reason");
  if (!reason) return;
  await api(`/api/tickets/${encodeURIComponent(pendingSkipTicketId)}/skip`, {
    method: "POST",
    body: { reason }
  });
  closeSkipModal();
  await loadStaffState();
}

function ticketStatus(ticket) {
  const labels = {
    aguardando: "aguardando",
    proximo: "próxima",
    chamado: "chamada",
    em_atendimento: "em atendimento",
    espera_inteligente: "espera inteligente"
  };
  return labels[ticket.status] || ticket.status;
}

function ticketStatusLabel(status) {
  return {
    aguardando: "Aguardando",
    proximo: "Proximo",
    chamado: "Chamado",
    em_atendimento: "Em atendimento",
    atendido: "Finalizado",
    standby: "Standby",
    cancelado: "Cancelado",
    expirado: "Expirado",
    espera_inteligente: "Espera inteligente"
  }[status] || status || "--";
}

function formatClock(value) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function statusLabel(status) {
  return { open: "Aberto", paused: "Pausado", closed: "Fechado" }[status] || status;
}

async function api(path, options = {}) {
  const method = options.method || "GET";
  const mutation = method !== "GET";
  if (mutation) window.senhaHubPwa?.markCriticalOperation(true);
  try {
    const response = await fetch(path, {
      method,
      headers: {
        "content-type": "application/json",
        ...csrfHeader()
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const payload = await parseApiPayload(response);
    window.senhaHubPwa?.reportNetworkSuccess();
    if (!response.ok || payload.error) throw new Error(payload.error || "Falha na API.");
    return payload;
  } catch (error) {
    window.senhaHubPwa?.reportNetworkFailure();
    throw error;
  } finally {
    if (mutation) window.senhaHubPwa?.markCriticalOperation(false);
  }
}

async function parseApiPayload(response) {
  const text = await response.text();
  if (!text.trim()) return response.ok ? { ok: true } : { error: "Falha na API." };
  try {
    return JSON.parse(text);
  } catch {
    return response.ok ? { ok: true, message: text } : { error: apiTextError(response, text) };
  }
}

function apiTextError(response, text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean && clean.length < 180 && !clean.startsWith("<")) return clean;
  return `Falha na comunicacao com a API (${response.status || "sem status"}). Tente novamente.`;
}

function csrfHeader() {
  const token = getCookie("senhahub_csrf");
  return token ? { "x-csrf-token": token } : {};
}

function getCookie(name) {
  return document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`))
    ?.slice(name.length + 1) || "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function requireSession(roles) {
  const { user } = await api("/api/auth/me");
  if (!user || !roles.includes(user.role)) {
    location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
    throw new Error("Acesso negado.");
  }
  return user;
}

async function logout() {
  await window.senhaHubPwa?.prepareLogout();
  await api("/api/auth/logout", { method: "POST" });
  location.href = "/login";
}
