(function initializeTracking() {
  const token = decodeURIComponent(location.pathname.split("/").filter(Boolean).pop() || "");
  const loading = document.querySelector("#trackingLoading");
  const content = document.querySelector("#trackingContent");
  const error = document.querySelector("#trackingError");
  let timer = null;

  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) {
    showError();
    return;
  }

  loadTicket();

  async function loadTicket() {
    try {
      const response = await fetch(`/api/tickets/track/${encodeURIComponent(token)}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.error || !payload.ticket) throw new Error(payload.error || "Senha não encontrada.");
      render(payload.ticket);
      if (!["atendido", "cancelado", "expirado"].includes(payload.ticket.status)) timer = setTimeout(loadTicket, 5000);
    } catch {
      showError();
    }
  }

  function render(ticket) {
    loading.hidden = true;
    error.hidden = true;
    content.hidden = false;
    document.querySelector("#trackingTicket").textContent = ticket.ticket || "--";
    document.querySelector("#trackingSector").textContent = ticket.sector || "Setor";
    document.querySelector("#trackingPriority").hidden = !ticket.priority;
    document.querySelector("#trackingStatus").textContent = statusLabel(ticket.status);
    document.querySelector("#trackingStatusDot").dataset.state = statusTone(ticket.status);
    document.querySelector("#trackingAhead").textContent = String(ticket.ahead ?? 0);
    document.querySelector("#trackingPosition").textContent = `${ticket.position || 1}ª`;
    document.querySelector("#trackingProgressBar").style.width = `${Math.max(8, Math.min(100, Number(ticket.progress) || 8))}%`;
    document.querySelector("#trackingMessage").textContent = trackingMessage(ticket);
    document.querySelector("#trackingUpdated").textContent = `Atualizado às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
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

  function showError() {
    clearTimeout(timer);
    loading.hidden = true;
    content.hidden = true;
    error.hidden = false;
  }
})();
