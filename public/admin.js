let adminState = { sectors: [] };
let adminUsers = [];
let adminMetrics = { sectors: [], satisfaction: { count: 0, average: 0 } };
let adminSource = null;
let currentUser = null;

initAdmin();

async function initAdmin() {
  currentUser = await requireSession(["manager"]);
  await loadAdminState();
  await loadMetrics();
  await loadUsers();
  connectAdminRealtime();
  document.querySelector("#logoutButton").addEventListener("click", logout);
  document.querySelector("#userForm").addEventListener("submit", createUser);
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
    await loadMetrics();
  });
}

function renderAdmin() {
  document.querySelector("#adminSectors").innerHTML = adminState.sectors.map((sector) => `
    <form class="ops-card admin-form" data-sector-form="${sector.id}">
      <div class="ops-card-head">
        <div>
          <strong>${sector.name}</strong>
          <span>${sector.id}</span>
        </div>
        <b class="status-pill ${sector.status}">${statusLabel(sector.status)}</b>
      </div>
      <label>Nome do setor<input name="name" value="${sector.name}" /></label>
      <label>Balcão<input name="counterLabel" value="${sector.counterLabel}" /></label>
      <label>Descrição<input name="serviceLabel" value="${sector.serviceLabel}" /></label>
      <div class="form-grid">
        <label>Fila base<input type="number" name="queueSize" min="1" value="${sector.queueSize}" /></label>
        <label>Tempo médio<input type="number" name="averageServiceSeconds" min="1" value="${sector.averageServiceSeconds}" /></label>
        <label>Capacidade<input type="number" name="capacity" min="1" value="${sector.capacity}" /></label>
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
  `).join("");

  document.querySelectorAll("[data-sector-form]").forEach((form) => {
    form.addEventListener("submit", saveSector);
  });
}

function renderMetrics() {
  document.querySelector("#adminMetrics").innerHTML = [
    ...adminMetrics.sectors.map((sector) => `
      <article class="ops-card">
        <div class="ops-card-head">
          <div>
            <strong>${sector.name}</strong>
            <span>${sector.finished} atendimentos finalizados</span>
          </div>
        </div>
        <div class="ops-metric"><span>Tempo médio</span><strong>${sector.avgServiceSeconds}s</strong></div>
        <div class="ops-metric"><span>Espera inteligente</span><strong>${sector.avgSmartWaitSeconds}s</strong></div>
        <p class="ops-empty">Abandono: ${sector.abandoned}</p>
      </article>
    `),
    `<article class="ops-card">
      <div class="ops-card-head"><div><strong>Satisfação</strong><span>${adminMetrics.satisfaction.count} avaliações</span></div></div>
      <div class="ops-metric"><span>Média</span><strong>${adminMetrics.satisfaction.average}</strong></div>
    </article>`
  ].join("");
}

function renderUsers() {
  document.querySelector("#adminUsers").innerHTML = adminUsers.map((user) => `
    <article class="ops-card">
      <div class="ops-card-head">
        <div>
          <strong>${user.name}</strong>
          <span>${user.email}</span>
        </div>
        <b class="status-pill">${roleLabel(user.role)}</b>
      </div>
      <p class="ops-empty">${user.sectorIds.length ? `Setores: ${user.sectorIds.join(", ")}` : "Acesso global ou sem setor específico."}</p>
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

function roleLabel(role) {
  return { customer: "Cliente", attendant: "Funcionário", manager: "Gestor", admin: "Gestor" }[role] || role;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: { "content-type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error || "Falha na API.");
  return payload;
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
