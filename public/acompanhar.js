(function initializeTracking() {
  const token = decodeURIComponent(location.pathname.split("/").filter(Boolean).pop() || "");
  const loading = document.querySelector("#trackingLoading");
  const content = document.querySelector("#trackingContent");
  const error = document.querySelector("#trackingError");
  const singleView = document.querySelector("#trackingSingleView");
  const ticketsList = document.querySelector("#trackingTicketsList");
  let timer = null;
  let countdownTimer = null;
  let currentTickets = [];

  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) {
    showError();
    return;
  }

  loadTicket();

  async function loadTicket() {
    clearTimeout(timer);
    try {
      const response = await fetch(`/api/tickets/track/${encodeURIComponent(token)}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      const tickets = Array.isArray(payload.tickets) && payload.tickets.length
        ? payload.tickets
        : (payload.ticket ? [payload.ticket] : []);
      if (!response.ok || payload.error || !tickets.length) throw new Error(payload.error || "Senha não encontrada.");
      render(tickets);
      if (tickets.some((ticket) => !isFinished(ticket))) timer = setTimeout(loadTicket, 5000);
    } catch {
      showError();
    }
  }

  function render(tickets) {
    currentTickets = tickets.filter(Boolean);
    loading.hidden = true;
    error.hidden = true;
    content.hidden = false;
    if (currentTickets.length > 1) {
      singleView.hidden = true;
      ticketsList.hidden = false;
      ticketsList.innerHTML = currentTickets.map(renderBundleTicket).join("");
      updateRemainingTime();
      return;
    }
    singleView.hidden = false;
    ticketsList.hidden = true;
    ticketsList.innerHTML = "";
    renderSingle(currentTickets[0]);
  }

  function renderSingle(ticket) {
    document.querySelector("#trackingCurrent").textContent = ticket.current || "--";
    document.querySelector("#trackingTicket").textContent = ticket.ticket || "--";
    document.querySelector("#trackingSector").textContent = ticket.sector || "Setor";
    document.querySelector("#trackingPriority").hidden = !ticket.priority;
    document.querySelector("#trackingStatus").textContent = statusLabel(ticket.status);
    document.querySelector("#trackingStatusDot").dataset.state = statusTone(ticket.status);
    document.querySelector("#trackingAhead").textContent = String(ticket.ahead ?? 0);
    document.querySelector("#trackingPosition").textContent = `${ticket.position || 1}ª`;
    document.querySelector("#trackingMessage").textContent = trackingMessage(ticket);
    document.querySelector("#trackingUpdated").textContent = updatedLabel();
    updateRemainingTime();
  }

  function renderBundleTicket(ticket, index) {
    const priority = ticket.priority
      ? '<span class="tracking-badge">Atendimento preferencial</span>'
      : "";
    return `
      <article class="tracking-bundle-ticket">
        <div class="tracking-bundle-ticket-head">
          <div><span>Setor</span><h2>${escapeHtml(ticket.sector || "Setor")}</h2></div>
          <strong>${escapeHtml(ticket.ticket || "--")}</strong>
        </div>
        ${priority}
        <div class="tracking-status"><span class="tracking-status-dot" data-state="${statusTone(ticket.status)}"></span><strong>${statusLabel(ticket.status)}</strong><small>${updatedLabel()}</small></div>
        <div class="tracking-metrics"><div><span>Pessoas à frente</span><strong>${escapeHtml(ticket.ahead ?? 0)}</strong></div><div><span>Posição estimada</span><strong>${escapeHtml(ticket.position || 1)}ª</strong></div></div>
        <div class="tracking-time-card">
          <span>Tempo estimado para atendimento</span>
          <strong data-tracking-time data-ticket-index="${index}">${remainingTime(ticket)}</strong>
          <small>Atualizado automaticamente</small>
        </div>
        <p class="tracking-message">${trackingMessage(ticket)}</p>
      </article>`;
  }

  function updateRemainingTime() {
    if (currentTickets.length > 1) {
      document.querySelectorAll("[data-tracking-time]").forEach((element) => {
        const ticket = currentTickets[Number(element.dataset.ticketIndex)];
        if (ticket) element.textContent = remainingTime(ticket);
      });
      return;
    }
    const timeElement = document.querySelector("#trackingTime");
    if (timeElement && currentTickets[0]) timeElement.textContent = remainingTime(currentTickets[0]);
  }

  function remainingTime(ticket) {
    if (isFinished(ticket)) return "--:--";
    if (["chamado", "em_atendimento"].includes(ticket.status)) return "00:00";
    const target = new Date(ticket.estimatedCallAt || 0).getTime();
    const fallback = Number(ticket.secondsToCall) || 0;
    const remaining = Number.isFinite(target) && target > 0
      ? Math.max(0, Math.ceil((target - Date.now()) / 1000))
      : fallback;
    return formatTime(remaining);
  }

  function formatTime(totalSeconds) {
    const seconds = Math.max(0, Number(totalSeconds) || 0);
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }

  function trackingMessage(ticket) {
    if (ticket.status === "chamado") return "Sua senha foi chamada. Dirija-se ao balcão.";
    if (ticket.status === "em_atendimento") return "Seu atendimento está acontecendo agora.";
    if (ticket.status === "atendido") return "Atendimento concluído. Obrigado por usar o SenhaHub.";
    if (ticket.status === "cancelado" || ticket.status === "expirado") return "Esta senha não está mais ativa.";
    if (Number(ticket.ahead) === 0) return "Você é o próximo. Fique atento ao chamado.";
    return "Você será avisado quando estiver próximo do atendimento.";
  }

  function statusLabel(status) {
    return { aguardando: "Aguardando", proximo: "Você é o próximo", chamado: "Senha chamada", em_atendimento: "Em atendimento", atendido: "Atendimento concluído", cancelado: "Senha cancelada", expirado: "Senha expirada", standby: "Aguardando retorno" }[status] || "Aguardando";
  }

  function statusTone(status) {
    if (["chamado", "em_atendimento"].includes(status)) return "attention";
    if (["atendido", "cancelado", "expirado"].includes(status)) return "done";
    return "waiting";
  }

  function isFinished(ticket) {
    return ["atendido", "cancelado", "expirado"].includes(ticket?.status);
  }

  function updatedLabel() {
    return `Atualizado às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function showError() {
    clearTimeout(timer);
    clearInterval(countdownTimer);
    loading.hidden = true;
    content.hidden = true;
    error.hidden = false;
  }

  countdownTimer = setInterval(updateRemainingTime, 1000);
})();
