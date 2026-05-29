const screens = {
  qr: "Supermercado Pompeia",
  home: "Supermercado Pompeia",
  sectors: "Fila virtual",
  ticket: "Minha senha",
  status: "Acompanhamento",
  offers: "Ofertas",
  detail: "Detalhe da promoção",
  done: "Atendimento",
  access: "Conta e acesso",
  rating: "Avaliação"
};

const SMART_WAIT_STATUS = "espera_inteligente";
const CANCELABLE_STATUSES = new Set(["aguardando", "proximo", "chamado", SMART_WAIT_STATUS, "standby"]);
const QR_SECTORS = new Set(["acougue", "frios", "padaria"]);
const shoppingList = new Set();
let cartItems = [];
const identity = getOrCreateIdentity();
let currentUser = null;
let presenceCheckins = JSON.parse(localStorage.getItem("filaZeroPresenceCheckins") || "{}");

let activeScreen = "qr";
let currentSector = null;
let activeQueues = {};
let sectors = {};
let stateSource = null;
let pollingTimer = null;
let previousTicketStatuses = new Map();
let countdownTimer = null;
let activeJoinSector = null;
let productsRendered = false;

const productGroups = [
  group("Açougue", [
    product("picanha", "Picanha Bovina", "R$ 69,90", "R$ 59,90", "-14%", "Corte selecionado para churrasco, disponível no balcão do açougue.", "picanha steak"),
    product("contra-file", "Contra-filé", "R$ 44,90", "R$ 36,90", "-18%", "Peça fresca para grelha, chapa ou preparo do dia.", "beef steak"),
    product("alcatra", "Alcatra", "R$ 49,90", "R$ 41,90", "-16%", "Corte macio para bifes, assados e receitas rápidas.", "raw beef")
  ]),
  group("Frios e Laticínios", [
    product("mussarela", "Queijo Mussarela", "R$ 34,90", "R$ 27,90", "-20%", "Fatiado na hora no setor de frios.", "mozzarella cheese"),
    product("presunto", "Presunto Cozido", "R$ 29,90", "R$ 23,90", "-20%", "Presunto fatiado para lanches e café da manhã.", "sliced ham"),
    product("requeijao", "Requeijão Cremoso", "R$ 12,90", "R$ 9,90", "-23%", "Oferta válida para unidade tradicional.", "cream cheese")
  ]),
  group("Padaria", [
    product("pao-frances", "Pão Francês", "R$ 16,90", "R$ 12,90", "-24%", "Pão francês produzido na padaria Pompeia.", "fresh bread"),
    product("croissant", "Croissant", "R$ 8,90", "R$ 6,90", "-22%", "Croissant folhado para consumo imediato.", "croissant"),
    product("bolo-cenoura", "Bolo de Cenoura", "R$ 24,90", "R$ 19,90", "-20%", "Bolo com cobertura de chocolate.", "carrot cake")
  ]),
  group("Hortifruti", [
    product("banana", "Banana Nanica", "R$ 6,99", "R$ 4,99", "-29%", "Fruta selecionada no hortifruti.", "banana"),
    product("maca", "Maçã Fuji", "R$ 12,99", "R$ 9,99", "-23%", "Maçã fresca e crocante.", "apple fruit"),
    product("tomate", "Tomate Italiano", "R$ 10,99", "R$ 7,99", "-27%", "Ideal para saladas e molhos.", "tomatoes")
  ]),
  group("Mercearia", [
    product("arroz", "Arroz Tipo 1", "R$ 29,90", "R$ 24,90", "-17%", "Pacote 5 kg.", "rice bag"),
    product("feijao", "Feijão Carioca", "R$ 9,90", "R$ 7,90", "-20%", "Pacote 1 kg.", "beans"),
    product("cafe", "Café Torrado", "R$ 18,90", "R$ 15,90", "-16%", "Café torrado e moído.", "coffee bag")
  ])
];

init();

async function init() {
  renderProducts();
  bindEvents();
  syncPresenceStatus();
  currentUser = await requireSession(["customer"]);
  identity.customerId = currentUser.customerId;
  localStorage.setItem("filaZeroIdentity", JSON.stringify(identity));
  await syncSession();
  await loadCart();
  await loadState();
  connectRealtime();
  startCountdownTimer();
  navigate("home");
}

