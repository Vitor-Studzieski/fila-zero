const screens = {
  home: "Supermercado Pompeia",
  sectors: "Fila virtual",
  ticket: "Minha senha",
  status: "Acompanhamento",
  offers: "Lista de compras",
  detail: "Detalhe do item",
  done: "Atendimento",
  club: "Clube",
  account: "Conta",
  rating: "Avaliação"
};

const SMART_WAIT_STATUS = "espera_inteligente";
const CANCELABLE_STATUSES = new Set(["aguardando", "proximo", "chamado", SMART_WAIT_STATUS, "standby"]);
const PRIORITY_LABELS = {
  deficiencia_ou_mobilidade_reduzida: "Deficiencia ou mobilidade reduzida",
  tea: "TEA",
  idoso_60_mais: "Idoso 60+",
  gestante_ou_lactante: "Gestante ou lactante",
  crianca_de_colo: "Crianca de colo",
  obesidade: "Obesidade"
};
const shoppingList = new Set();
let cartItems = [];
const identity = getOrCreateIdentity();
let currentUser = null;
let alertPreferences = loadAlertPreferences();
let queueTutorialSeen = localStorage.getItem("senhaHubQueueTutorialSeen") === "1";

let activeScreen = "home";
let currentSector = null;
let activeQueues = {};
let sectors = {};
let stateSource = null;
let pollingTimer = null;
let previousTicketStatuses = new Map();
let lastStateUpdatedAt = null;
let countdownTimer = null;
let activeJoinSector = null;
const STATE_POLL_INTERVAL_MS = 12000;
let queueAlertHistory = new Set();
let visibleQueueAlert = null;
let productsRendered = false;
const productPhotoQueries = {};
const productCatalog = [];
const productGroups = [];
let productSearchTerm = "";
let shoppingRecommendationMode = "auto";
let shoppingSectorFilter = "all";
let shoppingAgentProfile = emptyShoppingAgentProfile();
let productSearchSignalTimer = null;

const offerPriorityBySector = {
  acougue: ["Açougue", "Bebidas", "Padaria", "Mercearia", "Bazar"],
  frios: ["Frios e Laticínios", "Padaria", "Bebidas", "Mercearia", "Hortifruti"],
  padaria: ["Padaria", "Frios e Laticínios", "Mercearia", "Bebidas", "Hortifruti"]
};

const offerProfilesBySector = {
  acougue: {
    title: "Ofertas para sua espera no Acougue",
    subtitle: "Carnes, temperos, carvao, molhos e acompanhamentos",
    featuredProductIds: [
      "picanha",
      "contra-file",
      "alcatra",
      "frango-file",
      "linguica-toscana",
      "costela-bovina",
      "patinho-moido",
      "carne-panela",
      "carvao",
      "papel-aluminio",
      "molho-tomate",
      "cebola"
    ],
    relatedProductIds: [
      "tomate",
      "batata",
      "oleo-soja",
      "refrigerante-cola",
      "cerveja-lata",
      "vinho-tinto",
      "filme-pvc"
    ]
  },
  padaria: {
    title: "Ofertas para sua espera na Padaria",
    subtitle: "Paes, cafe, manteiga, bolos e itens de cafe da manha",
    featuredProductIds: [
      "pao-frances",
      "croissant",
      "bolo-cenoura",
      "pao-forma",
      "sonho-creme",
      "pao-queijo",
      "baguete",
      "cafe",
      "manteiga",
      "leite-integral",
      "acucar",
      "banana"
    ],
    relatedProductIds: [
      "requeijao",
      "iogurte-natural",
      "suco-uva",
      "maca",
      "farinha-trigo",
      "guardanapo"
    ]
  },
  frios: {
    title: "Ofertas para sua espera em Frios",
    subtitle: "Queijos, presuntos, iogurtes, massas e complementos",
    featuredProductIds: [
      "mussarela",
      "presunto",
      "queijo-prato",
      "mortadela",
      "requeijao",
      "iogurte-natural",
      "manteiga",
      "leite-integral",
      "pao-frances",
      "pao-forma",
      "macarrao",
      "molho-tomate"
    ],
    relatedProductIds: [
      "baguete",
      "lasanha",
      "pizza",
      "tomate",
      "suco-uva",
      "guardanapo"
    ]
  }
};

const shoppingSectorFilters = {
  all: [],
  acougue: ["Açougue"],
  frios: ["Frios e Laticínios"],
  padaria: ["Padaria"],
  mercearia: ["Mercearia"],
  bebidas: ["Bebidas"],
  hortifruti: ["Hortifruti"]
};

init();

async function init() {
  syncMobileViewport();
  simplifyStatusDetails();
  bindEvents();
  syncPriorityControls();
  syncAlertControls();
  navigate("home");
  currentUser = await requireSession(["customer", "manager", "admin"]);
  syncAccessArea();
  renderClub();
  renderAccount();
  identity.customerId = currentUser.customerId;
  localStorage.setItem("senhaHubIdentity", JSON.stringify(identity));
  await loadProductCatalog();
  await Promise.all([syncSession(), loadCart(), loadState(), loadShoppingAgent()]);
  applyRequestedView();
  connectRealtime();
  startCountdownTimer();
}

function simplifyStatusDetails() {
  const panel = document.querySelector(".sync-panel");
  if (!panel || panel.closest(".sync-details")) return;
  const details = document.createElement("details");
  details.className = "sync-details";
  const summary = document.createElement("summary");
  summary.textContent = "Detalhes da fila";
  panel.parentNode.insertBefore(details, panel);
  details.append(summary, panel);
}

function syncMobileViewport() {
  const root = document.documentElement;
  const apply = () => {
    const viewport = window.visualViewport;
    const width = Math.round(viewport?.width || window.innerWidth);
    const height = Math.round(viewport?.height || window.innerHeight);
    root.style.setProperty("--app-viewport-width", `${width}px`);
    root.style.setProperty("--app-viewport-height", `${height}px`);
    root.style.setProperty("--app-viewport-top", `${Math.round(viewport?.offsetTop || 0)}px`);
  };
  apply();
  window.addEventListener("resize", apply, { passive: true });
  window.addEventListener("orientationchange", () => setTimeout(apply, 120), { passive: true });
  window.visualViewport?.addEventListener("resize", apply, { passive: true });
  window.visualViewport?.addEventListener("scroll", apply, { passive: true });
}

function getOrCreateIdentity() {
  const params = new URLSearchParams(location.search);
  const sharedCustomerId = params.get("cliente") || params.get("customer_id");
  const stored = safeJsonParse(localStorage.getItem("senhaHubIdentity"), {});
  const identity = {
    customerId: sharedCustomerId || stored.customerId || `cliente-${crypto.randomUUID()}`,
    deviceId: stored.deviceId || `device-${crypto.randomUUID()}`
  };
  localStorage.setItem("senhaHubIdentity", JSON.stringify(identity));
  return identity;
}

async function syncSession() {
  const session = await api("/api/sessions", {
    method: "POST",
    body: identity
  });
  identity.customerId = session.customerId;
  identity.deviceId = session.deviceId;
  localStorage.setItem("senhaHubIdentity", JSON.stringify(identity));
}

async function loadState() {
  const state = await api(`/api/state?customer_id=${encodeURIComponent(identity.customerId)}`);
  applyState(state);
}

async function loadCart() {
  const result = await api(`/api/cart?customer_id=${encodeURIComponent(identity.customerId)}`);
  cartItems = result.items;
  syncCartViews();
}

function syncCartViews() {
  shoppingList.clear();
  cartItems.forEach((item) => shoppingList.add(item.productId));
  renderCart();
  renderClub();
  if (productsRendered) renderProducts();
}

function upsertLocalCartItem(item) {
  if (!item?.id) return;
  const index = cartItems.findIndex((entry) => entry.id === item.id);
  if (index === -1) cartItems.push(item);
  else cartItems[index] = item;
  syncCartViews();
}

function refreshShoppingAgentInBackground() {
  loadShoppingAgent()
    .then(() => {
      if (productsRendered) renderProducts();
    })
    .catch((error) => console.warn("shopping_agent_refresh_failed", error));
}

async function loadProductCatalog() {
  const response = await fetch("/data/products.json");
  if (!response.ok) throw new Error("Nao foi possivel carregar a base de produtos.");
  const payload = await response.json();
  const products = Array.isArray(payload.products) ? payload.products : [];
  productCatalog.splice(0, productCatalog.length, ...products.map(catalogProduct));
  productGroups.splice(0, productGroups.length, ...groupProductsBySector(productCatalog));
}

async function loadShoppingAgent() {
  try {
    shoppingAgentProfile = await api("/api/shopping-agent");
  } catch (exception) {
    console.warn(exception);
    shoppingAgentProfile = emptyShoppingAgentProfile();
  }
}

