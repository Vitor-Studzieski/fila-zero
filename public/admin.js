let adminState = { sectors: [] };
let adminUsers = [];
let adminMetrics = { sectors: [], satisfaction: { count: 0, average: 0 } };
let offerInsights = emptyOfferInsights();
let adminSource = null;
let currentUser = null;
let adminPollingTimer = null;
let adminMetricsTimer = null;
let offerInsightsTimer = null;
const ADMIN_STATE_POLL_INTERVAL_MS = 15000;
const ADMIN_METRICS_POLL_INTERVAL_MS = 60000;
const OFFER_INSIGHTS_POLL_INTERVAL_MS = 90000;

initAdmin();

async function initAdmin() {
  currentUser = await requireSession(["manager"]);
  document.querySelector("#logoutButton").addEventListener("click", logout);
  document.querySelector("#userForm").addEventListener("submit", createUser);
  document.querySelector("#offerInsightPeriod")?.addEventListener("change", () => loadOfferInsights());
  document.querySelector("#sectorFilter")?.addEventListener("change", renderQueueTable);
  document.querySelector("#statusFilter")?.addEventListener("change", renderQueueTable);
  document.querySelector("#refreshDashboardButton")?.addEventListener("click", refreshDashboard);
  await Promise.all([loadAdminState(), loadMetrics(), loadUsers(), loadOfferInsights()]);
  connectAdminRealtime();
}

async function refreshDashboard() {
  await Promise.all([loadAdminState(), loadMetrics(), loadOfferInsights()]);
}

async function loadAdminState() {
  adminState = await api("/api/staff/state");
  renderAdmin();
  renderDashboard();
}

async function loadUsers() {
  if (!["manager", "admin"].includes(currentUser.role)) {
    document.querySelector("#usuarios")?.closest(".manager-section-title")?.setAttribute("hidden", "");
    return;
  }
  const result = await api("/api/users");
  adminUsers = result.users;
  renderUsers();
}

async function loadMetrics() {
  adminMetrics = await api("/api/metrics");
  renderMetrics();
  renderAdmin();
  renderDashboard();
}

async function loadOfferInsights() {
  const period = Number(document.querySelector("#offerInsightPeriod")?.value || 30);
  offerInsights = await api(`/api/offer-insights?days=${encodeURIComponent(period)}`);
  renderOfferInsights();
  renderDashboard();
}

function connectAdminRealtime() {
  adminSource?.close();
  adminSource = null;
  startAdminPolling();
  startMetricsPolling();
  startOfferInsightsPolling();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      loadAdminState().catch(() => {});
      loadMetrics().catch(() => {});
      loadOfferInsights().catch(() => {});
    }
  });
}

function startAdminPolling() {
  if (adminPollingTimer) return;
  adminPollingTimer = setInterval(() => {
    if (document.hidden) return;
    loadAdminState().catch(() => {});
  }, ADMIN_STATE_POLL_INTERVAL_MS);
}

function startMetricsPolling() {
  if (adminMetricsTimer) return;
  adminMetricsTimer = setInterval(() => {
    if (document.hidden) return;
    loadMetrics().catch(() => {});
  }, ADMIN_METRICS_POLL_INTERVAL_MS);
}

function startOfferInsightsPolling() {
  if (offerInsightsTimer) return;
  offerInsightsTimer = setInterval(() => {
    if (document.hidden) return;
    loadOfferInsights().catch(() => {});
  }, OFFER_INSIGHTS_POLL_INTERVAL_MS);
}

function scheduleMetricsRefresh() {
  clearTimeout(scheduleMetricsRefresh.timer);
  scheduleMetricsRefresh.timer = setTimeout(() => {
    loadMetrics().catch(() => {});
  }, 700);
}