function getOrCreateIdentity() {
  const params = new URLSearchParams(location.search);
  const sharedCustomerId = params.get("cliente") || params.get("customer_id");
  const stored = JSON.parse(localStorage.getItem("filaZeroIdentity") || "{}");
  const identity = {
    customerId: sharedCustomerId || stored.customerId || `cliente-${crypto.randomUUID()}`,
    deviceId: stored.deviceId || `device-${crypto.randomUUID()}`
  };
  localStorage.setItem("filaZeroIdentity", JSON.stringify(identity));
  return identity;
}

async function syncSession() {
  const session = await api("/api/sessions", {
    method: "POST",
    body: identity
  });
  identity.customerId = session.customerId;
  identity.deviceId = session.deviceId;
  localStorage.setItem("filaZeroIdentity", JSON.stringify(identity));
}

async function loadState() {
  const state = await api(`/api/state?customer_id=${encodeURIComponent(identity.customerId)}`);
  applyState(state);
}

async function loadCart() {
  const result = await api(`/api/cart?customer_id=${encodeURIComponent(identity.customerId)}`);
  cartItems = result.items;
  shoppingList.clear();
  cartItems.forEach((item) => shoppingList.add(item.productId));
  renderCart();
}

function connectRealtime() {
  stateSource?.close();
  stateSource = new EventSource("/api/events");
  stateSource.addEventListener("state", (event) => applyState(JSON.parse(event.data)));
  stateSource.addEventListener("error", () => startStatePolling());
  startStatePolling();
}

function startStatePolling() {
  if (pollingTimer) return;
  pollingTimer = setInterval(() => {
    loadState().catch(() => {});
  }, 3000);
}

function applyState(state) {
  const nextStatuses = new Map();
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
  if (!currentSector || !activeQueues[currentSector]) currentSector = Object.keys(activeQueues)[0] || null;
  syncPresenceStatus();
  syncQueue();
}

function startCountdownTimer() {
  if (countdownTimer) return;
  countdownTimer = setInterval(() => {
    if (!Object.values(activeQueues).some(hasLiveCountdown)) return;
    activeQueues = Object.fromEntries(
      Object.entries(activeQueues).map(([sectorId, ticket]) => [sectorId, withLiveCountdown(ticket)])
    );
    syncQueue();
  }, 1000);
}

function withLiveCountdown(ticket) {
  if (!hasLiveCountdown(ticket)) return ticket;
  const remaining = Math.ceil((new Date(ticket.estimatedCallAt).getTime() - Date.now()) / 1000);
  return {
    ...ticket,
    secondsToCall: Math.max(0, remaining),
    countdownTotalSeconds: Math.max(ticket.countdownTotalSeconds || 0, remaining)
  };
}

function hasLiveCountdown(ticket) {
  return Boolean(ticket?.estimatedCallAt && ["aguardando", "proximo", "standby"].includes(ticket.status));
}

function group(sector, items) {
  return { sector, items };
}

function product(id, name, old, price, sale, description, query) {
  return { id, name, old, price, sale, description, image: `https://source.unsplash.com/220x180/?${encodeURIComponent(query)}` };
}

function navigate(screen) {
  if (!screens[screen]) return;
  activeScreen = screen;
  document.querySelectorAll(".screen").forEach((item) => item.classList.toggle("active", item.dataset.screen === screen));
  document.querySelector("#appTitle").textContent = screens[screen];
  if (screen === "done") renderServiceScreen();
  if (screen === "offers") renderOfferQueueContext();
  updateTabs(screen);
  updateFloatingQueue();
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
    const presence = await getPresencePayload(sectorId);
    const result = await api("/api/tickets", {
      method: "POST",
      body: { ...identity, sectorId, ...presence }
    });
    currentSector = result.ticket.sectorId;
    activeQueues[result.ticket.sectorId] = withLiveCountdown(result.ticket);
    syncQueue();
    navigate("ticket");
  } catch (exception) {
    alert(exception.message);
  } finally {
    activeJoinSector = null;
    syncActionButtons();
  }
}