function catalogProduct(item) {
  const imageQuery = [item.baseName, item.brand, item.category].filter(Boolean).join(" ");
  return {
    ...item,
    image: productImage(item.id, item.name, imageQuery),
    description: item.description || `${item.name} para adicionar à sua lista de compras.`
  };
}

function groupProductsBySector(products) {
  const groups = new Map();
  products.forEach((item) => {
    const sector = item.sector || item.category || "Mercado";
    if (!groups.has(sector)) groups.set(sector, []);
    groups.get(sector).push(item);
  });
  return [...groups.entries()].map(([sector, items]) => group(sector, items));
}

function emptyShoppingAgentProfile() {
  return {
    favoriteSectors: [],
    favoriteProducts: [],
    recentSearches: [],
    clusterSuggestions: [],
    preferredHourBucket: "",
    generatedAt: null
  };
}

function connectRealtime() {
  stateSource?.close();
  stateSource = null;
  startStatePolling();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadState().catch(() => {});
  });
}

function startStatePolling() {
  if (pollingTimer) return;
  pollingTimer = setInterval(() => {
    if (document.hidden) return;
    loadState().catch(() => {});
  }, STATE_POLL_INTERVAL_MS);
}

function applyState(state) {
  const nextStatuses = new Map();
  lastStateUpdatedAt = state.serverTime || new Date().toISOString();
  sectors = Object.fromEntries(state.sectors.map((sector) => [sector.id, sector]));
  activeQueues = Object.fromEntries(state.tickets.map((ticket) => [ticket.sectorId, withLiveCountdown(ticket)]));

  state.tickets.forEach((ticket) => {
    nextStatuses.set(ticket.id, ticket.status);
    if (ticket.status === "chamado" && previousTicketStatuses.get(ticket.id) !== "chamado") {
      currentSector = ticket.sectorId;
      notifyTicketCalled(ticket);
      document.querySelector("#callModal").classList.add("visible");
    }
  });

  previousTicketStatuses = nextStatuses;
  pruneQueueAlertHistory(state.tickets);
  if (!currentSector || !activeQueues[currentSector]) currentSector = Object.keys(activeQueues)[0] || null;
  syncQueue();
}

function applyRequestedView() {
  const view = new URLSearchParams(location.search).get("view");
  if (["status", "account"].includes(view)) navigate(view);
}

async function handlePushRefresh(event) {
  try {
    await loadState();
    if (["queue_called", "queue_recalled", "queue_next"].includes(event.detail?.type)) navigate("status");
  } catch (exception) {
    console.warn("push_state_refresh_failed", exception);
  }
}

function startCountdownTimer() {
  if (countdownTimer) return;
  countdownTimer = setInterval(() => {
    if (!Object.values(activeQueues).some((ticket) => hasLiveCountdown(ticket) || hasStandbyCountdown(ticket))) return;
    activeQueues = Object.fromEntries(
      Object.entries(activeQueues).map(([sectorId, ticket]) => [sectorId, withLiveCountdown(ticket)])
    );
    syncQueue();
  }, 1000);
}

function withLiveCountdown(ticket) {
  if (hasStandbyCountdown(ticket)) {
    const remaining = Math.ceil((new Date(ticket.standbyExpiresAt).getTime() - Date.now()) / 1000);
    return { ...ticket, standbySecondsRemaining: Math.max(0, remaining) };
  }
  if (!hasLiveCountdown(ticket)) return ticket;
  const remaining = Math.ceil((new Date(ticket.estimatedCallAt).getTime() - Date.now()) / 1000);
  return {
    ...ticket,
    secondsToCall: Math.max(0, remaining),
    countdownTotalSeconds: Math.max(ticket.countdownTotalSeconds || 0, remaining)
  };
}

function hasLiveCountdown(ticket) {
  return Boolean(ticket?.estimatedCallAt && ["aguardando", "proximo"].includes(ticket.status));
}

function hasStandbyCountdown(ticket) {
  return Boolean(ticket?.status === "standby" && ticket.standbyExpiresAt);
}

function group(sector, items) {
  return { sector, items };
}

function product(id, name, old, price, sale, description, query) {
  const imageQuery = productPhotoQueries[id] || query;
  return { id, name, old, price, sale, description, image: productImage(id, name, imageQuery) };
}

function productImage(id, name, query) {
  const palette = productPalette(id);
  const title = name.split(" ").slice(0, 3).join(" ");
  const subtitle = query.split(" ").slice(0, 3).join(" ");
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="220" height="180" viewBox="0 0 220 180">
      <defs>
        <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stop-color="${palette[0]}"/>
          <stop offset="1" stop-color="${palette[1]}"/>
        </linearGradient>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="8" stdDeviation="8" flood-color="#172033" flood-opacity=".22"/>
        </filter>
      </defs>
      <rect width="220" height="180" rx="18" fill="url(#bg)"/>
      <circle cx="184" cy="32" r="42" fill="#ffffff" opacity=".18"/>
      <circle cx="42" cy="152" r="56" fill="#ffffff" opacity=".14"/>
      <rect x="28" y="40" width="164" height="104" rx="16" fill="#fffdf7" opacity=".94" filter="url(#shadow)"/>
      <rect x="46" y="58" width="128" height="52" rx="10" fill="${palette[2]}" opacity=".2"/>
      <path d="M52 126h116" stroke="${palette[2]}" stroke-width="8" stroke-linecap="round" opacity=".55"/>
      <text x="110" y="84" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="20" font-weight="900" fill="#0f3154">${escapeSvgText(title)}</text>
      <text x="110" y="107" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="11" font-weight="800" fill="#5b6678">${escapeSvgText(subtitle)}</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function productPalette(seed) {
  const palettes = [
    ["#fff2c2", "#f8b84e", "#b45309"],
    ["#e0f2fe", "#7dd3fc", "#0369a1"],
    ["#dcfce7", "#86efac", "#15803d"],
    ["#fee2e2", "#fca5a5", "#b91c1c"],
    ["#fef3c7", "#fde68a", "#a16207"],
    ["#ede9fe", "#c4b5fd", "#6d28d9"],
    ["#fce7f3", "#f9a8d4", "#be185d"],
    ["#e2e8f0", "#94a3b8", "#334155"]
  ];
  const index = [...seed].reduce((total, char) => total + char.charCodeAt(0), 0) % palettes.length;
  return palettes[index];
}

function escapeSvgText(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&apos;"
  }[char]));
}

function navigate(screen) {
  if (!screens[screen]) return;
  activeScreen = screen;
  document.querySelectorAll(".screen").forEach((item) => item.classList.toggle("active", item.dataset.screen === screen));
  document.querySelector("#appTitle").textContent = screens[screen];
  if (screen === "done") renderServiceScreen();
  if (screen === "offers") {
    renderOfferQueueContext();
    renderProducts();
  }
  if (screen === "club") renderClub();
  if (screen === "account") renderAccount();
  updateTabs(screen);
  updateFloatingQueue();
  maybeShowQueueTutorial(screen);
}

function maybeShowQueueTutorial(screen) {
  if (queueTutorialSeen) return;
  if (!["sectors", "ticket", "status"].includes(screen)) return;
  openQueueTutorial({ automatic: true });
}

function openQueueTutorial(options = {}) {
  const modal = document.querySelector("#queueTutorial");
  if (!modal) return;
  modal.hidden = false;
  if (options.automatic) markQueueTutorialSeen();
}

function closeQueueTutorial() {
  document.querySelector("#queueTutorial").hidden = true;
  markQueueTutorialSeen();
}

function markQueueTutorialSeen() {
  queueTutorialSeen = true;
  localStorage.setItem("senhaHubQueueTutorialSeen", "1");
}

function syncAccessArea() {
  const isManager = ["manager", "admin"].includes(currentUser?.role);
  const isAdmin = ["manager", "admin"].includes(currentUser?.role);
  document.querySelectorAll(".manager-access").forEach((item) => {
    item.hidden = !isManager;
  });
  document.querySelectorAll(".admin-access").forEach((item) => {
    item.hidden = !isAdmin;
  });
  const authorizedPanel = document.querySelector("#authorizedPanel");
  if (authorizedPanel) authorizedPanel.hidden = !isManager && !isAdmin;
}

function renderClub() {
  const points = Math.max(120, cartItems.length * 80 + Object.keys(activeQueues).length * 150);
  const level = points >= 700 ? "Cliente Ouro" : points >= 350 ? "Cliente Prata" : "Cliente cadastrado";
  const pointsElement = document.querySelector("#clubPoints");
  const levelElement = document.querySelector("#clubLevel");
  if (pointsElement) pointsElement.textContent = `${points} pts`;
  if (levelElement) levelElement.textContent = level;
}

