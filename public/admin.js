let adminState = { sectors: [] };
let adminUsers = [];
let adminMetrics = { sectors: [], satisfaction: { count: 0, average: 0 } };
let currentUser = null;

initAdmin();

async function initAdmin() {
  currentUser = await requireSession(["manager", "admin"]);
  document.querySelector("#logoutButton")?.addEventListener("click", logout);
  document.querySelectorAll(".manager-nav a").forEach((link) => {
    link.addEventListener("click", () => {
      document.querySelectorAll(".manager-nav a").forEach((item) => item.classList.remove("active"));
      link.classList.add("active");
    });
  });
  document.querySelector("#userForm")?.addEventListener("submit", createUser);
  document.querySelector("#userRole")?.addEventListener("change", updateUserRoleFields);
  updateUserRoleFields();
  document.querySelector("#sectorFilter")?.addEventListener("change", renderQueueTable);
  document.querySelector("#statusFilter")?.addEventListener("change", renderQueueTable);
  document.querySelector("#refreshDashboardButton")?.addEventListener("click", refreshDashboard);
  const metricsDateInput = document.querySelector("#metricsDate");
  if (metricsDateInput) {
    metricsDateInput.value = businessToday();
    metricsDateInput.addEventListener("change", () => loadMetrics().catch(() => {}));
  }
  try {
    const requests = [];
    if (needsAdminState()) requests.push(loadAdminState());
    if (needsAdminMetrics()) requests.push(loadMetrics());
    if (document.querySelector("#adminUsers")) requests.push(loadUsers());
    await Promise.all(requests);
  } catch (error) {
    const alerts = document.querySelector("#dashboardAlerts");
    if (alerts) {
      alerts.innerHTML = `<div class="manager-alert manager-alert-attention"><span class="manager-alert-mark">!</span><div><strong>Não foi possível carregar todos os dados</strong><p>Tente atualizar o painel novamente. ${escapeHtml(error.message || "Erro de comunicação")}</p></div></div>`;
    }
  }
}

async function refreshDashboard() {
  const requests = [];
  if (needsAdminState()) requests.push(loadAdminState());
  if (needsAdminMetrics()) requests.push(loadMetrics());
  await Promise.all(requests);
}

function needsAdminState() {
  return Boolean(document.querySelector("#dashboardKpis, #queueTable, #adminSectors"));
}

function needsAdminMetrics() {
  return Boolean(document.querySelector("#dashboardKpis"));
}

async function loadAdminState() {
  adminState = await api("/api/staff/state");
  renderAdmin();
  renderDashboard();
}

async function loadUsers() {
  if (!document.querySelector("#adminUsers")) return;
  if (!["manager", "admin"].includes(currentUser.role)) {
    document.querySelector("#usuarios")?.closest(".manager-section-title")?.setAttribute("hidden", "");
    return;
  }
  const result = await api("/api/users");
  adminUsers = result.users;
  renderUsers();
}

async function loadMetrics() {
  const selectedDate = document.querySelector("#metricsDate")?.value || businessToday();
  adminMetrics = await api(`/api/metrics?date=${encodeURIComponent(selectedDate)}`);
  renderAdmin();
  renderDashboard();
}

