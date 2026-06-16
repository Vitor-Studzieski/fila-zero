let adminState = { sectors: [] };
let adminUsers = [];
let adminMetrics = { sectors: [], satisfaction: { count: 0, average: 0 } };
let adminSource = null;
let currentUser = null;
let adminPollingTimer = null;

initAdmin();

async function initAdmin() {
  currentUser = await requireSession(["manager"]);
  document.querySelector("#logoutButton").addEventListener("click", logout);
  document.querySelector("#userForm").addEventListener("submit", createUser);
  await Promise.all([loadAdminState(), loadMetrics(), loadUsers()]);
  connectAdminRealtime();
}

async function loadAdminState() {
  adminState = await api("/api/staff/state");
  renderAdmin();
}

async function loadUsers() {
  if (!["manager", "admin"].includes(currentUser.role)) {
    document.querySelector(".ops-users").style.display = "none";
    return;
  }
  const result = await api("/api/users");
  adminUsers = result.users;
  renderUsers();
}

async function loadMetrics() {
  adminMetrics = await api("/api/metrics");
  renderMetrics();
}

function connectAdminRealtime() {
  adminSource?.close();
  adminSource = new EventSource("/api/events?scope=staff");
  adminSource.addEventListener("state", async (event) => {
    adminState = JSON.parse(event.data);
    renderAdmin();
    scheduleMetricsRefresh();
  });
  adminSource.addEventListener("error", () => startAdminPolling());
}

function startAdminPolling() {
  if (adminPollingTimer) return;
  adminPollingTimer = setInterval(async () => {
    try {
      await loadAdminState();
      await loadMetrics();
    } catch {}
  }, 10000);
}

function scheduleMetricsRefresh() {
  clearTimeout(scheduleMetricsRefresh.timer);
  scheduleMetricsRefresh.timer = setTimeout(() => {
    loadMetrics().catch(() => {});
  }, 700);
}