function renderAccount() {
  if (!currentUser) return;
  const name = currentUser.name || "Cliente";
  const email = currentUser.email || "--";
  const role = roleLabel(currentUser.role);
  setText("#accountName", name);
  setText("#accountEmail", email);
  setText("#accountRole", role);
  setText("#accountStatus", currentUser.status === "inactive" ? "Inativo" : "Ativo");
  setText("#accountCustomerId", currentUser.customerId || currentUser.id || "--");
  setText("#accountAvatar", initials(name, email));
}

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

function initials(name, email) {
  const source = String(name || email || "Cliente").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

function roleLabel(role) {
  return {
    customer: "Cliente",
    attendant: "Funcionário",
    manager: "Gestor",
    admin: "Administrador"
  }[role] || "Cliente";
}

function updateTabs(screen) {
  document.querySelectorAll(".tabbar button").forEach((button) => {
    const tab = button.dataset.tab;
    button.classList.toggle("on", tab === screen || (tab === "sectors" && ["sectors", "ticket", "status", "done", "rating"].includes(screen)) || (tab === "offers" && ["offers", "detail"].includes(screen)));
  });
}

async function joinQueue(sectorId) {
  if (!sectors[sectorId]) return;
  if (activeJoinSector) return;
  activeJoinSector = sectorId;
  syncActionButtons();
  try {
    const result = await createDigitalTicket(sectorId);
    currentSector = result.ticket.sectorId;
    activeQueues[result.ticket.sectorId] = withLiveCountdown(result.ticket);
    syncQueue();
    navigate("status");
  } catch (exception) {
    alert(exception.message);
  } finally {
    activeJoinSector = null;
    syncActionButtons();
  }
}

function createDigitalTicket(sectorId) {
  return api("/api/tickets", {
    method: "POST",
    body: { ...identity, sectorId, ...priorityPayload() }
  });
}

function priorityPayload() {
  const toggle = document.querySelector("#priorityToggle");
  const reason = document.querySelector("#priorityReason")?.value || "";
  const priority = Boolean(toggle?.checked);
  if (!priority) return { priority: false, priorityReason: "" };
  if (!reason) throw new Error("Selecione a categoria da fila preferencial.");
  return { priority: true, priorityReason: reason };
}

function syncQueue() {
  const activeCount = Object.keys(activeQueues).length;
  const data = getCurrentQueueData();
  const serviceSector = getServiceInProgressSector();
  const hasQueue = Boolean(data);

  document.querySelector("#queueBanner").classList.toggle("visible", hasQueue);
  document.querySelector("#bannerTicket").textContent = hasQueue ? displayCustomerName(data) : "";
  document.querySelector("#bannerText").textContent = hasQueue ? bannerText(data, activeCount) : "";
  document.querySelector("#bannerProgress").style.width = hasQueue ? `${data.progress}%` : "0%";

  document.querySelector("#ticketNumber").textContent = hasQueue ? displayCustomerName(data) : "--";
  document.querySelector("#ticketSupportCode").textContent = hasQueue ? supportCode(data) : "Código --";
  document.querySelector("#ticketSector").textContent = hasQueue ? data.sector : "Nenhuma senha ativa";
  document.querySelector("#ticketSub").textContent = hasQueue ? ticketSubText(data) : "Solicite uma senha em um setor para acompanhar.";
  document.querySelector("#currentQueue").textContent = hasQueue ? currentCallText(data) : "--";
  document.querySelector("#ticketSuccessCard").classList.toggle("visible", hasQueue);
  document.querySelector("#ticketSuccessText").textContent = hasQueue
    ? `Nome: ${displayCustomerName(data)}. ${supportCode(data)}. Setor: ${data.sector}. Voce sera avisado quando estiver proximo.`
    : "Voce sera avisado quando estiver proximo.";
  renderPriorityBadge(document.querySelector("#ticketPriorityBadge"), data);

  document.querySelector("#statusSector").textContent = hasQueue ? `${data.sector} - ${data.counterLabel}` : "Nenhuma senha ativa";
  document.querySelector("#positionNumber").textContent = hasQueue ? positionText(data) : "--";
  document.querySelector("#estimatedTime").textContent = hasQueue ? statusText(data) : "Sem atendimento em andamento";
  document.querySelector("#timeInfo").textContent = hasQueue ? timeInfoText(data) : "--";
  document.querySelector("#estimateNote").textContent = hasQueue ? estimateNoteText(data) : "Tempo estimado indisponivel.";
  document.querySelector("#aheadInfo").textContent = hasQueue ? aheadInfoText(data) : "--";
  updateQueueAlert(data);
  updateSyncPanel(data);
  renderPriorityBadge(document.querySelector("#statusPriorityBadge"), data);
  document.querySelector(".ticket-circle").classList.toggle("priority-ticket", Boolean(hasQueue && data.priority));
  document.querySelector(".progress-donut").classList.toggle("priority-ticket", Boolean(hasQueue && data.priority));
  document.querySelector(".progress-donut").style.setProperty("--donut-progress", `${hasQueue ? donutProgress(data) : 0}%`);

  document.querySelector("#statusFinishButton").classList.toggle("visible", Boolean(serviceSector));
  document.querySelector("#statusFinishButton").textContent = serviceSector && serviceSector !== currentSector
    ? `Informar fim do pedido em ${activeQueues[serviceSector].sector}`
    : "Informar fim do pedido";

  document.querySelector("#callText").textContent = hasQueue
    ? `Dirija-se ao ${data.counterLabel} de ${data.sector}. ${displayCustomerName(data)} foi chamado. ${supportCode(data)}.`
    : "";
  document.querySelector("#floatingTicket").textContent = hasQueue ? displayCustomerName(data) : "";
  document.querySelector("#floatingTime").textContent = hasQueue ? floatingTimeText(data) : "";
  document.querySelector("#ticketCancelButton").classList.toggle("visible", canCancelTicket(data));
  document.querySelector("#statusCancelButton").classList.toggle("visible", canCancelTicket(data));

  renderActiveTickets();
  renderSectorCards();
  renderOfferQueueContext();
  updateFloatingQueue();
}

function getCurrentQueueData() {
  if (currentSector && activeQueues[currentSector]) return activeQueues[currentSector];
  const firstSector = Object.keys(activeQueues)[0];
  if (!firstSector) return null;
  currentSector = firstSector;
  return activeQueues[firstSector];
}

function hasActiveQueues() {
  return Object.keys(activeQueues).length > 0;
}

function getServiceInProgressSector() {
  return Object.keys(activeQueues).find((sectorId) => activeQueues[sectorId].status === "em_atendimento") || null;
}

function canCancelTicket(ticket) {
  return Boolean(ticket && CANCELABLE_STATUSES.has(ticket.status));
}

function donutProgress(data) {
  if (!data) return 0;
  if (hasLiveCountdown(data)) {
    const total = Math.max(1, Number(data.countdownTotalSeconds || data.secondsToCall || 1));
    return Math.max(0, Math.min(100, (Number(data.secondsToCall || 0) / total) * 100));
  }
  return data.progress || 0;
}

async function cancelCurrentTicket(ticketId = null) {
  const data = ticketId
    ? Object.values(activeQueues).find((ticket) => ticket.id === ticketId)
    : getCurrentQueueData();
  if (!canCancelTicket(data)) return;
  if (!confirm(`Cancelar ${displayCustomerName(data)} (${supportCode(data)}) de ${data.sector}?`)) return;

  try {
    await api(`/api/tickets/${encodeURIComponent(data.id)}/cancel`, { method: "POST", body: identity });
    await loadState();
    navigate(hasActiveQueues() ? "status" : "sectors");
  } catch (exception) {
    alert(exception.message);
  }
}

function getNextSmartWaitSector() {
  return Object.entries(activeQueues)
    .filter(([, data]) => data.status === SMART_WAIT_STATUS)
    .sort(([, a], [, b]) => new Date(a.createdAt) - new Date(b.createdAt))[0]?.[0] || null;
}

async function confirmCall() {
  const data = getCurrentQueueData();
  if (!data || data.status !== "chamado") return;
  document.querySelector("#callModal").classList.remove("visible");
  await api(`/api/tickets/${encodeURIComponent(data.id)}/confirm`, { method: "POST", body: identity });
  await loadState();
  navigate("done");
}

async function finishCurrentService() {
  const serviceSector = getServiceInProgressSector();
  if (!serviceSector) {
    navigate(hasActiveQueues() ? "status" : "rating");
    return;
  }

  const ticket = activeQueues[serviceSector];
  await api(`/api/tickets/${encodeURIComponent(ticket.id)}/finish`, { method: "POST", body: identity });
  await loadState();
  const called = getCurrentQueueData();
  if (called?.status === "chamado") {
    document.querySelector("#callModal").classList.add("visible");
    navigate("status");
    return;
  }
  navigate(hasActiveQueues() ? "status" : "rating");
}

function renderServiceScreen() {
  const serviceSector = getServiceInProgressSector();
  if (serviceSector) currentSector = serviceSector;

  const current = serviceSector ? activeQueues[serviceSector] : null;
  const smartWaitSector = getNextSmartWaitSector();
  const smartWait = smartWaitSector ? activeQueues[smartWaitSector] : null;
  const waitingCount = Object.values(activeQueues).filter((item) => item.status === SMART_WAIT_STATUS).length;

  if (!current) {
    document.querySelector("#serviceTitle").textContent = "Atendimento finalizado";
    document.querySelector("#serviceMessage").textContent = "Não há pedido em atendimento neste momento.";
    document.querySelector("#serviceCurrent").textContent = "Atendimento atual: --";
    document.querySelector("#serviceNext").textContent = hasActiveQueues() ? "Você ainda possui senhas ativas." : "Nenhuma senha ativa.";
    document.querySelector("#completeServiceButton").textContent = hasActiveQueues() ? "Voltar para minhas senhas" : "Ir para avaliação";
    return;
  }

  document.querySelector("#serviceTitle").textContent = "Pedido em atendimento";
  document.querySelector("#serviceMessage").textContent =
    "Quando o pedido terminar, informe no app para liberar a próxima senha protegida.";
  document.querySelector("#serviceCurrent").textContent = `Atendimento atual: ${displayCustomerName(current)} - ${supportCode(current)} - ${current.sector}`;
  document.querySelector("#serviceNext").textContent = smartWait
    ? `Próxima protegida: ${displayCustomerName(smartWait)} - ${supportCode(smartWait)} - ${smartWait.sector}.`
    : waitingCount > 1
      ? `${waitingCount} senhas estão protegidas para chamada em sequência.`
      : "Nenhuma senha protegida no momento.";
  document.querySelector("#completeServiceButton").textContent = smartWait
    ? "Informar fim e chamar próxima senha"
    : "Informar fim do pedido";
}

function statusText(data) {
  if (data.status === "chamado") return "Senha chamada";
  if (data.status === "em_atendimento") return "Em atendimento";
  if (data.status === SMART_WAIT_STATUS) return "Espera inteligente";
  if (data.status === "standby") return `Standby: ${formatStandbyTime(data)}`;
  if (data.status === "proximo") return "Próxima senha";
  if (hasLiveCountdown(data)) return `Chamada em ${formatTimer(data.secondsToCall)}`;
  if (data.position === 1) return "Aguardando chamada";
  return `Previsão: ${formatTimer(data.secondsToCall)}`;
}

function bannerText(data, activeCount) {
  const prefix = activeCount > 1 ? `${activeCount} senhas ativas` : data.sector;
  return `${prefix} - ${statusText(data)}`;
}

function positionText(data) {
  if (data.status === SMART_WAIT_STATUS) return "Pausa";
  if (data.status === "standby") return "Standby";
  if (data.status === "chamado" || data.status === "em_atendimento") return "Agora";
  if (hasLiveCountdown(data)) return formatTimer(data.secondsToCall);
  return `${data.position}º`;
}

function timeInfoText(data) {
  if (data.status === SMART_WAIT_STATUS) return "Protegida";
  if (data.status === "standby") return `${formatStandbyTime(data)} restantes`;
  if (data.status === "chamado") return "Dirija-se ao balcão";
  if (data.status === "em_atendimento") return "Pedido em andamento";
  if (hasLiveCountdown(data)) return formatTimer(data.secondsToCall);
  if (data.position === 1) return "Aguardando chamada";
  return formatTimer(data.secondsToCall);
}

function estimateNoteText(data) {
  if (data.status === "chamado") return `${displayCustomerName(data)} foi chamado no ${data.counterLabel}. ${supportCode(data)}.`;
  if (data.status === "em_atendimento") return "Atendimento em andamento. O tempo da fila sera atualizado ao finalizar.";
  if (data.status === SMART_WAIT_STATUS) return "Seu atendimento esta protegido e sera recalculado quando o atendimento atual terminar.";
  if (data.status === "standby") return `${displayCustomerName(data)} foi chamado, mas não compareceu. A chamada ficará em standby por 10 minutos. Aguarde nova chamada. Tempo restante: ${formatStandbyTime(data)}. ${supportCode(data)}.`;
  if (!Number.isFinite(Number(data.secondsToCall))) return "Tempo estimado indisponivel.";

  const estimate = formatEstimateMinutes(data.secondsToCall);
  const basis = data.estimateBasedOnRecentServices
    ? `Baseado no tempo medio dos ultimos ${data.averageServiceSamples} atendimentos deste setor.`
    : `Baseado no tempo medio configurado para ${data.sector}.`;
  return `Tempo estimado: ${estimate}. ${basis}`;
}

function formatEstimateMinutes(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds) || 0);
  if (seconds < 60) return "menos de 1 minuto";
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
}