function renderAdmin() {
  renderSectorFilter();
  renderQueueTable();
  const sectorGrid = document.querySelector("#adminSectors");
  if (!sectorGrid) return;
  sectorGrid.innerHTML = adminState.sectors.map((sector) => {
    const snapshot = sectorSnapshot(sector);
    const metric = snapshot.metric;
    const settings = timeParts(sector.averageServiceSeconds);
    return `
      <article class="manager-sector-card">
        <div class="manager-sector-head">
          <div>
            <strong>${escapeHtml(sector.name)}</strong>
            <span>${escapeHtml(sector.counterLabel || sector.id)}</span>
          </div>
          <b class="manager-badge ${sector.status === "open" ? "success" : sector.status === "paused" ? "warn" : "danger"}">${escapeHtml(statusLabel(sector.status))}</b>
        </div>
        <div class="manager-sector-metrics">
          <div><span>Fila</span><strong>${escapeHtml(snapshot.waiting.length)}</strong></div>
          <div><span>Atual</span><strong>${escapeHtml(snapshot.currentTicket ? supportCode(snapshot.currentTicket).replace("Senha ", "") : "--")}</strong></div>
          <div><span>Atendimento médio</span><strong>${escapeHtml(formatMinutesSeconds(metric.avgServiceSeconds || sector.averageServiceSeconds))}</strong></div>
        </div>
        <div class="manager-progress" aria-label="${escapeHtml(snapshot.load)}% da capacidade ocupada"><span style="width:${escapeHtml(snapshot.load)}%"></span></div>
        <div class="manager-sector-load"><span>${escapeHtml(snapshot.load)}% da capacidade da fila</span><b>${escapeHtml(snapshot.waiting.length)} aguardando</b></div>
        <p class="manager-sector-current">${escapeHtml(snapshot.currentTicket ? `${displayCustomerName(snapshot.currentTicket)} - ${ticketStatus(snapshot.currentTicket)}` : "Nenhuma chamada ativa")}</p>
        <details class="manager-sector-settings">
          <summary>Editar configuração</summary>
          <form class="manager-form" data-sector-form="${escapeHtml(sector.id)}" data-online-required>
            <label>Nome do setor<input name="name" value="${escapeHtml(sector.name)}" /></label>
            <label>Balcão<input name="counterLabel" value="${escapeHtml(sector.counterLabel)}" /></label>
            <label>Descrição<input name="serviceLabel" value="${escapeHtml(sector.serviceLabel)}" /></label>
            <div class="manager-form-row">
              <label>Fila base<input type="number" name="queueSize" min="1" value="${escapeHtml(sector.queueSize)}" /></label>
              <label>Tempo médio (min)<input type="number" name="averageServiceMinutes" min="0" value="${escapeHtml(settings.minutes)}" /></label>
              <label>Tempo médio (seg)<input type="number" name="averageServiceRestSeconds" min="0" max="59" value="${escapeHtml(settings.seconds)}" /></label>
              <label>Capacidade<input type="number" name="capacity" min="1" value="${escapeHtml(sector.capacity)}" /></label>
            </div>
            <label>Status
              <select name="status">
                <option value="open" ${sector.status === "open" ? "selected" : ""}>Aberto</option>
                <option value="paused" ${sector.status === "paused" ? "selected" : ""}>Pausado</option>
                <option value="closed" ${sector.status === "closed" ? "selected" : ""}>Fechado</option>
              </select>
            </label>
            <button class="manager-button" type="submit">Salvar setor</button>
          </form>
        </details>
      </article>
    `;
  }).join("");

  document.querySelectorAll("[data-sector-form]").forEach((form) => {
    form.addEventListener("submit", saveSector);
  });
}

function renderSectorFilter() {
  const filter = document.querySelector("#sectorFilter");
  if (!filter) return;
  const current = filter.value;
  filter.innerHTML = [
    `<option value="">Todos os setores</option>`,
    ...adminState.sectors.map((sector) => `<option value="${escapeHtml(sector.id)}">${escapeHtml(sector.name)}</option>`)
  ].join("");
  filter.value = current;
}

function renderQueueTable() {
  const table = document.querySelector("#queueTable");
  if (!table) return;
  const sectorFilter = document.querySelector("#sectorFilter")?.value || "";
  const statusFilter = document.querySelector("#statusFilter")?.value || "";
  const rows = adminState.sectors
    .flatMap((sector) => (sector.tickets || []).map((ticket) => ({ ...ticket, sectorId: sector.id, sectorName: sector.name })))
    .filter((ticket) => !sectorFilter || ticket.sectorId === sectorFilter)
    .filter((ticket) => !statusFilter || ticket.status === statusFilter);
  const statusOrder = { chamado: 0, em_atendimento: 1, proximo: 2, aguardando: 3, standby: 4, espera_inteligente: 5 };
  rows.sort((left, right) => (statusOrder[left.status] ?? 9) - (statusOrder[right.status] ?? 9)
    || Number(right.priority) - Number(left.priority)
    || Number(left.position || 999) - Number(right.position || 999));
  document.querySelector("#queueCount").textContent = `${rows.length} ${rows.length === 1 ? "registro" : "registros"}`;
  table.innerHTML = rows.length ? rows.map(queueRow).join("") : `
    <tr><td colspan="6" class="manager-empty-cell">Nenhuma senha ativa com os filtros selecionados.</td></tr>
  `;
}

