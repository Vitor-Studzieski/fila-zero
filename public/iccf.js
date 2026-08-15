let offerInsights = emptyOfferInsights();
let offerInsightsTimer = null;
const OFFER_INSIGHT_POLL_INTERVAL_MS = 90000;

initIccf();

async function initIccf() {
  await requireSession(["manager", "admin"]);
  document.querySelector("#logoutButton")?.addEventListener("click", logout);
  document.querySelector("#offerInsightPeriod")?.addEventListener("change", () => loadOfferInsights());

  try {
    await loadOfferInsights();
  } catch (error) {
    const summary = document.querySelector("#offerInsightSummary");
    if (summary) {
      summary.innerHTML = `<p class="manager-empty">Não foi possível carregar os dados do ICCF. ${escapeHtml(error.message || "Tente atualizar a página.")}</p>`;
    }
  }

  startOfferInsightsPolling();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadOfferInsights().catch(() => {});
  });
}

async function loadOfferInsights() {
  const period = Number(document.querySelector("#offerInsightPeriod")?.value || 30);
  offerInsights = await api(`/api/offer-insights?days=${encodeURIComponent(period)}`);
  renderOfferInsights();
}

function startOfferInsightsPolling() {
  if (offerInsightsTimer) return;
  offerInsightsTimer = setInterval(() => {
    if (document.hidden) return;
    loadOfferInsights().catch(() => {});
  }, OFFER_INSIGHT_POLL_INTERVAL_MS);
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

function dashboardIntelItem(index, label, value) {
  return `
    <article class="manager-insight">
      <div>${escapeHtml(index)}</div>
      <p><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></p>
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
  return dashboardIntelItem(product.quantity, product.productName, `${product.sectorName} - ${product.customers} clientes`);
}

function patternInsightRow(pattern) {
  return dashboardIntelItem(pattern.quantity, pattern.label, pattern.topProducts.map((product) => product.productName).join(", ") || "Sem produtos associados");
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

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
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