function formatStandbyTime(data) {
  const fromServer = Number(data?.standbySecondsRemaining);
  const fromDate = data?.standbyExpiresAt
    ? Math.ceil((new Date(data.standbyExpiresAt).getTime() - Date.now()) / 1000)
    : 0;
  return formatTimer(Math.max(0, Number.isFinite(fromServer) ? fromServer : fromDate));
}

function aheadInfoText(data) {
  if (data.status === SMART_WAIT_STATUS) return "Aguardando fim do pedido atual";
  if (data.status === "standby") return "Aguardando nova chamada apos o proximo atendimento";
  if (data.status === "chamado" || data.status === "em_atendimento") return "Você é o atendimento atual";
  if (data.position === 1) return "Você é o próximo";
  return `${data.ahead} pessoas`;
}

function updateSyncPanel(data) {
  const panel = document.querySelector(".sync-panel");
  if (!panel) return;
  panel.classList.toggle("live", Boolean(data));
  document.querySelector("#syncCounterTicket").textContent = data ? currentCallText(data) : "--";
  document.querySelector("#syncCustomerTicket").textContent = data ? nameAndCode(data) : "--";
  document.querySelector("#syncSector").textContent = data ? `${data.sector} - ${data.counterLabel}` : "--";
  document.querySelector("#syncStatus").textContent = data ? ticketStatusLabel(data.status) : "--";
  document.querySelector("#syncAhead").textContent = data ? syncAheadText(data) : "--";
  document.querySelector("#syncPriorityRule").textContent = data ? priorityRuleText(data) : "--";
  document.querySelector("#syncUpdatedAt").textContent = lastStateUpdatedAt
    ? `Atualizado ${formatClock(lastStateUpdatedAt)}`
    : "Atualizando...";
}

function priorityRuleText(data) {
  return data.priority
    ? "Fila preferencial: prioridade antes da fila comum; ordem mantida entre preferenciais."
    : "Fila comum: chamada apos senhas preferenciais e pela ordem de chegada.";
}

function syncAheadText(data) {
  if (data.status === "chamado" || data.status === "em_atendimento") return "Atendimento atual";
  if (data.status === "atendido") return "Finalizado";
  if (data.status === "cancelado") return "Cancelado";
  if (data.position === 1) return "Voce e o proximo";
  return `${data.ahead} pessoas`;
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

function updateQueueAlert(data) {
  const alertBox = document.querySelector("#queueAlert");
  if (!alertBox) return;

  const alert = queueAlertFor(data);
  visibleQueueAlert = alert;
  alertBox.hidden = !alert;
  alertBox.classList.toggle("urgent", alert?.ahead === 1);
  document.querySelector("#queueAlertTitle").textContent = alert ? alert.title : "Atenção";
  document.querySelector("#queueAlertText").textContent = alert ? alert.message : "";
  if (alert) triggerQueueAlert(alert, data);
}

function queueAlertFor(data) {
  if (!data || !["aguardando", "proximo"].includes(data.status)) return null;
  if (![1, 2].includes(Number(data.ahead))) return null;
  const title = Number(data.ahead) === 1 ? "Atenção: você é o próximo" : "Atenção: sua vez está chegando";
  return {
    ahead: Number(data.ahead),
    title,
    message: `${displayCustomerName(data)} será chamado em breve. Fique próximo ao setor ${data.sector}. ${supportCode(data)}.`
  };
}

function triggerQueueAlert(alert, data) {
  const key = `${data.id}:${alert.ahead}`;
  if (queueAlertHistory.has(key)) return;
  queueAlertHistory.add(key);
  if (alertPreferences.sound) playQueueAlertSound();
  if (alertPreferences.vibration) vibrateQueueAlert(alert.ahead);
}

function pruneQueueAlertHistory(tickets) {
  const activeIds = new Set(tickets.map((ticket) => ticket.id));
  queueAlertHistory = new Set([...queueAlertHistory].filter((key) => activeIds.has(key.split(":")[0])));
}

function loadAlertPreferences() {
  const stored = safeJsonParse(localStorage.getItem("senhaHubAlertPreferences"), {});
  return {
    sound: stored.sound !== false,
    vibration: stored.vibration !== false
  };
}

function safeJsonParse(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function saveAlertPreferences() {
  localStorage.setItem("senhaHubAlertPreferences", JSON.stringify(alertPreferences));
}

function syncAlertControls() {
  const sound = document.querySelector("#soundAlertToggle");
  const vibration = document.querySelector("#vibrationAlertToggle");
  if (!sound || !vibration) return;
  sound.checked = alertPreferences.sound;
  vibration.checked = alertPreferences.vibration;
}

function updateAlertPreference(type, enabled) {
  alertPreferences = { ...alertPreferences, [type]: enabled };
  saveAlertPreferences();
  syncAlertControls();
  if (enabled && type === "sound") playQueueAlertSound({ quiet: true });
  if (enabled && type === "vibration") vibrateQueueAlert(2);
}

function playQueueAlertSound(options = {}) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    const gain = context.createGain();
    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.value = options.quiet ? 660 : 880;
    gain.gain.value = options.quiet ? 0.025 : 0.07;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + (options.quiet ? 0.08 : 0.18));
    oscillator.addEventListener("ended", () => context.close());
  } catch {
    // Browsers can block audio until the user interacts with the page.
  }
}

