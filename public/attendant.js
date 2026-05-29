let staffState = { sectors: [] };
let staffSource = null;
let currentUser = null;
let staffPollingTimer = null;

initAttendant();

async function initAttendant() {
  currentUser = await requireSession(["attendant", "manager"]);
  await loadStaffState();
  connectStaffRealtime();
  document.querySelector("#logoutButton").addEventListener("click", logout);
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
    const waiting = sector.tickets.filter((ticket) => ["aguardando", "proximo", "espera_inteligente"].includes(ticket.status));
    return `
      <article class="ops-card">
        <div class="ops-card-head">
          <div>
            <strong>${sector.name}</strong>
            <span>${sector.counterLabel}</span>
          </div>
          <b class="status-pill ${sector.status}">${statusLabel(sector.status)}</b>
        </div>
        <div class="ops-metric">
          <span>Senha atual</span>
          <strong>${sector.current}</strong>
        </div>
        <button class="blue-action compact-action" data-call-next="${sector.id}" ${sector.status !== "open" ? "disabled" : ""}>Chamar próxima senha</button>
        ${ticketSection("Chamadas", called)}
        ${ticketSection("Em atendimento", inService)}
        ${ticketSection("Fila", waiting)}
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
    <div class="ops-ticket-row">
      <div>
        <strong>${ticket.ticket}</strong>
        <span>${ticket.sector} - ${ticketStatus(ticket)}</span>
      </div>
      ${ticketActions(ticket)}
    </div>
  `;
}

function ticketActions(ticket) {
  if (ticket.status === "chamado") return `<button data-start-ticket="${ticket.id}">Iniciar</button>`;
  if (ticket.status === "em_atendimento") return `<button data-finish-ticket="${ticket.id}">Finalizar</button>`;
  return `<small>${ticket.position}º</small>`;
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
