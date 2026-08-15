(function initializeTotem() {
  const GENERAL_QR_URL = "https://senhahub-mauve.vercel.app/login?next=%2F";
  const PRIORITY_CATEGORIES = [
    { id: "deficiencia_ou_mobilidade_reduzida", label: "Pessoa com deficiência ou mobilidade reduzida", icon: "♿" },
    { id: "tea", label: "Pessoa com transtorno do espectro autista", icon: "♢" },
    { id: "idoso_60_mais", label: "Pessoa idosa (60 anos ou mais)", icon: "♙" },
    { id: "gestante_ou_lactante", label: "Gestante ou lactante", icon: "♡" },
    { id: "crianca_de_colo", label: "Pessoa com criança de colo", icon: "♧" },
    { id: "obesidade", label: "Pessoa com obesidade", icon: "＋" }
  ];
  const state = {
    status: null,
    mode: "central",
    selectedSector: null,
    serviceType: null,
    priorityReason: null,
    currentStep: "sector",
    idempotencyKey: null,
    pollingTimer: null,
    queueRefreshTimer: null
  };
  const elements = {
    loading: document.querySelector("#totemLoading"),
    pair: document.querySelector("#totemPair"),
    operation: document.querySelector("#totemOperation"),
    result: document.querySelector("#totemResult"),
    sectors: document.querySelector("#totemSectors"),
    feedback: document.querySelector("#totemFeedback"),
    connection: document.querySelector("#totemConnection"),
    pairButton: document.querySelector("#pairKioskButton"),
    pairLogin: document.querySelector("#pairLoginLink"),
    flowTitle: document.querySelector("#totemFlowTitle"),
    flowDescription: document.querySelector("#totemFlowDescription"),
    generalQrCard: document.querySelector("#totemGeneralQrCard"),
    generalQr: document.querySelector("#totemGeneralQr"),
    typeStep: document.querySelector("#totemStepType"),
    priorityStep: document.querySelector("#totemStepPriority"),
    priorityOptions: document.querySelector("#totemPriorityOptions"),
    normalIssue: document.querySelector("#totemNormalIssue"),
    normalIssueSector: document.querySelector("#normalIssueSector"),
    priorityIssue: document.querySelector("#totemPriorityIssue"),
    priorityIssueSector: document.querySelector("#priorityIssueSector"),
    priorityIssueReason: document.querySelector("#priorityIssueReason"),
    normalIssueButton: document.querySelector("#issueNormalTicketButton"),
    priorityIssueButton: document.querySelector("#issuePriorityTicketButton"),
    backNormalTicketButton: document.querySelector("#backNormalTicketButton"),
    backPriorityTicketButton: document.querySelector("#backPriorityTicketButton"),
    backToSector: document.querySelector("#backToSectorButton"),
    backToType: document.querySelector("#backToTypeButton"),
    newTicketButton: document.querySelector("#newTicketButton"),
    resultSector: document.querySelector("#resultSector"),
    resultTicket: document.querySelector("#resultTicket"),
    resultPriorityBadge: document.querySelector("#resultPriorityBadge"),
    resultTrackQr: document.querySelector("#resultTrackQr"),
    resultTrackUrl: document.querySelector("#resultTrackUrl"),
    printState: document.querySelector("#printState")
  };

  elements.pairButton?.addEventListener("click", pairKiosk);
  elements.backToSector?.addEventListener("click", () => setStep("sector"));
  elements.backToType?.addEventListener("click", () => setStep("type"));
  elements.normalIssueButton?.addEventListener("click", issueTicket);
  elements.priorityIssueButton?.addEventListener("click", issueTicket);
  elements.backNormalTicketButton?.addEventListener("click", () => {
    state.serviceType = null;
    state.priorityReason = null;
    state.idempotencyKey = null;
    document.querySelectorAll("[data-service-type]").forEach((button) => button.classList.remove("selected"));
    setStep("type");
  });
  elements.backPriorityTicketButton?.addEventListener("click", () => {
    state.priorityReason = null;
    state.idempotencyKey = null;
    elements.priorityOptions.querySelectorAll(".selected").forEach((item) => item.classList.remove("selected"));
    setStep("priority");
  });
  elements.newTicketButton?.addEventListener("click", resetOperation);
  document.querySelectorAll("[data-service-type]").forEach((button) => {
    button.addEventListener("click", () => selectServiceType(button.dataset.serviceType));
  });
  window.addEventListener("online", loadStatus);
  window.addEventListener("offline", () => setConnection("offline", "Sem internet"));
  renderPriorityOptions();
  loadStatus();

  async function loadStatus() {
    setConnection("loading", "Conectando");
    try {
      state.status = await api("/api/kiosk/status");
      renderStatus();
      setConnection("online", "Totem online");
    } catch (error) {
      showOnly(elements.pair);
      if (elements.feedback) elements.feedback.textContent = error.message;
      setConnection("offline", "Falha de conexão");
    }
  }

  function renderStatus() {
    if (!state.status.paired) {
      showOnly(elements.pair);
      elements.pairButton.hidden = !state.status.canPair;
      elements.pairLogin.hidden = state.status.canPair;
      document.querySelector("#totemPairMessage").textContent = state.status.canPair
        ? "Autorize este equipamento para liberar a emissão de senhas."
        : "Entre como gestor para autorizar a emissão de senhas neste equipamento.";
      return;
    }

    state.mode = state.status.kiosk?.mode === "sector" ? "sector" : "central";
    const sectors = state.status.sectors || [];
    state.selectedSector = state.mode === "sector"
      ? sectors.find((sector) => sector.id === state.status.kiosk?.sectorId) || null
      : null;
    if (state.mode === "sector" && !state.selectedSector) {
      showOnly(elements.operation);
      elements.flowTitle.textContent = "Totem sem setor configurado";
      elements.flowDescription.textContent = "Solicite ao gestor a configuração do setor deste equipamento.";
      elements.typeStep.hidden = true;
      elements.priorityStep.hidden = true;
      elements.feedback.textContent = "Nenhum setor configurado para este totem.";
      return;
    }

    showOnly(elements.operation);
    renderSectors(sectors);
    renderGeneralQr(state.status.kiosk?.appUrl);
    startQueueRefresh();
    elements.backToSector.hidden = state.mode === "sector";
    state.serviceType = null;
    state.priorityReason = null;
    state.idempotencyKey = null;
    setStep(state.mode === "sector" ? "type" : "sector");
  }

  function renderSectors(sectors) {
    elements.sectors.innerHTML = "";
    sectors.forEach((sector) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "totem-sector";
      button.dataset.sectorId = sector.id;
      const waiting = waitingCount(sector);
      const waitingLabel = waiting === 1 ? "pessoa aguardando" : "pessoas aguardando";
      button.innerHTML = [
        `<span class="totem-sector-letter" aria-label="Prefixo ${escapeHtml(sector.prefix)}">${escapeHtml(sector.prefix)}</span>`,
        "<span class=\"totem-sector-copy\">",
        `<strong>${escapeHtml(sector.name)}</strong>`,
        `<small class="totem-sector-waiting"><span class="totem-sector-waiting-number">${waiting}</span><span class="totem-sector-waiting-label">${waitingLabel}</span></small>`,
        "</span>",
        "<span class=\"totem-sector-arrow\" aria-hidden=\"true\">&#8594;</span>"
      ].join("");
      button.addEventListener("click", () => selectSector(sector));
      elements.sectors.append(button);
    });
    if (!sectors.length) elements.feedback.textContent = "Nenhum setor está aberto neste momento.";
  }

  function waitingCount(sector) {
    return Math.max(0, Math.trunc(Number(sector?.queueSize) || 0));
  }

  function updateSectorWaitingCounts(sectors) {
    const sectorsById = new Map((sectors || []).map((sector) => [sector.id, sector]));
    document.querySelectorAll(".totem-sector[data-sector-id]").forEach((button) => {
      const sector = sectorsById.get(button.dataset.sectorId);
      if (!sector) return;
      const waiting = waitingCount(sector);
      const number = button.querySelector(".totem-sector-waiting-number");
      const label = button.querySelector(".totem-sector-waiting-label");
      if (number) number.textContent = String(waiting);
      if (label) label.textContent = waiting === 1 ? "pessoa aguardando" : "pessoas aguardando";
    });
  }

  function startQueueRefresh() {
    clearInterval(state.queueRefreshTimer);
    state.queueRefreshTimer = null;
    if (state.mode !== "central") return;
    state.queueRefreshTimer = setInterval(refreshQueueCounts, 10000);
  }

  async function refreshQueueCounts() {
    if (state.currentStep !== "sector" || elements.operation.hidden) return;
    try {
      const status = await api("/api/kiosk/status");
      if (!status.paired) return;
      state.status = status;
      updateSectorWaitingCounts(status.sectors);
    } catch {
      // A contagem atual permanece na tela até a próxima atualização bem-sucedida.
    }
  }

  function selectSector(sector) {
    state.selectedSector = sector;
    state.serviceType = null;
    state.priorityReason = null;
    state.idempotencyKey = null;
    setStep("type");
  }

  function selectServiceType(type) {
    state.serviceType = type === "preferencial" ? "preferencial" : "normal";
    state.priorityReason = null;
    state.idempotencyKey = null;
    document.querySelectorAll("[data-service-type]").forEach((button) => {
      button.classList.toggle("selected", button.dataset.serviceType === state.serviceType);
    });
    setStep(state.serviceType === "preferencial" ? "priority" : "type");
  }

  function renderPriorityOptions() {
    elements.priorityOptions.innerHTML = PRIORITY_CATEGORIES.map((category) => `
      <button class="totem-priority-option" type="button" data-priority-category="${category.id}">
        <span aria-hidden="true">${category.icon}</span><strong>${escapeHtml(category.label)}</strong>
      </button>
    `).join("");
    elements.priorityOptions.querySelectorAll("[data-priority-category]").forEach((button) => {
      button.addEventListener("click", () => {
        state.priorityReason = button.dataset.priorityCategory;
        elements.priorityOptions.querySelectorAll(".selected").forEach((item) => item.classList.remove("selected"));
        button.classList.add("selected");
        renderInlineIssue();
      });
    });
  }

  function setStep(step) {
    state.currentStep = step;
    const steps = {
      sector: document.querySelector("#totemStepSector"),
      type: elements.typeStep,
      priority: elements.priorityStep
    };
    Object.entries(steps).forEach(([name, element]) => {
      if (element) element.hidden = name !== step || (name === "sector" && state.mode === "sector");
    });
    document.querySelectorAll("[data-progress-step]").forEach((item) => item.classList.toggle("active", item.dataset.progressStep === step));
    const selectedName = state.selectedSector?.name || "setor";
    const copy = {
      sector: ["Escolha o setor", "Selecione onde você deseja ser atendido."],
      type: [state.mode === "sector" ? `Atendimento no ${selectedName}` : "Escolha o atendimento", "Escolha entre atendimento normal ou preferencial."],
      priority: ["Categoria preferencial", "Selecione a categoria que corresponde à sua necessidade."]
    }[step];
    elements.flowTitle.textContent = copy[0];
    elements.flowDescription.textContent = copy[1];
    renderInlineIssue();
  }

  function renderInlineIssue() {
    const category = PRIORITY_CATEGORIES.find((item) => item.id === state.priorityReason);
    const normalReady = state.currentStep === "type" && state.serviceType === "normal";
    const priorityReady = state.currentStep === "priority" && state.serviceType === "preferencial" && Boolean(state.priorityReason);
    elements.normalIssue.hidden = !normalReady;
    elements.priorityIssue.hidden = !priorityReady;
    elements.backToSector.hidden = state.mode === "sector" || normalReady;
    elements.backToType.hidden = priorityReady;
    elements.normalIssueSector.textContent = state.selectedSector?.name || "--";
    elements.priorityIssueSector.textContent = state.selectedSector?.name || "--";
    elements.priorityIssueReason.textContent = category?.label || "Selecione uma categoria para continuar.";
    elements.priorityIssueButton.disabled = !priorityReady;
  }

  async function pairKiosk() {
    elements.pairButton.disabled = true;
    try {
      state.status = await api("/api/kiosk/pair", {
        method: "POST",
        body: { kioskId: "totem-pompeia-01" },
        csrf: "senhahub_csrf"
      });
      renderStatus();
    } catch (error) {
      document.querySelector("#totemPairMessage").textContent = error.message;
    } finally {
      elements.pairButton.disabled = false;
    }
  }

  async function issueTicket() {
    if (!state.selectedSector || !state.serviceType || (state.serviceType === "preferencial" && !state.priorityReason)) return;
    const issueButtons = [elements.normalIssueButton, elements.priorityIssueButton].filter(Boolean);
    issueButtons.forEach((button) => {
      button.disabled = true;
      button.textContent = "Imprimindo...";
    });
    state.idempotencyKey ||= createIdempotencyKey();
    try {
      const result = await api("/api/kiosk/tickets", {
        method: "POST",
        body: {
          sectorId: state.selectedSector.id,
          idempotencyKey: state.idempotencyKey,
          priority: state.serviceType === "preferencial",
          priorityReason: state.priorityReason
        },
        csrf: "senhahub_kiosk_csrf",
        csrfHeader: "x-kiosk-csrf"
      });
      showResult(result);
      if (result.printJob?.id) pollPrintJob(result.printJob.id);
    } catch (error) {
      elements.feedback.textContent = error.message;
    } finally {
      issueButtons.forEach((button) => {
        button.disabled = false;
        button.textContent = "Imprimir senha";
      });
    }
  }

  function showResult(result) {
    showOnly(elements.result);
    elements.resultSector.textContent = result.ticket.sector;
    elements.resultTicket.textContent = result.ticket.ticket;
    elements.resultPriorityBadge.hidden = !result.ticket.priority;
    const trackUrl = result.printJob?.payload?.trackUrl || "";
    renderTrackingQr(trackUrl);
    elements.resultTrackUrl.textContent = trackUrl ? "Escaneie o QR Code para acompanhar sua fila." : "QR Code indisponível neste momento.";
    setPrintState(result.printJob?.status || "pending");
  }

  async function pollPrintJob(jobId) {
    clearTimeout(state.pollingTimer);
    try {
      const result = await api(`/api/kiosk/print-jobs/${encodeURIComponent(jobId)}`);
      setPrintState(result.job.status, result.job.lastError);
      if (["pending", "printing"].includes(result.job.status)) state.pollingTimer = setTimeout(() => pollPrintJob(jobId), 1200);
    } catch {
      setPrintState("failed", "Não foi possível consultar a impressão.");
    }
  }

  function setPrintState(status, error) {
    const labels = {
      pending: "Aguardando a impressora",
      printing: "Imprimindo sua senha",
      printed: "Senha impressa. Retire o papel.",
      failed: error || "Falha na impressão. Solicite ajuda."
    };
    elements.printState.dataset.state = status;
    elements.printState.querySelector("p").textContent = labels[status] || labels.pending;
  }

  function resetOperation() {
    clearTimeout(state.pollingTimer);
    state.selectedSector = null;
    state.serviceType = null;
    state.priorityReason = null;
    state.idempotencyKey = null;
    elements.feedback.textContent = "";
    renderStatus();
  }

  function showOnly(target) {
    [elements.loading, elements.pair, elements.operation, elements.result].forEach((section) => {
      if (section) section.hidden = section !== target;
    });
  }

  function setConnection(status, label) {
    elements.connection.dataset.state = status;
    elements.connection.querySelector("strong").textContent = label;
  }

  function renderGeneralQr() {
    if (state.mode === "sector") {
      elements.generalQrCard.hidden = true;
      return;
    }
    elements.generalQrCard.hidden = false;
    if (elements.generalQr.childElementCount) return;
    renderQr(elements.generalQr, GENERAL_QR_URL, "QR indisponível");
  }

  function renderTrackingQr(trackUrl) {
    elements.resultTrackQr.innerHTML = "";
    if (!trackUrl) {
      elements.resultTrackQr.textContent = "QR indisponível";
      return;
    }
    renderQr(elements.resultTrackQr, trackUrl, "QR indisponível");
  }

  function renderQr(target, value, fallback) {
    if (!target || !value || !value.startsWith("https://") || typeof window.qrcode !== "function") {
      target.textContent = fallback;
      return;
    }
    const code = window.qrcode(0, "M");
    code.addData(value, "Byte");
    code.make();
    target.innerHTML = code.createSvgTag({ cellSize: 5, margin: 4, scalable: true });
  }

  async function api(path, options = {}) {
    const headers = { "content-type": "application/json" };
    if (options.csrf) {
      const token = getCookie(options.csrf);
      if (token) headers[options.csrfHeader || "x-csrf-token"] = token;
    }
    const response = await fetch(path, {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: "same-origin",
      cache: "no-store"
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) throw new Error(payload.error || "Falha na comunicação.");
    return payload;
  }

  function getCookie(name) {
    const item = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
    return item ? decodeURIComponent(item.slice(name.length + 1)) : "";
  }

  function createIdempotencyKey() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function escapeHtml(value) {
    const element = document.createElement("span");
    element.textContent = String(value || "");
    return element.innerHTML;
  }
})();