function vibrateQueueAlert(ahead) {
  if (!("vibrate" in navigator)) return;
  navigator.vibrate(ahead === 1 ? [180, 90, 180] : [140, 70, 140]);
}

function floatingTimeText(data) {
  if (data.status === "chamado") return "chamada";
  if (data.status === "em_atendimento") return "atendimento";
  if (data.status === SMART_WAIT_STATUS) return "protegida";
  if (data.status === "standby") return "standby";
  if (hasLiveCountdown(data)) return formatTimer(data.secondsToCall);
  if (data.position === 1) return "próxima";
  return formatTimer(data.secondsToCall);
}

function ticketSubText(data) {
  const priority = priorityText(data);
  if (priority && ["aguardando", "proximo"].includes(data.status)) return `${priority}. ${data.position} na fila preferencial.`;
  if (data.status === "em_atendimento") return `Pedido em atendimento no ${data.counterLabel}.`;
  if (data.status === SMART_WAIT_STATUS) return "Protegida até o pedido atual terminar.";
  if (data.status === "standby") return `${displayCustomerName(data)} foi chamado, mas não compareceu. A chamada ficará em standby por 10 minutos. Aguarde nova chamada.`;
  if (data.status === "chamado") return `Apresente-se no ${data.counterLabel}. ${supportCode(data)}.`;
  if (data.status === "proximo") return "Você será chamado em instantes.";
  if (hasLiveCountdown(data)) return `${displayCustomerName(data)} será chamado em ${formatTimer(data.secondsToCall)}.`;
  if (data.position === 1) return "Você é o próximo da fila.";
  return `${data.ahead} pessoas à frente`;
}

function queueItemLine(data) {
  const priority = priorityText(data);
  if (data.status === SMART_WAIT_STATUS) return "Protegida até o pedido atual terminar";
  if (data.status === "standby") return `Standby - ${formatStandbyTime(data)} restantes`;
  if (data.status === "em_atendimento") return "Atendimento em andamento";
  if (data.status === "chamado") return `${data.counterLabel} - chamado - ${supportCode(data)}`;
  if (data.status === "proximo") return "Próxima chamada";
  if (hasLiveCountdown(data)) return `${priority ? `${priority} - ` : ""}Chamada em ${formatTimer(data.secondsToCall)}`;
  if (data.position === 1) return "Próxima da fila";
  return `${data.ahead} pessoas à frente`;
}

function priorityText(data) {
  return data?.priority ? `Preferencial${data.priorityReason && PRIORITY_LABELS[data.priorityReason] ? ` - ${PRIORITY_LABELS[data.priorityReason]}` : ""}` : "";
}

function displayCustomerName(data) {
  return String(data?.customerName || currentUser?.name || "Cliente").trim() || "Cliente";
}

function supportCode(data) {
  return `Código de apoio: Senha ${supportNumber(data)}`;
}

function nameAndCode(data) {
  return `${displayCustomerName(data)} · Senha ${supportNumber(data)}`;
}

function currentCallText(data) {
  if (!data?.current || data.current === "--") return "--";
  return data.currentCustomerName
    ? `${data.currentCustomerName} · Senha ${supportNumber({ ticket: data.current, ticketNumber: data.currentNumber })}`
    : `Senha ${data.current}`;
}