function renderAdmin() {
  renderSectorFilter();
  renderQueueTable();
  document.querySelector("#adminSectors").innerHTML = adminState.sectors.map((sector) => {
    const called = sector.tickets.filter((ticket) => ticket.status === "chamado");
    const inService = sector.tickets.filter((ticket) => ticket.status === "em_atendimento");
    const waiting = sector.tickets.filter((ticket) => ["aguardando", "proximo", "espera_inteligente", "standby"].includes(ticket.status));
    const currentTicket = inService[0] || called[0] || null;
    const metric = adminMetrics.sectors.find((item) => item.id === sector.id) || {};
    const load = Math.min(100, Math.round((waiting.length / Math.max(1, Number(sector.capacity || 1))) * 100));
    return `
      <form class="manager-sector-card manager-form" data-sector-form="${escapeHtml(sector.id)}">
        <div class="manager-sector-head">
          <div>
            <strong>${escapeHtml(sector.name)}</strong>
            <span>${escapeHtml(sector.counterLabel || sector.id)}</span>
          </div>
          <b class="manager-badge ${sector.status === "open" ? "success" : sector.status === "paused" ? "warn" : "danger"}">${escapeHtml(statusLabel(sector.status))}</b>
        </div>
        <div class="manager-sector-metrics">
          <div><span>Fila</span><strong>${escapeHtml(waiting.length)}</strong></div>
          <div><span>Atual</span><strong>${escapeHtml(currentTicket ? supportCode(currentTicket).replace("Senha ", "") : "--")}</strong></div>
          <div><span>Médio</span><strong>${escapeHtml(formatMinutesSeconds(metric.avgServiceSeconds || sector.averageServiceSeconds))}</strong></div>
        </div>
        <div class="manager-progress"><span style="width:${escapeHtml(load)}%"></span></div>
        <p class="manager-sector-current">${escapeHtml(currentTicket ? `${displayCustomerName(currentTicket)} - ${ticketStatus(currentTicket)}` : "Nenhuma chamada ativa")}</p>
        <label>Nome do setor<input name="name" value="${escapeHtml(sector.name)}" /></label>
        <label>Balcão<input name="counterLabel" value="${escapeHtml(sector.counterLabel)}" /></label>
        <label>Descrição<input name="serviceLabel" value="${escapeHtml(sector.serviceLabel)}" /></label>
        <div class="manager-form-row">
          <label>Fila base<input type="number" name="queueSize" min="1" value="${escapeHtml(sector.queueSize)}" /></label>
          <label>Tempo médio (min)<input type="number" name="averageServiceMinutes" min="0" value="${escapeHtml(timeParts(sector.averageServiceSeconds).minutes)}" /></label>
          <label>Tempo médio (seg)<input type="number" name="averageServiceRestSeconds" min="0" max="59" value="${escapeHtml(timeParts(sector.averageServiceSeconds).seconds)}" /></label>
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
      <td>${ticket.priority ? `<span class="manager-badge danger">Preferencial</span>` : `<span class="manager-badge neutral">Normal</span>`}</td>
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

function renderMetrics() {
  const metricsGrid = document.querySelector("#adminMetrics");
  if (!metricsGrid) return;
  metricsGrid.innerHTML = [
    ...adminMetrics.sectors.map((sector) => `
      <article class="ops-card">
        <div class="ops-card-head">
          <div>
            <strong>${escapeHtml(sector.name)}</strong>
            <span>${escapeHtml(sector.finished)} atendimentos finalizados</span>
          </div>
        </div>
        <div class="ops-metric"><span>Tempo médio</span><strong>${escapeHtml(formatMinutesSeconds(sector.avgServiceSeconds))}</strong></div>
        <div class="ops-metric"><span>Espera inteligente</span><strong>${escapeHtml(formatMinutesSeconds(sector.avgSmartWaitSeconds))}</strong></div>
        <p class="ops-empty">Abandono: ${escapeHtml(sector.abandoned)}</p>
      </article>
    `),
    `<article class="ops-card">
      <div class="ops-card-head"><div><strong>Satisfação</strong><span>${escapeHtml(adminMetrics.satisfaction.count)} avaliações</span></div></div>
      <div class="ops-metric"><span>Média</span><strong>${escapeHtml(adminMetrics.satisfaction.average)}</strong></div>
    </article>`
  ].join("");
}

function renderDashboard() {
  const summary = dashboardSummary();
  const topCluster = offerInsights.clusters[0] || null;
  const topProduct = offerInsights.productRanking[0] || null;
  const topPattern = offerInsights.timePatterns[0] || null;
  const health = dashboardHealth(summary, offerInsights.confidence);
  const openSectors = adminState.sectors.filter((sector) => sector.status === "open").length;

  setText("#heroOpenSectors", openSectors);
  setText("#heroQueueTotal", summary.waiting);
  setText("#heroStatus", health.label.toLowerCase());
  setText("#heroAverageTime", formatMinutesSeconds(summary.avgServiceSeconds));
  setText("#heroWaitingCustomers", summary.waiting);
  setText("#heroSyncTime", new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
  document.querySelector("#healthDot")?.classList.toggle("attention", health.status === "attention");

  document.querySelector("#dashboardKpis").innerHTML = [
    dashboardKpi("Fila agora", summary.waiting, "senhas aguardando", health.status === "attention" ? "atenção" : "estável"),
    dashboardKpi("Tempo médio", formatMinutesSeconds(summary.avgServiceSeconds), "média entre setores", "tempo real"),
    dashboardKpi("Abandono", summary.abandoned, `${summary.finished} finalizados`, summary.abandoned ? "monitorar" : "baixo"),
    dashboardKpi("ICCF", offerInsights.totalCustomers, `${offerInsights.totalSelections} seleções`, confidenceLabel(offerInsights.confidence))
  ].join("");

  document.querySelector("#dashboardOperations").innerHTML = adminMetrics.sectors.length
    ? adminMetrics.sectors.map((sector) => operationBar(sector, summary.maxAvgServiceSeconds)).join("")
    : `<p class="insight-empty">Aguardando métricas operacionais.</p>`;

  document.querySelector("#dashboardIntel").innerHTML = `
    ${dashboardIntelItem("1", "Cluster principal", topCluster ? `${topCluster.name} em ${topCluster.dominantSector}` : "Sem cluster suficiente")}
    ${dashboardIntelItem("2", "Produto em destaque", topProduct ? `${topProduct.productName} (${topProduct.quantity} seleções)` : "Sem ranking de produto")}
    ${dashboardIntelItem("3", "Padrão mais forte", topPattern ? topPattern.label : "Sem padrão de horário")}
    ${dashboardIntelItem("4", "Próxima ação", offerInsights.suggestions[0] || "Aguardando mais seleções nas ofertas")}
  `;
}

function dashboardSummary() {
  const activeTickets = adminState.sectors.flatMap((sector) => sector.tickets || []);
  const waiting = activeTickets.filter((ticket) => ["aguardando", "proximo", "espera_inteligente", "standby"].includes(ticket.status)).length;
  const called = activeTickets.filter((ticket) => ["chamado", "em_atendimento"].includes(ticket.status)).length;
  const finished = adminMetrics.sectors.reduce((sum, sector) => sum + Number(sector.finished || 0), 0);
  const abandoned = adminMetrics.sectors.reduce((sum, sector) => sum + Number(sector.abandoned || 0), 0);
  const avgServiceSeconds = averageNumber(adminMetrics.sectors.map((sector) => Number(sector.avgServiceSeconds || 0)));
  const maxAvgServiceSeconds = Math.max(1, ...adminMetrics.sectors.map((sector) => Number(sector.avgServiceSeconds || 0)));
  return { waiting, called, finished, abandoned, avgServiceSeconds, maxAvgServiceSeconds };
}

function dashboardHealth(summary, confidence) {
  if (summary.waiting > 8 || summary.abandoned > summary.finished) return { label: "Atenção operacional", status: "attention" };
  if (confidence === "alta" && offerInsights.totalSelections > 0) return { label: "Oportunidade ativa", status: "good" };
  if (summary.called || summary.waiting || summary.finished) return { label: "Operação estável", status: "good" };
  return { label: "Aguardando movimento", status: "neutral" };
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

function operationBar(sector, maxValue) {
  const value = Number(sector.avgServiceSeconds || 0);
  const width = Math.max(4, Math.min(100, Math.round((value / maxValue) * 100)));
  return `
    <article class="manager-bar-row">
      <div>
        <strong>${escapeHtml(sector.name)}</strong>
        <span>${escapeHtml(sector.finished)} finalizados - ${escapeHtml(sector.abandoned)} abandonos</span>
      </div>
      <b>${escapeHtml(formatMinutesSeconds(value))}</b>
      <i><em style="width:${escapeHtml(width)}%"></em></i>
    </article>
  `;
}

function dashboardIntelItem(index, label, value) {
  return `
    <article class="manager-insight">
      <div>${escapeHtml(index)}</div>
      <p><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></p>
    </article>
  `;
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

function renderOfferInsights() {
  const data = offerInsights || emptyOfferInsights();
  setText("#iccfConfidence", confidenceLabel(data.confidence));
  document.querySelector("#offerInsightSummary").innerHTML = [
    insightStat("Seleções analisadas", data.totalSelections),
    insightStat("Clientes identificados", data.totalCustomers),
    insightStat("Confiança", confidenceLabel(data.confidence)),
    insightStat("Janela", `${data.periodDays || 30} dias`)
  ].join("");

  if (!data.totalSelections) {
    const empty = `<p class="manager-empty">Ainda não há seleções de ofertas suficientes para formar clusters. Conforme os clientes adicionarem ofertas ao carrinho, o ICCF passa a revelar padrões de compra.</p>`;
    document.querySelector("#offerClusters").innerHTML = empty;
    document.querySelector("#offerProducts").innerHTML = empty;
    document.querySelector("#offerPatterns").innerHTML = empty;
    document.querySelector("#offerSuggestions").innerHTML = empty;
    return;
  }

  document.querySelector("#offerClusters").innerHTML = data.clusters.length
    ? data.clusters.map(clusterCard).join("")
    : `<p class="manager-empty">Sem clusters consistentes neste período.</p>`;
  document.querySelector("#offerProducts").innerHTML = data.productRanking.length
    ? data.productRanking.map(productInsightRow).join("")
    : `<p class="manager-empty">Nenhum produto ranqueado neste período.</p>`;
  document.querySelector("#offerPatterns").innerHTML = data.timePatterns.length
    ? data.timePatterns.map(patternInsightRow).join("")
    : `<p class="manager-empty">Nenhum padrão de horário detectado.</p>`;
  document.querySelector("#offerSuggestions").innerHTML = data.suggestions.length
    ? data.suggestions.map((suggestion, index) => dashboardIntelItem(index + 1, "Ação recomendada", suggestion)).join("")
    : `<p class="manager-empty">Sem recomendações novas agora.</p>`;
}

function insightStat(label, value) {
  return `
    <article class="manager-mini-stat">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </article>
  `;
}

function clusterCard(cluster) {
  return `
    <article class="manager-cluster-card">
      <div class="manager-sector-head">
        <div>
          <strong>${escapeHtml(cluster.name)}</strong>
          <span>${escapeHtml(cluster.dominantSector)} - ${escapeHtml(cluster.dominantTime)}</span>
        </div>
        <b class="manager-badge neutral">${escapeHtml(confidenceLabel(cluster.confidence))}</b>
      </div>
      <div class="manager-chip-row">
        <span>${escapeHtml(cluster.quantity)} seleções</span>
        <span>${escapeHtml(cluster.customers)} clientes</span>
      </div>
      <div class="manager-chip-row products">
        ${cluster.topProducts.map((product) => `<span>${escapeHtml(product.productName)}</span>`).join("")}
      </div>
      <p class="manager-note">${escapeHtml(cluster.recommendation)}</p>
    </article>
  `;
}

function productInsightRow(product) {
  return `
    ${dashboardIntelItem(product.quantity, product.productName, `${product.sectorName} - ${product.customers} clientes`)}
  `;
}

function patternInsightRow(pattern) {
  return `
    ${dashboardIntelItem(pattern.quantity, pattern.label, pattern.topProducts.map((product) => product.productName).join(", ") || "Sem produtos associados")}
  `;
}

function emptyOfferInsights() {
  return {
    periodDays: 30,
    totalSelections: 0,
    totalCustomers: 0,
    productRanking: [],
    sectorPatterns: [],
    timePatterns: [],
    clusters: [],
    suggestions: [],
    confidence: "baixa"
  };
}

function confidenceLabel(value) {
  return { alta: "Alta", media: "Média", baixa: "Baixa" }[value] || value || "Baixa";
}

function renderUsers() {
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
  await Promise.all([loadAdminState(), loadMetrics()]);
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

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

function initials(value) {
  const parts = String(value || "Cliente").trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || "C").concat(parts[1]?.[0] || "").toUpperCase();
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
  const payload = await parseApiPayload(response);
  if (!response.ok || payload.error) throw new Error(payload.error || "Falha na API.");
  return payload;
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