function syncQueue() {
  const activeCount = Object.keys(activeQueues).length;
  const data = getCurrentQueueData();
  const serviceSector = getServiceInProgressSector();
  const hasQueue = Boolean(data);

  document.querySelector("#queueBanner").classList.toggle("visible", hasQueue);
  document.querySelector("#bannerTicket").textContent = hasQueue ? data.ticket : "";
  document.querySelector("#bannerText").textContent = hasQueue ? bannerText(data, activeCount) : "";
  document.querySelector("#bannerProgress").style.width = hasQueue ? `${data.progress}%` : "0%";

  document.querySelector("#ticketNumber").textContent = hasQueue ? data.ticket : "--";
  document.querySelector("#ticketSector").textContent = hasQueue ? data.sector : "Nenhuma senha ativa";
  document.querySelector("#ticketSub").textContent = hasQueue ? ticketSubText(data) : "Solicite uma senha em um setor para acompanhar.";
  document.querySelector("#currentQueue").textContent = hasQueue ? data.current : "--";

  document.querySelector("#statusSector").textContent = hasQueue ? `${data.sector} - ${data.counterLabel}` : "Nenhuma senha ativa";
  document.querySelector("#positionNumber").textContent = hasQueue ? positionText(data) : "--";
  document.querySelector("#estimatedTime").textContent = hasQueue ? statusText(data) : "Sem atendimento em andamento";
  document.querySelector("#timeInfo").textContent = hasQueue ? timeInfoText(data) : "--";
  document.querySelector("#aheadInfo").textContent = hasQueue ? aheadInfoText(data) : "--";
  document.querySelector(".progress-donut").style.setProperty("--donut-progress", `${hasQueue ? donutProgress(data) : 0}%`);

  document.querySelector("#statusFinishButton").classList.toggle("visible", Boolean(serviceSector));
  document.querySelector("#statusFinishButton").textContent = serviceSector && serviceSector !== currentSector
    ? `Informar fim do pedido em ${activeQueues[serviceSector].sector}`
    : "Informar fim do pedido";

  document.querySelector("#callText").textContent = hasQueue
    ? `Dirija-se ao ${data.counterLabel} de ${data.sector}. Sua senha ${data.ticket} foi chamada.`
    : "";
  document.querySelector("#floatingTicket").textContent = hasQueue ? data.ticket : "";
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
  if (!confirm(`Cancelar a senha ${data.ticket} de ${data.sector}?`)) return;

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
    document.querySelector("#serviceCurrent").textContent = "Senha atual: --";
    document.querySelector("#serviceNext").textContent = hasActiveQueues() ? "Você ainda possui senhas ativas." : "Nenhuma senha ativa.";
    document.querySelector("#completeServiceButton").textContent = hasActiveQueues() ? "Voltar para minhas senhas" : "Ir para avaliação";
    return;
  }

  document.querySelector("#serviceTitle").textContent = "Pedido em atendimento";
  document.querySelector("#serviceMessage").textContent =
    "Quando o pedido terminar, informe no app para liberar a próxima senha protegida.";
  document.querySelector("#serviceCurrent").textContent = `Senha atual: ${current.ticket} - ${current.sector}`;
  document.querySelector("#serviceNext").textContent = smartWait
    ? `Próxima protegida: ${smartWait.ticket} - ${smartWait.sector}.`
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
  if (data.status === "standby") return "Standby";
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
  if (data.status === "standby") return "Até 10 min para retorno";
  if (data.status === "chamado") return "Dirija-se ao balcão";
  if (data.status === "em_atendimento") return "Pedido em andamento";
  if (hasLiveCountdown(data)) return formatTimer(data.secondsToCall);
  if (data.position === 1) return "Aguardando chamada";
  return formatTimer(data.secondsToCall);
}

function aheadInfoText(data) {
  if (data.status === SMART_WAIT_STATUS) return "Aguardando fim do pedido atual";
  if (data.status === "standby") return "Será chamada novamente após o próximo atendimento";
  if (data.status === "chamado" || data.status === "em_atendimento") return "Você é o atendimento atual";
  if (data.position === 1) return "Você é o próximo";
  return `${data.ahead} pessoas`;
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
  if (data.status === "em_atendimento") return `Pedido em atendimento no ${data.counterLabel}.`;
  if (data.status === SMART_WAIT_STATUS) return "Protegida até o pedido atual terminar.";
  if (data.status === "standby") return "Em standby. Será chamada novamente após o próximo atendimento.";
  if (data.status === "chamado") return `Apresente-se no ${data.counterLabel}.`;
  if (data.status === "proximo") return "Você será chamado em instantes.";
  if (hasLiveCountdown(data)) return `Sua senha será chamada em ${formatTimer(data.secondsToCall)}.`;
  if (data.position === 1) return "Você é o próximo da fila.";
  return `${data.ahead} pessoas à frente`;
}