function supportNumber(data) {
  if (Number.isFinite(Number(data?.ticketNumber))) return String(Number(data.ticketNumber)).padStart(3, "0");
  const match = String(data?.ticket || "").match(/(\d{3})$/);
  return match ? match[1] : data?.ticket || "--";
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

function renderPriorityBadge(element, data) {
  if (!element) return;
  element.hidden = !data?.priority;
  element.innerHTML = data?.priority ? `${priorityIcon()}<span>PREFERENCIAL</span>` : "";
}

function updateFloatingQueue() {
  const hiddenScreens = ["ticket", "status", "done", "rating"];
  const serviceSector = getServiceInProgressSector();
  document.querySelector("#floatingQueue").classList.toggle("visible", hasActiveQueues() && !hiddenScreens.includes(activeScreen));
  document.querySelector("#floatingFinishButton").classList.toggle("visible", Boolean(serviceSector) && !["status", "done", "rating"].includes(activeScreen));
  if (serviceSector) document.querySelector("#floatingFinishButton").textContent = `Informar fim do pedido em ${activeQueues[serviceSector].sector}`;
}

function renderActiveTickets() {
  const list = document.querySelector("#activeTicketList");
  const entries = Object.entries(activeQueues);
  list.innerHTML = entries.length
    ? entries.map(([sectorId, data]) => `
        <button class="mini-ticket ${sectorId === currentSector ? "active" : ""} ${data.priority ? "priority-ticket" : ""}" data-view-ticket="${escapeHtml(sectorId)}">
          <div>
            <strong>${escapeHtml(data.sector)}</strong>
            ${data.priority ? priorityBadgeMarkup() : ""}
            <span>${escapeHtml(`${displayCustomerName(data)} - ${queueItemLine(data)}`)}</span>
          </div>
          <b>${escapeHtml(supportCode(data).replace("Código de apoio: ", ""))}</b>
        </button>
      `).join("")
    : `<div class="empty-state">Você ainda não possui senhas ativas.</div>`;

  document.querySelectorAll("[data-view-ticket]").forEach((button) => {
    button.addEventListener("click", () => {
      currentSector = button.dataset.viewTicket;
      syncQueue();
      navigate("ticket");
    });
  });
}

function renderSectorCards() {
  document.querySelectorAll("[data-join]").forEach((button) => {
    const sectorId = button.dataset.join;
    const sector = sectors[sectorId];
    if (!sector) return;

    const card = button.closest(".sector-card");
    const hasTicket = Boolean(activeQueues[sectorId]);
    card?.classList.toggle("has-ticket", hasTicket);
    card.querySelector(".sector-head strong").textContent = sector.name;
    card.querySelector(".sector-head span").textContent = sector.serviceLabel;
    card.querySelector(".sector-head b").textContent = sector.counterLabel;
    card.querySelector(".sector-meta").innerHTML = `<span>Fila base: ${escapeHtml(sector.queueSize)} pessoas</span><span>${escapeHtml(sector.status === "open" ? `${sector.averageServiceSeconds}s por atendimento` : "Setor indisponível")}</span>`;
    button.disabled = sector.status !== "open" || Boolean(activeJoinSector);
    button.textContent = hasTicket ? `Ver ${displayCustomerName(activeQueues[sectorId])}` : `Solicitar senha - ${sector.name}`;
    if (activeJoinSector === sectorId) button.textContent = "Gerando senha...";
  });

  document.querySelectorAll("[data-quick-join]").forEach((button) => {
    const sectorId = button.dataset.quickJoin;
    const sector = sectors[sectorId];
    if (!sector) return;
    const hasTicket = Boolean(activeQueues[sectorId]);
    button.disabled = sector.status !== "open" || Boolean(activeJoinSector);
    button.classList.toggle("has-ticket", hasTicket);
    button.textContent = activeJoinSector === sectorId ? "..." : hasTicket ? displayCustomerName(activeQueues[sectorId]) : sector.name;
  });
}

function renderOfferQueueContext() {
  const box = document.querySelector("#offersQueue");
  const data = getCurrentQueueData();
  box.classList.toggle("visible", Boolean(data));
  box.innerHTML = data
    ? `<span>${escapeHtml(data.sector)}: ${escapeHtml(nameAndCode(data))}</span><b>${escapeHtml(statusText(data))}</b>`
    : "";
}

function renderCart() {
  const list = document.querySelector("#cartList");
  if (!list) return;
  list.innerHTML = cartItems.length
    ? cartItems.map((item) => `
        <div class="cart-item" data-cart-item="${escapeHtml(item.id)}">
          <div class="cart-item-main">
            <span>${escapeHtml(item.productName)}</span>
            <small>${escapeHtml(item.sectorName || "Lista")}</small>
          </div>
          <div class="cart-item-controls" aria-label="Editar ${escapeHtml(item.productName)}">
            <button type="button" data-cart-decrease="${escapeHtml(item.id)}" data-online-required aria-label="Diminuir quantidade">−</button>
            <b>${escapeHtml(item.quantity)}</b>
            <button type="button" data-cart-increase="${escapeHtml(item.id)}" data-online-required aria-label="Aumentar quantidade">+</button>
            <button class="remove" type="button" data-cart-remove="${escapeHtml(item.id)}" data-online-required aria-label="Remover item">×</button>
          </div>
          <strong>${escapeHtml(item.price)}</strong>
        </div>
      `).join("")
    : `<div class="empty-state">Nenhum produto adicionado.</div>`;
  bindCartItemActions();
}

function bindCartItemActions() {
  document.querySelectorAll("[data-cart-increase]").forEach((button) => button.addEventListener("click", () => changeCartItemQuantity(button.dataset.cartIncrease, 1)));
  document.querySelectorAll("[data-cart-decrease]").forEach((button) => button.addEventListener("click", () => changeCartItemQuantity(button.dataset.cartDecrease, -1)));
  document.querySelectorAll("[data-cart-remove]").forEach((button) => button.addEventListener("click", () => removeCartItemFromList(button.dataset.cartRemove)));
}

function renderProducts() {
  productsRendered = true;
  const groups = personalizedProductGroups();
  syncShoppingPreferenceControls();
  document.querySelector("#productList").innerHTML = groups.length ? groups
    .map((group, index) => `
        <section class="offer-section ${group.personalized ? "personalized-offers" : ""}">
          <div>
            <h3>${escapeHtml(groupTitle(group, index))}</h3>
            <span class="offer-section-count">${escapeHtml(groupSubtitle(group))}</span>
          </div>
          ${group.items.map((item) => productCard(group.sector, item)).join("")}
        </section>
      `)
    .join("") : `<div class="empty-state">Nenhum item encontrado para sua busca.</div>`;

  document.querySelectorAll("[data-product]").forEach((button) => button.addEventListener("click", () => openProduct(button.dataset.product)));
}

function personalizedProductGroups() {
  const currentTicket = getCurrentQueueData();
  const favoriteProducts = new Map((shoppingAgentProfile.favoriteProducts || []).map((item) => [item.productId, Number(item.quantity || 1)]));
  const terms = normalizedTerms(productSearchTerm);

  if (terms.length) return searchedProductGroups(terms, favoriteProducts);

  const used = new Set();
  const groups = [];
  const addGroup = (sector, subtitle, items, options = {}) => {
    const uniqueItems = applyShoppingSectorFilter(uniqueProducts(items))
      .filter((item) => !used.has(item.id))
      .slice(0, options.limit || 8);
    if (!uniqueItems.length) return;
    uniqueItems.forEach((item) => used.add(item.id));
    groups.push({ sector, subtitle, personalized: true, items: uniqueItems });
  };

  if (shoppingRecommendationMode === "auto" || shoppingRecommendationMode === "history") {
    addGroup(
      "Mais selecionados por você",
      "Produtos que aparecem no seu histórico e na sua lista atual.",
      productsFromCustomerBehavior(favoriteProducts),
      { limit: shoppingRecommendationMode === "history" ? 12 : 8 }
    );
  }

  if (shoppingRecommendationMode === "auto" || shoppingRecommendationMode === "context") {
    addGroup(
      currentTicket ? `Combina com ${currentTicket.sector}` : "Sugestões pelo seu contexto",
      contextSubtitle(currentTicket),
      contextualProducts(currentTicket, used),
      { limit: shoppingRecommendationMode === "context" ? 12 : 10 }
    );
  }

  if (shoppingRecommendationMode === "auto") {
    addGroup(
      "Combina com seu perfil",
      profileMatchSubtitle(),
      profileMatchProducts(currentTicket, used),
      { limit: 8 }
    );
  }

  if (shoppingRecommendationMode === "auto" || shoppingRecommendationMode === "time") {
    addGroup(
      "Talvez faça sentido agora",
      timeAwareSubtitle(),
      timeAwareProducts(used),
      { limit: shoppingRecommendationMode === "time" ? 12 : 8 }
    );
  }

  if (shoppingRecommendationMode === "essentials") {
    addGroup(
      "Essenciais da compra",
      "Itens básicos para completar a lista sem depender do histórico.",
      essentialProducts(used),
      { limit: 14 }
    );
  }

  if (!groups.length) {
    addGroup(
      "Comece sua lista",
      "Itens recorrentes para iniciar uma compra sem abrir o catálogo completo.",
      keywordProducts(["arroz", "feijao", "leite", "cafe", "pao", "manteiga", "refrigerante", "macarrao", "molho", "banana"], [], used),
      { limit: 12 }
    );
  }

  return groups;
}

function searchedProductGroups(terms, favoriteProducts) {
  return productGroups
    .map((group) => ({
      ...group,
      items: applyShoppingSectorFilter(group.items.filter((item) => productMatchesSearch(item, terms)))
    }))
    .filter((group) => group.items.length)
    .map((group) => ({
      ...group,
      items: orderItemsByRelevance(group.items, favoriteProducts, terms).slice(0, 8),
      score: group.items.reduce((sum, item) => sum + productRelevanceScore(item, favoriteProducts, terms), 0)
    }))
    .sort((first, second) => second.score - first.score || groupIndex(first.sector) - groupIndex(second.sector))
    .slice(0, 4);
}

function orderItemsByRelevance(items, favoriteProducts, terms) {
  return [...items].sort((first, second) => productRelevanceScore(second, favoriteProducts, terms) - productRelevanceScore(first, favoriteProducts, terms));
}

function productRelevanceScore(item, favoriteProducts, terms) {
  let score = 0;
  if (favoriteProducts.has(item.id)) score += 35 + favoriteProducts.get(item.id);
  if (shoppingList.has(item.id)) score += 20;
  if (terms.length) score += searchScore(item, terms) * 8;
  score += sectorBehaviorScore(item.sector);
  return score;
}

function personalizedGroupScore(group, index, priority, addedSectors, favoriteSectors, favoriteProducts) {
  const priorityIndex = priority.indexOf(group.sector);
  const priorityScore = priorityIndex >= 0 ? 100 - priorityIndex * 8 : 0;
  const behaviorScore = favoriteSectors.has(group.sector) ? 55 : 0;
  const productScore = group.items.filter((item) => favoriteProducts.has(item.id)).length * 7;
  const listScore = addedSectors.has(group.sector) ? 18 : 0;
  return priorityScore + behaviorScore + productScore + listScore - index;
}

function groupTitle(group, index) {
  const currentTicket = getCurrentQueueData();
  if (group.personalized) return group.sector;
  if (index === 0 && currentTicket) return `Recomendado para ${currentTicket.sector}`;
  if (shoppingList.size && group.items.some((item) => shoppingList.has(item.id))) return `${group.sector} na sua lista`;
  return group.sector;
}

function groupSubtitle(group) {
  if (group.personalized) return group.subtitle;
  const added = group.items.filter((item) => shoppingList.has(item.id)).length;
  return added
    ? `${added} na lista · ${group.items.length} itens`
    : `${group.items.length} itens disponíveis`;
}

const shoppingContextRules = {
  acougue: {
    sectors: ["Bebidas", "Padaria", "Mercearia", "Hortifruti"],
    keywords: ["carvao", "carvão", "refrigerante", "suco", "pao", "pão", "cebola", "tomate", "batata", "molho", "oleo"],
    subtitle: "Complementos prováveis para quem está no açougue, priorizando churrasco e preparo da carne."
  },
  frios: {
    sectors: ["Padaria", "Frios e Laticínios", "Mercearia", "Bebidas"],
    keywords: ["pao", "pão", "baguete", "manteiga", "requeijao", "queijo", "presunto", "cafe", "suco", "molho", "macarrao"],
    subtitle: "Itens que costumam acompanhar frios, lanches rápidos e reposição de geladeira."
  },
  padaria: {
    sectors: ["Frios e Laticínios", "Mercearia", "Bebidas", "Hortifruti"],
    keywords: ["cafe", "leite", "manteiga", "requeijao", "queijo", "presunto", "suco", "banana", "maca", "iogurte"],
    subtitle: "Combinações de café da manhã e lanche para complementar a padaria."
  }
};

function productsFromCustomerBehavior(favoriteProducts) {
  const selected = [
    ...cartItems.map((item) => findProduct(item.productId)).filter(Boolean),
    ...[...favoriteProducts.keys()].map((id) => findProduct(id)).filter(Boolean)
  ];
  return uniqueProducts(selected).sort((first, second) => (favoriteProducts.get(second.id) || 0) - (favoriteProducts.get(first.id) || 0));
}

function contextualProducts(currentTicket, exclude = new Set()) {
  const sectorId = currentTicket?.sectorId || favoriteSectorId();
  const rule = shoppingContextRules[sectorId];
  const keywords = rule?.keywords || recentSearchKeywords();
  const sectors = rule?.sectors || favoriteSectorNames();
  return keywordProducts(keywords, sectors, exclude);
}

function profileMatchProducts(currentTicket, exclude = new Set()) {
  const sectorId = currentTicket?.sectorId;
  const clusters = shoppingAgentProfile.clusterSuggestions || [];
  const sortedClusters = [...clusters].sort((first, second) => clusterPriority(second, sectorId) - clusterPriority(first, sectorId));
  const keywords = sortedClusters.flatMap((cluster) => cluster.keywords || []);
  const sectors = sortedClusters.flatMap((cluster) => cluster.sectors || []);
  return keywordProducts(keywords.length ? keywords : recentSearchKeywords(), sectors, exclude);
}

function timeAwareProducts(exclude = new Set()) {
  const preferred = shoppingAgentProfile.preferredHourBucket || currentHourBucket();
  const keywordsByTime = {
    manha: ["cafe", "leite", "pao", "manteiga", "requeijao", "banana", "iogurte"],
    almoco: ["arroz", "feijao", "macarrao", "molho", "batata", "tomate", "suco"],
    tarde: ["pao", "bolo", "cafe", "suco", "iogurte", "queijo", "presunto"],
    noite: ["macarrao", "molho", "queijo", "refrigerante", "suco", "pao"],
    madrugada: ["leite", "pao", "cafe", "banana"]
  };
  return keywordProducts(keywordsByTime[preferred] || keywordsByTime.tarde, favoriteSectorNames(), exclude);
}

function keywordProducts(keywords, sectors = [], exclude = new Set()) {
  const terms = [...new Set((keywords || []).map(normalizeSearch).filter(Boolean))];
  const sectorSet = new Set((sectors || []).map(normalizeSearch));
  return productCatalog
    .filter((item) => !exclude.has(item.id))
    .map((item) => ({ item, score: productContextScore(item, terms, sectorSet) }))
    .filter((entry) => entry.score > 0)
    .sort((first, second) => second.score - first.score || first.item.name.localeCompare(second.item.name))
    .map((entry) => entry.item);
}

function essentialProducts(exclude = new Set()) {
  return keywordProducts(["arroz", "feijao", "leite", "cafe", "pao", "manteiga", "macarrao", "molho", "banana", "refrigerante", "suco", "oleo"], [], exclude);
}

function productContextScore(item, terms, sectors) {
  const haystack = normalizeSearch(`${item.name} ${item.baseName} ${item.brand} ${item.category} ${item.sector} ${item.searchText}`);
  const sectorScore = sectors.has(normalizeSearch(item.sector)) ? 8 : 0;
  const keywordScore = terms.reduce((score, term) => score + (haystack.includes(term) ? 18 : 0), 0);
  const behaviorScore = sectorBehaviorScore(item.sector);
  const listScore = shoppingList.has(item.id) ? 12 : 0;
  return keywordScore + sectorScore + behaviorScore + listScore;
}

function uniqueProducts(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function contextSubtitle(currentTicket) {
  const rule = shoppingContextRules[currentTicket?.sectorId];
  return rule?.subtitle || "Produtos sugeridos por setor, lista atual e histórico recente.";
}

function profileMatchSubtitle() {
  const cluster = (shoppingAgentProfile.clusterSuggestions || [])[0];
  return cluster?.name
    ? `Combinações frequentes para ${cluster.name.toLowerCase()} e produtos próximos ao seu padrão de compra.`
    : "Sugestões baseadas nas combinações mais prováveis para o seu perfil.";
}

function timeAwareSubtitle() {
  const bucket = shoppingAgentProfile.preferredHourBucket || currentHourBucket();
  return `Ajustado para o período ${bucket} e para os setores que você mais usa.`;
}

function clusterPriority(cluster, sectorId) {
  let score = Number(cluster.score || 0);
  if (sectorId && (cluster.triggerSectors || []).includes(sectorId)) score += 30;
  return score;
}

function favoriteSectorId() {
  const label = (shoppingAgentProfile.favoriteSectors || [])[0]?.sectorName || "";
  const normalized = normalizeSearch(label);
  if (normalized.includes("acougue")) return "acougue";
  if (normalized.includes("frios")) return "frios";
  if (normalized.includes("padaria")) return "padaria";
  return "";
}

function favoriteSectorNames() {
  return (shoppingAgentProfile.favoriteSectors || []).map((item) => item.sectorName).filter(Boolean);
}

function recentSearchKeywords() {
  return (shoppingAgentProfile.recentSearches || []).flatMap((item) => normalizedTerms(item.query)).slice(0, 12);
}

function currentHourBucket() {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 11) return "manha";
  if (hour >= 11 && hour < 14) return "almoco";
  if (hour >= 14 && hour < 18) return "tarde";
  if (hour >= 18 && hour < 22) return "noite";
  return "madrugada";
}

function applyShoppingSectorFilter(items) {
  const sectors = shoppingSectorFilters[shoppingSectorFilter] || [];
  if (!sectors.length) return items;
  const accepted = new Set(sectors.map(normalizeSearch));
  return items.filter((item) => accepted.has(normalizeSearch(item.sector)));
}

function syncShoppingPreferenceControls() {
  document.querySelectorAll("[data-shopping-mode]").forEach((button) => {
    const active = button.dataset.shoppingMode === shoppingRecommendationMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll("[data-shopping-sector]").forEach((button) => {
    const active = button.dataset.shoppingSector === shoppingSectorFilter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function normalizedTerms(value) {
  return normalizeSearch(value).split(" ").filter((term) => term.length > 1);
}

function normalizeSearch(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function productMatchesSearch(item, terms) {
  if (!terms.length) return true;
  const haystack = normalizeSearch(`${item.name} ${item.baseName} ${item.brand} ${item.weight} ${item.category} ${item.sector} ${item.searchText}`);
  return terms.every((term) => haystack.includes(term));
}

function searchScore(item, terms) {
  if (!terms.length) return 0;
  const haystack = normalizeSearch(`${item.name} ${item.baseName} ${item.brand} ${item.weight} ${item.category} ${item.sector} ${item.searchText}`);
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function sectorBehaviorScore(sectorName) {
  const match = (shoppingAgentProfile.favoriteSectors || []).find((item) => item.sectorName === sectorName);
  return match ? Math.min(30, Number(match.quantity || 1) * 4) : 0;
}

function groupIndex(sector) {
  const index = productGroups.findIndex((group) => group.sector === sector);
  return index >= 0 ? index : productGroups.length;
}

function syncActionButtons() {
  renderSectorCards();
}

function productCard(sector, item) {
  const added = shoppingList.has(item.id);
  const displaySector = item.sector || sector;
  return `
    <button class="product-card ${added ? "added" : ""}" data-product="${escapeHtml(item.id)}">
      <span class="sale">${escapeHtml(item.sale)}</span>
      <img class="product-img" src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" loading="lazy" />
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <small>${escapeHtml(displaySector)}</small>
        <del>${escapeHtml(item.old)}</del>
        <b>${escapeHtml(item.price)}</b>
      </div>
      <span class="add-indicator">${added ? "✓" : "+"}</span>
    </button>
  `;
}

function findProduct(id) {
  return productGroups.flatMap((group) => group.items.map((item) => ({ ...item, sector: group.sector }))).find((item) => item.id === id);
}

function openProduct(id) {
  const item = findProduct(id);
  if (!item) return;
  recordShoppingSignal({ type: "view", productId: item.id, productName: item.name, sectorName: item.sector });
  document.querySelector("#detailName").textContent = item.name;
  document.querySelector("#detailDescription").textContent = item.description;
  document.querySelector("#detailOld").textContent = item.old;
  document.querySelector("#detailPrice").textContent = item.price;
  document.querySelector("#detailSector").textContent = item.sector;
  document.querySelector("#detailPhoto").src = item.image;
  document.querySelector("#detailPhoto").alt = item.name;
  document.querySelector("#addProduct").dataset.productId = item.id;
  document.querySelector("#addProduct").textContent = shoppingList.has(item.id) ? "Produto na lista" : "Adicionar à lista";
  document.querySelector("#toast").classList.remove("visible");
  navigate("detail");
}

async function addCurrentProduct() {
  const productId = document.querySelector("#addProduct").dataset.productId;
  if (!productId) return;
  const item = findProduct(productId);
  try {
    const result = await api("/api/cart/items", {
      method: "POST",
      body: {
        customerId: identity.customerId,
        productId,
        productName: item.name,
        sectorName: item.sector,
        price: item.price
      }
    });
    upsertLocalCartItem(result.item);
    refreshShoppingAgentInBackground();
    document.querySelector("#addProduct").textContent = "Produto na lista";
    document.querySelector("#toast").classList.add("visible");
    updateProductCard(productId);
  } catch (exception) {
    alert(exception.message);
  }
}

async function changeCartItemQuantity(itemId, delta) {
  const item = cartItems.find((entry) => entry.id === itemId);
  if (!item) return;
  const nextQuantity = Number(item.quantity || 1) + delta;
  if (nextQuantity < 1) {
    await removeCartItemFromList(itemId);
    return;
  }
  try {
    const result = await api(`/api/cart/items/${encodeURIComponent(itemId)}`, {
      method: "PATCH",
      body: { quantity: nextQuantity }
    });
    upsertLocalCartItem(result.item);
    refreshShoppingAgentInBackground();
  } catch (exception) {
    alert(exception.message);
  }
}

async function removeCartItemFromList(itemId) {
  try {
    await api(`/api/cart/items/${encodeURIComponent(itemId)}`, {
      method: "DELETE"
    });
    cartItems = cartItems.filter((item) => item.id !== itemId);
    syncCartViews();
    refreshShoppingAgentInBackground();
  } catch (exception) {
    alert(exception.message);
  }
}

function recordShoppingSignal(signal) {
  if (!currentUser) return;
  api("/api/shopping-signals", {
    method: "POST",
    body: signal
  }).catch((exception) => console.warn(exception));
}

function updateProductCard(productId) {
  const card = document.querySelector(`[data-product="${CSS.escape(productId)}"]`);
  if (!card) return;
  card.classList.add("added");
  const indicator = card.querySelector(".add-indicator");
  if (indicator) indicator.textContent = "✓";
}

function notifyTicketCalled(ticket) {
  if (alertPreferences.sound) playQueueAlertSound();
  if (alertPreferences.vibration) vibrateQueueAlert(1);
}

function handleNotifyButton() {
  navigate("account");
  setTimeout(() => window.senhaHubPwa?.openNotificationSettings(), 0);
}

async function sendRating() {
  const selected = document.querySelector("[data-rating].selected");
  await api("/api/ratings", {
    method: "POST",
    body: {
      customerId: identity.customerId,
      ticketId: getCurrentQueueData()?.id || null,
      score: selected?.dataset.rating || "sem_nota",
      comment: document.querySelector("#ratingComment").value
    }
  });
  document.querySelector("#ratingToast").classList.add("visible");
}

async function logoutAccount() {
  try {
    await window.senhaHubPwa?.prepareLogout();
    await api("/api/auth/logout", { method: "POST" });
  } catch (exception) {
    console.warn(exception);
  } finally {
    stateSource?.close();
    localStorage.removeItem("senhaHubIdentity");
    location.href = "/login";
  }
}

function bindEvents() {
  document.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.go)));
  document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.tab)));
  document.querySelectorAll("[data-join]").forEach((button) => button.addEventListener("click", () => joinQueue(button.dataset.join)));
  document.querySelectorAll("[data-quick-join]").forEach((button) => button.addEventListener("click", () => joinQueue(button.dataset.quickJoin)));
  document.querySelector("#backButton").addEventListener("click", () => navigate("home"));
  document.querySelector("#notifyButton").addEventListener("click", handleNotifyButton);
  document.querySelector("#floatingQueue").addEventListener("click", () => navigate("status"));
  document.querySelector("#confirmCall").addEventListener("click", confirmCall);
  document.querySelector("#ticketCancelButton").addEventListener("click", () => cancelCurrentTicket());
  document.querySelector("#statusCancelButton").addEventListener("click", () => cancelCurrentTicket());
  document.querySelector("#completeServiceButton").addEventListener("click", finishCurrentService);
  document.querySelector("#statusFinishButton").addEventListener("click", finishCurrentService);
  document.querySelector("#floatingFinishButton").addEventListener("click", finishCurrentService);
  document.querySelector("#addProduct").addEventListener("click", addCurrentProduct);
  document.querySelector("#productSearch")?.addEventListener("input", handleProductSearch);
  document.querySelectorAll("[data-shopping-mode]").forEach((button) => button.addEventListener("click", () => handleShoppingMode(button.dataset.shoppingMode)));
  document.querySelectorAll("[data-shopping-sector]").forEach((button) => button.addEventListener("click", () => handleShoppingSector(button.dataset.shoppingSector)));
  document.querySelector("#queueHelpButton")?.addEventListener("click", () => openQueueTutorial());
  document.querySelector("#ticketHelpButton")?.addEventListener("click", () => openQueueTutorial());
  document.querySelector("#statusHelpButton")?.addEventListener("click", () => openQueueTutorial());
  document.querySelector("#tutorialClose")?.addEventListener("click", closeQueueTutorial);
  document.querySelector("#tutorialDone")?.addEventListener("click", closeQueueTutorial);
  document.querySelector("#queueTutorial")?.addEventListener("click", (event) => {
    if (event.target.id === "queueTutorial") closeQueueTutorial();
  });
  document.querySelector("#priorityToggle")?.addEventListener("change", syncPriorityControls);
  document.querySelector("#priorityReason")?.addEventListener("change", syncPriorityControls);
  document.querySelector("#soundAlertToggle")?.addEventListener("change", (event) => updateAlertPreference("sound", event.target.checked));
  document.querySelector("#vibrationAlertToggle")?.addEventListener("change", (event) => updateAlertPreference("vibration", event.target.checked));
  document.querySelectorAll("[data-rating]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-rating]").forEach((item) => {
        item.classList.remove("selected");
        item.setAttribute("aria-pressed", "false");
      });
      button.classList.add("selected");
      button.setAttribute("aria-pressed", "true");
    });
  });
  document.querySelector("#sendRating").addEventListener("click", sendRating);
  document.querySelector("#logoutButton")?.addEventListener("click", logoutAccount);
  window.addEventListener("senhahub:push", handlePushRefresh);
  window.addEventListener("senhahub:notification-click", handlePushRefresh);
  window.addEventListener("senhahub:reconnected", () => loadState().catch(() => {}));
}