function renderAdmin() {
  document.querySelector("#adminSectors").innerHTML = adminState.sectors.map((sector) => {
    const called = sector.tickets.filter((ticket) => ticket.status === "chamado");
    const inService = sector.tickets.filter((ticket) => ticket.status === "em_atendimento");
    const waiting = sector.tickets.filter((ticket) => ["aguardando", "proximo", "espera_inteligente", "standby"].includes(ticket.status));
    const currentTicket = inService[0] || called[0] || null;
    return `
      <form class="ops-card admin-form" data-sector-form="${escapeHtml(sector.id)}">
        <div class="ops-card-head">
          <div>
            <strong>${escapeHtml(sector.name)}</strong>
            <span>${escapeHtml(sector.id)}</span>
          </div>
          <b class="status-pill ${escapeHtml(sector.status)}">${escapeHtml(statusLabel(sector.status))}</b>
        </div>
        <div class="ops-metric ${currentTicket?.priority ? "priority-current" : ""}">
          <span>Senha atual</span>
          <strong>${escapeHtml(sector.current)}</strong>
          ${currentTicket?.priority ? priorityBadgeMarkup("priority-large") : ""}
        </div>
        ${ticketSection("Chamadas", called)}
        ${ticketSection("Em atendimento", inService)}
        ${ticketSection("Fila", waiting)}
        <label>Nome do setor<input name="name" value="${escapeHtml(sector.name)}" /></label>
        <label>Balcão<input name="counterLabel" value="${escapeHtml(sector.counterLabel)}" /></label>
        <label>Descrição<input name="serviceLabel" value="${escapeHtml(sector.serviceLabel)}" /></label>
        <div class="form-grid">
          <label>Fila base<input type="number" name="queueSize" min="1" value="${escapeHtml(sector.queueSize)}" /></label>
          <label>Tempo médio<input type="number" name="averageServiceSeconds" min="1" value="${escapeHtml(sector.averageServiceSeconds)}" /></label>
          <label>Capacidade<input type="number" name="capacity" min="1" value="${escapeHtml(sector.capacity)}" /></label>
        </div>
        <label>Status
          <select name="status">
            <option value="open" ${sector.status === "open" ? "selected" : ""}>Aberto</option>
            <option value="paused" ${sector.status === "paused" ? "selected" : ""}>Pausado</option>
            <option value="closed" ${sector.status === "closed" ? "selected" : ""}>Fechado</option>
          </select>
        </label>
        <button class="blue-action compact-action">Salvar setor</button>
      </form>
    `;
  }).join("");

  document.querySelectorAll("[data-sector-form]").forEach((form) => {
    form.addEventListener("submit", saveSector);
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
        <strong>${escapeHtml(ticket.ticket)}</strong>
        ${ticket.priority ? priorityBadgeMarkup() : ""}
        <span>${escapeHtml(ticket.sector)} - ${escapeHtml(ticketStatus(ticket))}</span>
      </div>
      <small>${escapeHtml(ticket.status === "em_atendimento" ? "Agora" : `${ticket.position}º`)}</small>
    </div>
  `;
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

function renderMetrics() {
  document.querySelector("#adminMetrics").innerHTML = [
    ...adminMetrics.sectors.map((sector) => `
      <article class="ops-card">
        <div class="ops-card-head">
          <div>
            <strong>${escapeHtml(sector.name)}</strong>
            <span>${escapeHtml(sector.finished)} atendimentos finalizados</span>
          </div>
        </div>
        <div class="ops-metric"><span>Tempo médio</span><strong>${escapeHtml(sector.avgServiceSeconds)}s</strong></div>
        <div class="ops-metric"><span>Espera inteligente</span><strong>${escapeHtml(sector.avgSmartWaitSeconds)}s</strong></div>
        <p class="ops-empty">Abandono: ${escapeHtml(sector.abandoned)}</p>
      </article>
    `),
    `<article class="ops-card">
      <div class="ops-card-head"><div><strong>Satisfação</strong><span>${escapeHtml(adminMetrics.satisfaction.count)} avaliações</span></div></div>
      <div class="ops-metric"><span>Média</span><strong>${escapeHtml(adminMetrics.satisfaction.average)}</strong></div>
    </article>`
  ].join("");
}

function renderUsers() {
  document.querySelector("#adminUsers").innerHTML = adminUsers.map((user) => `
    <article class="ops-card">
      <div class="ops-card-head">
        <div>
          <strong>${escapeHtml(user.name)}</strong>
          <span>${escapeHtml(user.email)}</span>
        </div>
        <b class="status-pill">${escapeHtml(roleLabel(user.role))}</b>
      </div>
      <p class="ops-empty">${user.sectorIds.length ? `Setores: ${escapeHtml(user.sectorIds.join(", "))}` : "Acesso global ou sem setor específico."}</p>
    </article>
  `).join("");
}

async function saveSector(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  data.queueSize = Number(data.queueSize);
  data.averageServiceSeconds = Number(data.averageServiceSeconds);
  data.capacity = Number(data.capacity);
  await api(`/api/sectors/${form.dataset.sectorForm}`, {
    method: "PUT",
    body: data
  });
  await loadAdminState();
}

async function createUser(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  data.sectorIds = new FormData(form).getAll("sectorIds");
  await api("/api/users", {
    method: "POST",
    body: data
  });
  form.reset();
  await loadUsers();
}

function statusLabel(status) {
  return { open: "Aberto", paused: "Pausado", closed: "Fechado" }[status] || status;
}

function ticketStatus(ticket) {
  const labels = {
    aguardando: "aguardando",
    proximo: "proxima",
    chamado: "chamada",
    em_atendimento: "em atendimento",
    espera_inteligente: "espera inteligente"
  };
  return labels[ticket.status] || ticket.status;
}

function roleLabel(role) {
  return { customer: "Cliente", attendant: "Funcionário", manager: "Gestor", admin: "Gestor" }[role] || role;
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
  await api("/api/auth/logout", { method: "POST" });
  location.href = "/login";
}