function queueItemLine(data) {
  if (data.status === SMART_WAIT_STATUS) return "Protegida até o pedido atual terminar";
  if (data.status === "standby") return "Standby - retorno após próximo atendimento";
  if (data.status === "em_atendimento") return "Atendimento em andamento";
  if (data.status === "chamado") return `${data.counterLabel} - senha chamada`;
  if (data.status === "proximo") return "Próxima chamada";
  if (hasLiveCountdown(data)) return `Chamada em ${formatTimer(data.secondsToCall)}`;
  if (data.position === 1) return "Próxima da fila";
  return `${data.ahead} pessoas à frente`;
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
        <button class="mini-ticket ${sectorId === currentSector ? "active" : ""}" data-view-ticket="${sectorId}">
          <div>
            <strong>${data.sector}</strong>
            <span>${queueItemLine(data)}</span>
          </div>
          <b>${data.ticket}</b>
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
    card.querySelector(".sector-meta").innerHTML = `<span>Fila base: ${sector.queueSize} pessoas</span><span>${sector.status === "open" ? `${sector.averageServiceSeconds}s por atendimento` : "Setor indisponível"}</span>`;
    button.disabled = sector.status !== "open" || Boolean(activeJoinSector);
    button.textContent = hasTicket ? `Ver senha ${activeQueues[sectorId].ticket}` : `Solicitar senha - ${sector.name}`;
    if (activeJoinSector === sectorId) button.textContent = "Gerando senha...";
  });

  document.querySelectorAll("[data-quick-join]").forEach((button) => {
    const sectorId = button.dataset.quickJoin;
    const sector = sectors[sectorId];
    if (!sector) return;
    const hasTicket = Boolean(activeQueues[sectorId]);
    button.disabled = sector.status !== "open" || Boolean(activeJoinSector);
    button.classList.toggle("has-ticket", hasTicket);
    button.textContent = activeJoinSector === sectorId ? "..." : hasTicket ? activeQueues[sectorId].ticket : sector.name;
  });
}

function renderOfferQueueContext() {
  const box = document.querySelector("#offersQueue");
  const data = getCurrentQueueData();
  box.classList.toggle("visible", Boolean(data));
  box.innerHTML = data
    ? `<span>${data.sector}: ${data.ticket}</span><b>${statusText(data)}</b>`
    : "";
}

function renderCart() {
  const list = document.querySelector("#cartList");
  if (!list) return;
  list.innerHTML = cartItems.length
    ? cartItems.map((item) => `<div class="cart-item"><span>${item.quantity}x ${item.productName}</span><b>${item.price}</b></div>`).join("")
    : `<div class="empty-state">Nenhum produto adicionado.</div>`;
}

async function getPresencePayload(sectorId) {
  const qrToken = new URLSearchParams(location.search).get("qr");
  const storedToken = presenceCheckins[sectorId];
  if (qrToken) {
    registerSectorPresence(sectorId, qrToken);
    return { qrToken };
  }
  if (storedToken) return { qrToken: storedToken };

  const location = await requestLocation();
  return location ? { location } : {};
}

function confirmSectorPresence(sectorId) {
  registerSectorPresence(sectorId);
  navigate("sectors");
}

function registerSectorPresence(sectorId, token = null) {
  if (!QR_SECTORS.has(sectorId) || !token) return;
  presenceCheckins = { ...presenceCheckins, [sectorId]: token };
  localStorage.setItem("filaZeroPresenceCheckins", JSON.stringify(presenceCheckins));
  syncPresenceStatus();
}

function syncPresenceStatus() {
  const status = document.querySelector("#presenceStatus");
  if (!status) return;
  const confirmed = Object.keys(presenceCheckins)
    .filter((sectorId) => QR_SECTORS.has(sectorId) && presenceCheckins[sectorId])
    .map((sectorId) => sectors[sectorId]?.name || sectorNameFallback(sectorId));

  status.textContent = confirmed.length
    ? `Confirmado: ${confirmed.join(", ")}`
    : "Nenhum setor confirmado.";

  document.querySelectorAll("[data-qr-checkin]").forEach((button) => {
    const sectorId = button.dataset.qrCheckin;
    button.classList.toggle("checked", Boolean(presenceCheckins[sectorId]));
  });
}

