(function initializeButcherDisplay() {
  const POLL_INTERVAL_MS = 2000;
  const WAITING_STATUSES = new Set(["aguardando", "proximo", "espera_inteligente", "standby"]);
  const PROMOTIONS = [
    { name: "Picanha bovina", detail: "Peça selecionada · kg", major: "59", minor: "90", unit: "kg", tone: "red", art: "picanha", image: "/assets/tv-picanha.webp" },
    { name: "Contrafilé bovino", detail: "Corte especial · kg", major: "49", minor: "90", unit: "kg", tone: "navy", art: "contrafile", image: "/assets/tv-contrafile.jpeg" },
    { name: "Linguiça toscana", detail: "Tradicional · 500 g", major: "18", minor: "90", unit: "un", tone: "gold", art: "linguica", image: "/assets/tv-linguica.png" },
    { name: "Fraldinha bovina", detail: "Peça resfriada · kg", major: "36", minor: "90", unit: "kg", tone: "navy", art: "fraldinha", image: "/assets/tv-fraldinha.webp" }
  ];
  const state = { lastCall: "", timer: null, requestInFlight: false };
  const elements = {
    clock: document.querySelector("#tvClock"),
    date: document.querySelector("#tvDate"),
    connection: document.querySelector("#tvConnection"),
    recentCalls: document.querySelector("#tvRecentCalls"),
    waitingCount: document.querySelector("#tvWaitingCount"),
    waitingTickets: document.querySelector("#tvWaitingTickets"),
    currentCall: document.querySelector("#tvCurrentCall"),
    currentStatus: document.querySelector("#tvCurrentStatus"),
    currentTicket: document.querySelector("#tvCurrentTicket"),
    currentCustomer: document.querySelector("#tvCurrentCustomer"),
    feedback: document.querySelector("#tvFeedback"),
    promotions: document.querySelector("#tvPromotions")
  };

  renderPromotions();
  updateClock();
  window.setInterval(updateClock, 1000);
  loadState();
  state.timer = window.setInterval(loadState, POLL_INTERVAL_MS);
  window.addEventListener("online", loadState);
  window.addEventListener("offline", () => setConnection("offline", "Sem conexão"));

  async function loadState() {
    if (state.requestInFlight) return;
    state.requestInFlight = true;
    setConnection("loading", "Atualizando");
    try {
      const payload = await api("/api/display/state");
      const sector = payload.sectors?.[0];
      if (!sector) throw new Error("A fila do açougue ainda não está disponível.");
      renderQueue(sector);
      setConnection("online", "Online");
      if (elements.feedback) elements.feedback.textContent = "";
    } catch (error) {
      setConnection("offline", "Falha na fila");
      if (elements.feedback) elements.feedback.textContent = error.message || "Não foi possível atualizar a fila.";
    } finally {
      state.requestInFlight = false;
    }
  }

  function renderQueue(sector) {
    const waiting = (sector.tickets || []).filter((ticket) => WAITING_STATUSES.has(ticket.status));
    const recentCalls = [...(sector.recentCalls || [])]
      .filter((call) => call.ticket || call.ticketNumber)
      .slice(0, 4);
    const currentTicket = sector.current || recentCalls[0]?.ticket || "--";
    const active = (sector.tickets || []).find((ticket) => ["chamado", "em_atendimento"].includes(ticket.status));
    const latestCall = recentCalls[0]?.ticket || "";
    const changed = Boolean(latestCall && latestCall !== state.lastCall);

    if (changed) {
      state.lastCall = latestCall;
      elements.currentCall?.classList.remove("tv-call-arrived");
    }
    elements.waitingCount.textContent = String(waiting.length).padStart(2, "0");
    elements.currentTicket.textContent = formatTicket(currentTicket, sector.prefix);
    elements.currentStatus.textContent = active ? (active.status === "em_atendimento" ? "Em atendimento" : "Dirija-se ao balcão") : "Aguardando próxima chamada";
    elements.currentCustomer.textContent = active?.currentCustomerName || sector.currentCustomerName || (active ? "Atenção, sua senha foi chamada" : "Confira o painel para acompanhar sua vez");
    elements.currentCall.dataset.state = active ? "active" : "idle";
    elements.recentCalls.innerHTML = recentCalls.length ? recentCalls.map((call, index) => callRow(call, sector, index === 0)).join("") : emptyRow("Nenhuma chamada recente");
    elements.waitingTickets.innerHTML = waiting.length ? waiting.slice(0, 5).map((ticket) => waitingRow(ticket, sector)).join("") : emptyRow("Nenhuma senha aguardando");
  }

  function callRow(call, sector, latest) {
    const ticket = formatTicket(call.ticket || call.ticketNumber, sector.prefix);
    const time = call.createdAt ? new Date(call.createdAt).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }) : "--:--";
    return `<div class="tv-call-row ${latest ? "is-latest" : ""}"><span class="tv-call-sector">AÇOUGUE</span><strong>${escapeHtml(ticket)}</strong><time>${time}</time></div>`;
  }

  function waitingRow(ticket, sector) {
    const position = Number(ticket.position) > 0 ? `${ticket.position}º` : "--";
    return `<div class="tv-waiting-row"><strong>${escapeHtml(formatTicket(ticket.ticket || ticket.ticketNumber, sector.prefix))}</strong><span>${escapeHtml(position)} na fila</span></div>`;
  }

  function renderPromotions() {
    elements.promotions.innerHTML = PROMOTIONS.map((product) => `
      <article class="tv-product-card tv-product-${product.tone}">
        <div class="tv-product-copy"><strong>${escapeHtml(product.name)}</strong><span>${escapeHtml(product.detail)}</span></div>
        <div class="tv-product-art tv-art-${product.art}"><img src="${product.image}" alt="${escapeHtml(product.name)}" loading="eager" /></div>
        <div class="tv-price"><small>R$</small><strong>${product.major}<sup>,${product.minor}</sup></strong><em>/${escapeHtml(product.unit)}</em></div>
      </article>
    `).join("");
  }

  function updateClock() {
    const now = new Date();
    if (elements.clock) elements.clock.textContent = now.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
    if (elements.date) elements.date.textContent = now.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "long", year: "numeric" });
  }

  function setConnection(status, label) {
    if (!elements.connection) return;
    elements.connection.dataset.state = status;
    const text = elements.connection.querySelector("b");
    if (text) text.textContent = label;
  }

  async function api(url) {
    const response = await fetch(url, { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) throw new Error(payload.error || "Falha ao consultar a fila.");
    return payload;
  }

  function formatTicket(value, prefix = "A") {
    const source = String(value || "--");
    if (source === "--") return source;
    if (/^[A-Z]+\d+$/i.test(source)) return source;
    return `${prefix || "A"}${source.replace(/\D/g, "").padStart(3, "0")}`;
  }

  function emptyRow(message) {
    return `<div class="tv-empty-row">${escapeHtml(message)}</div>`;
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
  }
})();