function queueRow(ticket) {
  return `
    <tr>
      <td><div class="manager-person"><span>${escapeHtml(initials(displayCustomerName(ticket)))}</span><div><strong>${escapeHtml(displayCustomerName(ticket))}</strong><small>${escapeHtml(ticket.priority ? "Atendimento preferencial" : "Cliente")}</small></div></div></td>
      <td>${escapeHtml(ticket.sectorName || ticket.sector)}</td>
      <td>${escapeHtml(supportCode(ticket))}</td>
      <td><span class="manager-badge ${ticket.status === "em_atendimento" ? "success" : ticket.status === "standby" ? "warn" : "neutral"}">${escapeHtml(ticketStatus(ticket))}</span></td>
      <td>${ticket.priority ? `<span class="manager-badge danger">Preferencial</span><small class="manager-cell-note">${escapeHtml(priorityReasonLabel(ticket.priorityReason))}</small>` : `<span class="manager-badge neutral">Normal</span>`}</td>
      <td>${escapeHtml(ticket.status === "em_atendimento" ? "Agora" : `${ticket.position || 1}º`)}</td>
    </tr>
  `;
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
        <strong>${escapeHtml(displayCustomerName(ticket))}</strong>
        ${ticket.priority ? priorityBadgeMarkup() : ""}
        <span>${escapeHtml(ticket.sector)} - ${escapeHtml(ticketStatus(ticket))} - ${escapeHtml(supportCode(ticket))}</span>
      </div>
      <small>${escapeHtml(ticket.status === "em_atendimento" ? "Agora" : `${ticket.position}º`)}</small>
    </div>
  `;
}

function displayCustomerName(ticket) {
  return String(ticket?.customerName || "Cliente").trim() || "Cliente";
}

function supportCode(ticket) {
  if (Number.isFinite(Number(ticket?.ticketNumber))) return `Senha ${String(Number(ticket.ticketNumber)).padStart(3, "0")}`;
  const match = String(ticket?.ticket || "").match(/(\d{3})$/);
  return `Senha ${match ? match[1] : ticket?.ticket || "--"}`;
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

function renderDashboard() {
  if (!document.querySelector("#dashboardKpis")) return;
  const summary = dashboardSummary();
  const health = dashboardHealth(summary);
  const openSectors = adminState.sectors.filter((sector) => sector.status === "open").length;

  setText("#heroOpenSectors", openSectors);
  setText("#heroActiveCalls", summary.called);
  setText("#heroCriticalSector", summary.criticalSector || "nenhum");
  setText("#heroHeadline", health.headline);
  setText("#heroDescription", health.detail);
  setText("#heroStatus", health.label);
  setText("#heroAverageTime", formatMinutesSeconds(summary.avgServiceSeconds));
  setText("#heroWaitingCustomers", summary.waiting);
  setText("#heroSyncTime", new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
  document.querySelector("#healthDot")?.classList.toggle("attention", health.status === "attention");

  document.querySelector("#dashboardKpis").innerHTML = [
    dashboardKpi("Fila atual", summary.waiting, "senhas aguardando", summary.overloaded.length ? "atenção" : "normal"),
    dashboardKpi("Em atendimento", summary.called, "chamadas ativas", summary.called ? "agora" : "livre"),
    dashboardKpi("Senhas do dia", summary.issued, "emitidas na data", adminMetrics.date || "hoje"),
    dashboardKpi("Tempo de atendimento", formatMinutesSeconds(summary.avgServiceSeconds), "média registrada", "histórico"),
    dashboardKpi("Satisfação", satisfactionValue(), `${adminMetrics.satisfaction.count || 0} avaliações`, "experiência")
  ].join("");

  document.querySelector("#dashboardAlerts").innerHTML = operationalAlerts(summary);

  const sectorRows = adminState.sectors.map(sectorSnapshot).sort((left, right) => right.load - left.load || right.waiting.length - left.waiting.length);
  document.querySelector("#dashboardOperations").innerHTML = sectorRows.length
    ? sectorRows.map((sector) => operationBar(sector)).join("")
    : `<p class="manager-empty">Aguardando dados dos setores.</p>`;
}

function dashboardSummary() {
  const activeTickets = adminState.sectors.flatMap((sector) => sector.tickets || []);
  const waiting = activeTickets.filter((ticket) => ["aguardando", "proximo", "espera_inteligente", "standby"].includes(ticket.status)).length;
  const called = activeTickets.filter((ticket) => ["chamado", "em_atendimento"].includes(ticket.status)).length;
  const issued = adminMetrics.sectors.reduce((sum, sector) => sum + Number(sector.issued || 0), 0);
  const finished = adminMetrics.sectors.reduce((sum, sector) => sum + Number(sector.finished || 0), 0);
  const abandoned = adminMetrics.sectors.reduce((sum, sector) => sum + Number(sector.abandoned || 0), 0);
  const avgServiceSeconds = averageNumber(adminMetrics.sectors.map((sector) => Number(sector.avgServiceSeconds || 0)));
  const sectors = adminState.sectors.map(sectorSnapshot);
  const overloaded = sectors.filter((sector) => sector.load >= 100 || (sector.status === "open" && sector.waiting.length > 8));
  const critical = [...sectors].sort((left, right) => right.load - left.load || right.waiting.length - left.waiting.length)[0];
  return {
    waiting,
    called,
    issued,
    finished,
    abandoned,
    avgServiceSeconds,
    overloaded,
    criticalSector: critical?.name || ""
  };
}

function dashboardHealth(summary) {
  if (summary.overloaded.length) {
    return {
      label: "Atenção operacional",
      status: "attention",
      headline: "Há setores pedindo atenção.",
      detail: `${summary.overloaded.map((sector) => sector.name).join(", ")} está com a fila acima do nível recomendado.`
    };
  }
  if (summary.called || summary.waiting) {
    return {
      label: "Operação estável",
      status: "good",
      headline: "A operação está em andamento.",
      detail: "As filas estão sendo acompanhadas e os atendimentos ativos aparecem na sequência operacional."
    };
  }
  return {
    label: "Aguardando movimento",
    status: "neutral",
    headline: "A operação está tranquila.",
    detail: "Ainda não há senhas ativas. Os indicadores serão atualizados quando a fila receber movimento."
  };
}

function dashboardKpi(label, value, detail, trend = "") {
  return `
    <article class="manager-kpi">
      <div><span>${escapeHtml(label)}</span><em>${escapeHtml(trend)}</em></div>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail)}</small>
    </article>
  `;
}

function operationBar(sector) {
  const value = Number(sector.metric.avgServiceSeconds || sector.averageServiceSeconds || 0);
  const width = Math.max(4, Math.min(100, Math.round(sector.load)));
  return `
    <article class="manager-bar-row">
      <div>
        <strong>${escapeHtml(sector.name)}</strong>
        <span>${escapeHtml(sector.waiting.length)} aguardando · ${escapeHtml(sector.currentTicket ? `atual ${supportCode(sector.currentTicket).replace("Senha ", "")}` : "sem chamada")}</span>
      </div>
      <b>${escapeHtml(formatMinutesSeconds(value))}</b>
      <i><em style="width:${escapeHtml(width)}%"></em></i>
    </article>
  `;
}

function sectorSnapshot(sector) {
  const tickets = Array.isArray(sector?.tickets) ? sector.tickets : [];
  const waiting = tickets.filter((ticket) => ["aguardando", "proximo", "espera_inteligente", "standby"].includes(ticket.status));
  const called = tickets.filter((ticket) => ["chamado", "em_atendimento"].includes(ticket.status));
  const currentTicket = called.find((ticket) => ticket.status === "em_atendimento") || called[0] || null;
  const metric = adminMetrics.sectors.find((item) => item.id === sector.id) || {};
  const capacity = Math.max(1, Number(sector.capacity || 1));
  const load = Math.min(100, Math.round((waiting.length / capacity) * 100));
  return { ...sector, tickets, waiting, called, currentTicket, metric, capacity, load };
}

function operationalAlerts(summary) {
  const alerts = [];
  summary.overloaded.forEach((sector) => {
    alerts.push({
      tone: "attention",
      title: `${sector.name}: fila acima do recomendado`,
      detail: `${sector.waiting.length} senhas aguardando para uma capacidade configurada de ${sector.capacity}.`
    });
  });
  adminState.sectors.filter((sector) => sector.status !== "open").forEach((sector) => {
    alerts.push({
      tone: sector.status === "paused" ? "warning" : "neutral",
      title: `${sector.name}: setor ${statusLabel(sector.status).toLowerCase()}`,
      detail: "Confira a configuração do setor antes de liberar novas senhas."
    });
  });
  if (!alerts.length) {
    return `<div class="manager-alert manager-alert-good"><span class="manager-alert-mark">✓</span><div><strong>Nenhum alerta operacional</strong><p>Não há filas acima do nível configurado neste momento.</p></div></div>`;
  }
  return alerts.slice(0, 4).map((alert) => `
    <div class="manager-alert manager-alert-${escapeHtml(alert.tone)}">
      <span class="manager-alert-mark">!</span>
      <div><strong>${escapeHtml(alert.title)}</strong><p>${escapeHtml(alert.detail)}</p></div>
    </div>
  `).join("");
}

function satisfactionValue() {
  const value = adminMetrics.satisfaction?.average;
  return value && value !== "sem avaliações" ? String(value) : "--";
}

function averageNumber(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return 0;
  return Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length);
}

function formatMinutesSeconds(totalSeconds) {
  const safeSeconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  if (!minutes && !seconds) return "0 min 0 s";
  if (!minutes) return `${seconds} s`;
  return `${minutes} min ${seconds} s`;
}

function timeParts(totalSeconds) {
  const safeSeconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  return {
    minutes: Math.floor(safeSeconds / 60),
    seconds: safeSeconds % 60
  };
}

function renderUsers() {
  if (!document.querySelector("#adminUsers")) return;
  document.querySelector("#adminUsers").innerHTML = adminUsers.map((user) => `
    <article class="manager-user-row">
      <div class="manager-person">
        <span>${escapeHtml(initials(user.name))}</span>
        <div>
          <strong>${escapeHtml(user.name)}</strong>
          <small>${escapeHtml(user.email)}</small>
          <small>${user.sectorIds.length ? `Setores: ${escapeHtml(user.sectorIds.join(", "))}` : "Acesso global ou sem setor específico."}</small>
        </div>
      </div>
      <b class="manager-badge neutral">${escapeHtml(roleLabel(user.role))}</b>
    </article>
  `).join("");
}

function updateUserRoleFields() {
  const role = document.querySelector("#userRole")?.value || "";
  const permissions = document.querySelector("#userSectorPermissions");
  if (!permissions) return;
  const restricted = ["tablet", "tv"].includes(role);
  permissions.hidden = restricted;
  permissions.querySelectorAll("input[name=sectorIds]").forEach((input) => {
    input.disabled = restricted;
    if (restricted) input.checked = false;
  });
}

async function saveSector(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  data.queueSize = Number(data.queueSize);
  data.averageServiceSeconds = Math.max(1, (Number(data.averageServiceMinutes || 0) * 60) + Number(data.averageServiceRestSeconds || 0));
  delete data.averageServiceMinutes;
  delete data.averageServiceRestSeconds;
  data.capacity = Number(data.capacity);
  await api(`/api/sectors/${form.dataset.sectorForm}`, {
    method: "PUT",
    body: data
  });
  const requests = [loadAdminState()];
  if (needsAdminMetrics()) requests.push(loadMetrics());
  await Promise.all(requests);
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
    standby: "standby",
    espera_inteligente: "espera inteligente"
  };
  return labels[ticket.status] || ticket.status;
}

function priorityReasonLabel(value) {
  const labels = {
    deficiencia_ou_mobilidade_reduzida: "Mobilidade reduzida",
    tea: "TEA",
    idoso_60_mais: "Idoso 60+",
    gestante_ou_lactante: "Gestante ou lactante",
    crianca_de_colo: "Criança de colo",
    obesidade: "Obesidade"
  };
  return labels[value] || value || "Categoria não informada";
}

function roleLabel(role) {
  return { customer: "Cliente", attendant: "Funcionário", manager: "Gestor", admin: "Gestor", tablet: "Tablet", tv: "TV · Açougue" }[role] || role;
}

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

function initials(value) {
  const parts = String(value || "Cliente").trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || "C").concat(parts[1]?.[0] || "").toUpperCase();
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

function businessToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
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
