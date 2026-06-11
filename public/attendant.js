let staffState = { sectors: [] };
let staffSource = null;
let currentUser = null;
let staffPollingTimer = null;
let pendingSkipTicketId = null;

initAttendant();

async function initAttendant() {
  currentUser = await requireSession(["attendant", "manager"]);
  await loadStaffState();
  connectStaffRealtime();
  document.querySelector("#logoutButton").addEventListener("click", logout);
  document.querySelector("#skipCancel").addEventListener("click", closeSkipModal);
  document.querySelector("#skipForm").addEventListener("submit", submitSkipTicket);
}

async function loadStaffState() {
  staffState = await api("/api/staff/state");
  renderAttendant();
}

function connectStaffRealtime() {
  staffSource?.close();
  staffSource = new EventSource("/api/events?scope=staff");
  staffSource.addEventListener("state", (event) => {
    staffState = JSON.parse(event.data);
    renderAttendant();
  });
  staffSource.addEventListener("error", () => startStaffPolling());
  startStaffPolling();
}

function startStaffPolling() {
  if (staffPollingTimer) return;
  staffPollingTimer = setInterval(() => {
    loadStaffState().catch(() => {});
  }, 3000);
}

function renderAttendant() {
  document.querySelector("#attendantSectors").innerHTML = staffState.sectors.map((sector) => {
    const called = sector.tickets.filter((ticket) => ticket.status === "chamado");
    const inService = sector.tickets.filter((ticket) => ticket.status === "em_atendimento");
    const waiting = sector.tickets.filter((ticket) => ["aguardando", "proximo", "espera_inteligente", "standby"].includes(ticket.status));
    const currentTicket = inService[0] || called[0] || null;
    const hasActiveService = called.length > 0 || inService.length > 0;
    const canCallNext = sector.status === "open" && !hasActiveService && waiting.length > 0;
    return `
      <article class="ops-card">
        <div class="ops-card-head">
          <div>
            <strong>${sector.name}</strong>
            <span>${sector.counterLabel}</span>
          </div>
          <b class="status-pill ${sector.status}">${statusLabel(sector.status)}</b>
        </div>
        <div class="ops-metric ${currentTicket?.priority ? "priority-current" : ""}">
          <span>Senha atual</span>
          <strong>${sector.current}</strong>
          <small>${currentTicket ? `${ticketStatusLabel(currentTicket.status)} - ${currentTicket.ticket}` : "Nenhuma senha chamada"}</small>
          ${currentTicket?.priority ? priorityBadgeMarkup("priority-large") : ""}
        </div>
        <div class="ops-sync-line">
          <span>App e balcao sincronizados</span>
          <b>${staffState.serverTime ? formatClock(staffState.serverTime) : "--"}</b>
        </div>
        <div class="ops-estimate-line">
          <span>Tempo medio do setor</span>
          <b>${formatAverageService(sector)}</b>
        </div>
        <button class="blue-action compact-action" data-call-next="${sector.id}" ${canCallNext ? "" : "disabled"}>${hasActiveService ? "Aguardando finalizacao" : "Chamar proxima senha"}</button>
        ${ticketSection("Chamadas", called)}
        ${ticketSection("Em atendimento", inService)}
        ${ticketSection("Fila", waiting)}
        ${callHistory(sector.recentCalls || [])}
      </article>
    `;
  }).join("");

  document.querySelectorAll("[data-call-next]").forEach((button) => {
    button.addEventListener("click", () => callNext(button.dataset.callNext));
  });
  document.querySelectorAll("[data-start-ticket]").forEach((button) => {
    button.addEventListener("click", () => startTicket(button.dataset.startTicket));
  });
  document.querySelectorAll("[data-finish-ticket]").forEach((button) => {
    button.addEventListener("click", () => finishTicket(button.dataset.finishTicket));
  });
  document.querySelectorAll("[data-skip-ticket]").forEach((button) => {
    button.addEventListener("click", () => openSkipModal(button.dataset.skipTicket));
  });
}

function ticketSection(title, tickets) {
  return `
    <section class="ops-ticket-section">
      <h2>${title}</h2>
      ${tickets.length ? tickets.map(ticketRow).join("") : `<p class="ops-empty">Nenhuma senha.</p>`}
    </section>
  `;
}

function ticketRow(ticket) {
  return `
    <div class="ops-ticket-row ${ticket.priority ? "priority-ticket" : ""}">
      <div>
        <strong>${ticket.ticket}</strong>
        ${ticket.priority ? priorityBadgeMarkup() : ""}
        <span>${ticket.sector} - ${ticketStatusLabel(ticket.status)}</span>
        <small>${ticketDetailLine(ticket)}</small>
      </div>
      ${ticketActions(ticket)}
    </div>
  `;
}

function ticketActions(ticket) {
  if (ticket.status === "chamado") {
    return `<div class="ops-ticket-actions"><button data-start-ticket="${ticket.id}">Iniciar</button><button class="danger-action" data-skip-ticket="${ticket.id}">Pular</button></div>`;
  }
  if (ticket.status === "em_atendimento") return `<button data-finish-ticket="${ticket.id}">Finalizar</button>`;
  return `<div class="ops-ticket-actions"><small>${ticket.position}º</small><button class="danger-action" data-skip-ticket="${ticket.id}">Pular</button></div>`;
}

function ticketDetailLine(ticket) {
  if (ticket.status === "chamado" || ticket.status === "em_atendimento") return "Atendimento atual no balcao";
  if (ticket.status === "standby") return `Standby por ausencia - ${formatStandbyTime(ticket)} restantes`;
  if (ticket.position === 1) return "Proxima senha da fila";
  return `${ticket.ahead} pessoas na frente - estimativa ${formatEstimateMinutes(ticket.secondsToCall)}`;
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
    <section class="ops-ticket-section call-history">
      <h2>Ultimas chamadas</h2>
      ${items.length ? items.map((item) => `
        <div class="history-row">
          <span>${item.ticket} - ${callActionLabel(item.action)}</span>
          <b>${formatClock(item.createdAt)}</b>
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

async function callNext(sectorId) {
  await api(`/api/sectors/${sectorId}/call-next`, { method: "POST" });
  await loadStaffState();
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
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: {
      "content-type": "application/json",
      ...csrfHeader()
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({ error: "Backend indisponivel." }));
  if (!response.ok || payload.error) throw new Error(payload.error || "Falha na API.");
  return payload;
}

function csrfHeader() {
  const token = getCookie("fz_csrf");
  return token ? { "x-csrf-token": token } : {};
}

function getCookie(name) {
  return document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`))
    ?.slice(name.length + 1) || "";
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
  await api("/api/auth/logout", { method: "POST" });
  location.href = "/login";
}