function handleProductSearch(event) {
  productSearchTerm = event.target.value.trim();
  if (productsRendered) renderProducts();
  clearTimeout(productSearchSignalTimer);
  productSearchSignalTimer = setTimeout(() => {
    if (productSearchTerm.length >= 2) recordShoppingSignal({ type: "search", query: productSearchTerm });
  }, 650);
}

function handleShoppingMode(mode) {
  if (!["auto", "history", "context", "time", "essentials"].includes(mode)) return;
  shoppingRecommendationMode = mode;
  if (productsRendered) renderProducts();
}

function handleShoppingSector(sector) {
  if (!Object.prototype.hasOwnProperty.call(shoppingSectorFilters, sector)) return;
  shoppingSectorFilter = sector;
  if (productsRendered) renderProducts();
}

function syncPriorityControls() {
  const toggle = document.querySelector("#priorityToggle");
  const reason = document.querySelector("#priorityReason");
  if (!toggle || !reason) return;
  reason.disabled = !toggle.checked;
  if (!toggle.checked) reason.value = "";
}

function formatTimer(totalSeconds) {
  const safeSeconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const minutes = String(Math.floor(safeSeconds / 60)).padStart(2, "0");
  const seconds = String(safeSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
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
    if (response.status === 401) {
      location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
      throw new Error("Login necessÃ¡rio.");
    }
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
  const token = getCookie("senhahub_local_csrf") || getCookie("senhahub_csrf");
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

window.ticketOrchestration = {
  callNextEligibleTicket: (sectorId) => api(`/api/sectors/${sectorId}/call-next`, { method: "POST" }),
  finishService: (ticketId) => api(`/api/tickets/${ticketId}/finish`, { method: "POST" }),
  getState: loadState
};