function sectorNameFallback(sectorId) {
  return { acougue: "Açougue", frios: "Frios", padaria: "Padaria" }[sectorId] || sectorId;
}

function requestLocation() {
  if (!("geolocation" in navigator)) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy
      }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 30000 }
    );
  });
}

function renderProducts() {
  if (productsRendered) return;
  productsRendered = true;
  const activeSector = getCurrentQueueData()?.sector;
  const groups = productGroups;
  document.querySelector("#productList").innerHTML = groups
    .map((group) => `
        <section class="offer-section">
          <div>
            <h3>${group.sector}</h3>
            <span class="offer-section-count">${group.items.length} ofertas selecionadas</span>
          </div>
          ${group.items.map((item) => productCard(group.sector, item)).join("")}
        </section>
      `)
    .join("");

  document.querySelectorAll("[data-product]").forEach((button) => button.addEventListener("click", () => openProduct(button.dataset.product)));
}

function syncActionButtons() {
  renderSectorCards();
}

function productCard(sector, item) {
  const added = shoppingList.has(item.id);
  return `
    <button class="product-card ${added ? "added" : ""}" data-product="${item.id}">
      <span class="sale">${item.sale}</span>
      <img class="product-img" src="${item.image}" alt="${item.name}" loading="lazy" />
      <div>
        <strong>${item.name}</strong>
        <small>${sector}</small>
        <del>${item.old}</del>
        <b>${item.price}</b>
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
    await api("/api/cart/items", {
      method: "POST",
      body: {
        customerId: identity.customerId,
        productId,
        productName: item.name,
        sectorName: item.sector,
        price: item.price
      }
    });
    await loadCart();
    shoppingList.add(productId);
    document.querySelector("#addProduct").textContent = "Produto na lista";
    document.querySelector("#toast").classList.add("visible");
    updateProductCard(productId);
  } catch (exception) {
    alert(exception.message);
  }
}

function updateProductCard(productId) {
  const card = document.querySelector(`[data-product="${CSS.escape(productId)}"]`);
  if (!card) return;
  card.classList.add("added");
  const indicator = card.querySelector(".add-indicator");
  if (indicator) indicator.textContent = "✓";
}

function notifyTicketCalled(ticket) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(`Senha ${ticket.ticket} chamada`, {
      body: `${ticket.sector} - ${ticket.counterLabel}`,
      tag: ticket.id
    });
  }
}

async function handleNotifyButton() {
  if ("Notification" in window && Notification.permission === "default") {
    await Notification.requestPermission();
  }
  const called = Object.values(activeQueues).find((ticket) => ticket.status === "chamado");
  if (called) {
    currentSector = called.sectorId;
    syncQueue();
    document.querySelector("#callModal").classList.add("visible");
  }
}

async function sendRating() {
  const selected = document.querySelector("[data-rating].selected");
  await api("/api/ratings", {
    method: "POST",
    body: {
      customerId: identity.customerId,
      ticketId: getCurrentQueueData()?.id || null,
      score: selected?.dataset.rating || "sem_nota",
      comment: document.querySelector("textarea").value
    }
  });
  document.querySelector("#ratingToast").classList.add("visible");
}

function bindEvents() {
  document.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.go)));
  document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.tab)));
  document.querySelectorAll("[data-join]").forEach((button) => button.addEventListener("click", () => joinQueue(button.dataset.join)));
  document.querySelectorAll("[data-quick-join]").forEach((button) => button.addEventListener("click", () => joinQueue(button.dataset.quickJoin)));
  document.querySelectorAll("[data-qr-checkin]").forEach((button) => button.addEventListener("click", () => confirmSectorPresence(button.dataset.qrCheckin)));
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
  document.querySelectorAll("[data-rating]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-rating]").forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
    });
  });
  document.querySelector("#sendRating").addEventListener("click", sendRating);
}

function formatTimer(totalSeconds) {
  const safeSeconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const minutes = String(Math.floor(safeSeconds / 60)).padStart(2, "0");
  const seconds = String(safeSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
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
  if (response.status === 401) {
    location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
    throw new Error("Login necessÃ¡rio.");
  }
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

window.ticketOrchestration = {
  callNextEligibleTicket: (sectorId) => api(`/api/sectors/${sectorId}/call-next`, { method: "POST" }),
  finishService: (ticketId) => api(`/api/tickets/${ticketId}/finish`, { method: "POST" }),
  getState: loadState
};
