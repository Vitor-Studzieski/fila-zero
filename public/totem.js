(function initializeTotem() {
  const GENERAL_QR_URL = "https://senhahub.vercel.app/login?next=%2F";
  const RESULT_DISPLAY_MS = 4000;
  // Novos tipos de atendimento podem ser adicionados aqui sem alterar a estrutura da tela.
  const SERVICE_TYPES = [
    {
      id: "normal",
      label: "Atendimento normal",
      description: "Entre na fila comum do setor.",
      marker: "N",
      className: "totem-choice-normal"
    },
    {
      id: "preferencial",
      label: "Atendimento preferencial",
      description: "Para quem tem direito ao atendimento prioritário.",
      marker: "P",
      className: "totem-choice-priority"
    }
  ];
  const PRIORITY_CATEGORIES = [
    { id: "idoso_60_mais", label: "Idosos acima de 60+ anos", image: "/assets/tablet-priority/idoso.jpg" },
    { id: "crianca_de_colo", label: "Pessoas com criança de colo", image: "/assets/tablet-priority/crianca-de-colo.webp" },
    { id: "gestante", label: "Gestantes", image: "/assets/tablet-priority/gestante.webp" },
    { id: "deficiencia", label: "Pessoas com deficiência", image: "/assets/tablet-priority/acessibilidade.webp" },
    { id: "deficiencia_oculta", label: "Deficiência ocultas", image: "/assets/tablet-priority/deficiencia-oculta.jpg" },
    { id: "autismo", label: "Portadores de autismo", image: "/assets/tablet-priority/autismo.png" },
    { id: "mobilidade_reduzida", label: "Pessoas com mobilidade reduzida", image: "/assets/tablet-priority/mobilidade-reduzida.jpg" },
    { id: "comorbidades", label: "Pessoas com comorbidades", image: "/assets/tablet-priority/comorbidade.jpeg" },
    { id: "doador_de_sangue", label: "Doadores de sangue", image: "/assets/tablet-priority/doador-de-sangue.png" },
    { id: "fibromialgia", label: "Fibromialgia", image: "/assets/tablet-priority/fibromialgia.png" }
  ];
  const state = {
    status: null,
    mode: "central",
    selectedSector: null,
    selectedSectors: [],
    serviceType: null,
    priorityReason: null,
    currentStep: "type",
    pollingTimer: null,
    queueRefreshTimer: null,
    resultTimer: null,
    printJobs: [],
    printJobStatuses: new Map(),
    printFailures: [],
    issuedTicketCount: 0,
    issueInFlight: false
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
    serviceOptions: document.querySelector("#totemServiceOptions"),
    typeStep: document.querySelector("#totemStepType"),
    sectorStep: document.querySelector("#totemStepSector"),
    priorityStep: document.querySelector("#totemStepPriority"),
    priorityOptions: document.querySelector("#totemPriorityOptions"),
    sectorSelectionSummary: document.querySelector("#totemSectorSelectionSummary"),
    backToTypeFromSectorsButton: document.querySelector("#backToTypeFromSectorsButton"),
    issueTicketsButton: document.querySelector("#issueTicketsButton"),
    backToType: document.querySelector("#backToTypeButton"),
    newTicketButton: document.querySelector("#newTicketButton"),
    resultSector: document.querySelector("#resultSector"),
    resultTicket: document.querySelector("#resultTicket"),
    resultTickets: document.querySelector("#resultTickets"),
    resultPriorityBadge: document.querySelector("#resultPriorityBadge"),
    printState: document.querySelector("#printState")
  };

  elements.pairButton?.addEventListener("click", pairKiosk);
  elements.backToType?.addEventListener("click", () => {
    state.priorityReason = null;
    state.selectedSectors = [];
    elements.priorityOptions?.querySelectorAll(".selected").forEach((item) => item.classList.remove("selected"));
    setStep("type");
  });
  elements.backToTypeFromSectorsButton?.addEventListener("click", () => {
    state.selectedSectors = [];
    state.priorityReason = null;
    elements.priorityOptions?.querySelectorAll(".selected").forEach((item) => item.classList.remove("selected"));
    setStep("type");
  });
  elements.issueTicketsButton?.addEventListener("click", issueTickets);
  elements.newTicketButton?.addEventListener("click", resetOperation);
  window.addEventListener("online", loadStatus);
  window.addEventListener("offline", () => setConnection("offline", "Sem internet"));
  renderServiceOptions();
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
    clearInterval(state.queueRefreshTimer);
    state.queueRefreshTimer = null;
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
      hideTotemSteps();
      elements.flowTitle.textContent = "Totem sem setor configurado";
      elements.flowDescription.textContent = "Solicite ao gestor a configuração do setor deste equipamento.";
      elements.feedback.textContent = "Nenhum setor configurado para este totem.";
      return;
    }

    showOnly(elements.operation);
    renderSectors(sectors);
    renderGeneralQr(state.status.kiosk?.appUrl);
    startQueueRefresh();
    state.selectedSectors = [];
    state.serviceType = null;
    state.priorityReason = null;
    state.printFailures = [];
    state.printJobs = [];
    state.printJobStatuses = new Map();
    state.issueInFlight = false;
    document.querySelectorAll("#totemServiceOptions .selected, #totemPriorityOptions .selected").forEach((button) => button.classList.remove("selected"));
    setStep("type");
  }

  function renderSectors(sectors) {
    elements.sectors.innerHTML = "";
    sectors.forEach((sector) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "totem-sector";
      button.dataset.sectorId = sector.id;
      button.setAttribute("aria-pressed", "false");
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
      button.addEventListener("click", () => toggleSector(sector));
      elements.sectors.append(button);
    });
    renderSectorSelection();
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

  function toggleSector(sector) {
    if (state.mode === "sector") return;
    const selectedIndex = state.selectedSectors.findIndex((item) => item.id === sector.id);
    if (selectedIndex >= 0) state.selectedSectors.splice(selectedIndex, 1);
    else state.selectedSectors.push(sector);
    renderSectorSelection();
    elements.feedback.textContent = "";
  }

  function renderSectorSelection() {
    const selectedIds = new Set(state.selectedSectors.map((sector) => sector.id));
    document.querySelectorAll(".totem-sector[data-sector-id]").forEach((button) => {
      const selected = selectedIds.has(button.dataset.sectorId);
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    if (!elements.sectorSelectionSummary || !elements.issueTicketsButton) return;
    const count = state.selectedSectors.length;
    elements.sectorSelectionSummary.textContent = count
      ? `${count} ${count === 1 ? "setor selecionado" : "setores selecionados"}`
      : "Nenhum setor selecionado";
    elements.issueTicketsButton.disabled = state.issueInFlight || !count || !state.serviceType || (state.serviceType === "preferencial" && !state.priorityReason);
  }

  function selectServiceType(type) {
    const serviceType = SERVICE_TYPES.find((item) => item.id === type);
    if (!serviceType) return;
    state.serviceType = serviceType.id;
    state.priorityReason = null;
    state.selectedSectors = [];
    document.querySelectorAll("#totemServiceOptions [data-service-type]").forEach((button) => {
      button.classList.toggle("selected", button.dataset.serviceType === state.serviceType);
    });
    elements.priorityOptions?.querySelectorAll(".selected").forEach((item) => item.classList.remove("selected"));
    if (state.serviceType === "preferencial") setStep("priority");
    else continueAfterServiceSelection();
  }

  function continueAfterServiceSelection() {
    if (state.mode === "sector") {
      state.selectedSectors = state.selectedSector ? [state.selectedSector] : [];
      issueTickets();
      return;
    }
    setStep("sector");
  }

  function renderServiceOptions() {
    if (!elements.serviceOptions) return;
    elements.serviceOptions.innerHTML = SERVICE_TYPES.map((service) => `
      <button class="totem-choice ${service.className || ""}" type="button" data-service-type="${service.id}" aria-describedby="totem-service-${service.id}-description">
        <span class="totem-choice-marker" aria-hidden="true">${service.marker}</span>
        <span class="totem-choice-content"><strong>${escapeHtml(service.label)}</strong><span id="totem-service-${service.id}-description">${escapeHtml(service.description)}</span></span>
        <span class="totem-choice-arrow" aria-hidden="true">&#8594;</span>
      </button>
    `).join("");
    elements.serviceOptions.querySelectorAll("[data-service-type]").forEach((button) => {
      button.addEventListener("click", () => selectServiceType(button.dataset.serviceType));
    });
  }

  function renderPriorityOptions() {
    elements.priorityOptions.innerHTML = PRIORITY_CATEGORIES.map((category) => `
      <button class="totem-priority-option" type="button" data-priority-category="${category.id}">
        <img class="totem-priority-image" src="${category.image}" alt="" loading="lazy" />
        <strong>${escapeHtml(category.label)}</strong>
      </button>
    `).join("");
    elements.priorityOptions.querySelectorAll("[data-priority-category]").forEach((button) => {
      button.addEventListener("click", () => {
        state.priorityReason = button.dataset.priorityCategory;
        elements.priorityOptions.querySelectorAll(".selected").forEach((item) => item.classList.remove("selected"));
        button.classList.add("selected");
        continueAfterServiceSelection();
      });
    });
  }

  function setStep(step) {
    state.currentStep = step;
    elements.operation.dataset.totemStep = step;
    const steps = {
      type: elements.typeStep,
      priority: elements.priorityStep,
      sector: elements.sectorStep
    };
    Object.entries(steps).forEach(([name, element]) => {
      if (!element) return;
      element.hidden = name !== step || (name === "sector" && state.mode === "sector");
    });
    document.querySelectorAll("[data-progress-step]").forEach((item) => item.classList.toggle("active", item.dataset.progressStep === step));
    const copy = {
      type: ["Escolha o atendimento", "Escolha atendimento normal ou preferencial."],
      priority: ["Categoria preferencial", "Selecione a categoria que corresponde à sua necessidade."],
      sector: ["Escolha os setores", "Selecione um ou mais setores e retire sua senha."]
    }[step] || ["Retire sua senha", "Escolha como deseja ser atendido."];
    elements.flowTitle.textContent = copy[0];
    elements.flowDescription.textContent = copy[1];
    renderSectorSelection();
    if (elements.issueTicketsButton) {
      elements.issueTicketsButton.disabled = state.issueInFlight || !state.selectedSectors.length || !state.serviceType || (state.serviceType === "preferencial" && !state.priorityReason);
    }
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

  async function issueTickets() {
    const sectors = [...state.selectedSectors];
    if (!sectors.length || !state.serviceType || (state.serviceType === "preferencial" && !state.priorityReason) || state.issueInFlight) return;
    state.issueInFlight = true;
    elements.issueTicketsButton.disabled = true;
    elements.issueTicketsButton.textContent = "Emitindo...";
    try {
      const body = {
        idempotencyKey: createIdempotencyKey(),
        priority: state.serviceType === "preferencial",
        priorityReason: state.priorityReason
      };
      if (sectors.length === 1) body.sectorId = sectors[0].id;
      else body.sectorIds = sectors.map((sector) => sector.id);
      const result = await api("/api/kiosk/tickets", {
        method: "POST",
        body,
        csrf: "senhahub_kiosk_csrf",
        csrfHeader: "x-kiosk-csrf"
      });
      const tickets = result.tickets || (result.ticket ? [result.ticket] : []);
      const printJobs = result.printJob?.id ? [result.printJob] : [];
      if (!tickets.length) throw new Error("Não foi possível emitir as senhas agora.");
      showResult({ tickets, printJobs });
      if (printJobs.length) pollPrintJobs(printJobs.map((job) => job.id));
    } catch (error) {
      elements.feedback.textContent = error.message;
    } finally {
      state.issueInFlight = false;
      elements.issueTicketsButton.textContent = "Emitir senha";
      if (!elements.result.hidden) return;
      renderSectorSelection();
    }
  }

  function showResult(result) {
    clearTimeout(state.resultTimer);
    const tickets = result.tickets || (result.ticket ? [result.ticket] : []);
    state.printJobs = result.printJobs || (result.printJob ? [result.printJob] : []);
    state.printFailures = result.failures || [];
    state.printJobStatuses = new Map(state.printJobs.map((job) => [job.id, job.status || "pending"]));
    state.issuedTicketCount = tickets.length;
    showOnly(elements.result);
    elements.resultSector.textContent = tickets.length === 1 ? tickets[0].sector : `${tickets.length} setores selecionados`;
    elements.resultTicket.textContent = tickets.length === 1 ? tickets[0].ticket : `${tickets.length} senhas`;
    elements.resultPriorityBadge.hidden = !tickets.some((ticket) => ticket.priority);
    elements.resultTickets.innerHTML = [
      ...tickets.map((ticket) => `<div class="totem-result-ticket"><strong>${escapeHtml(ticket.ticket)}</strong><span>${escapeHtml(ticket.sector)}</span></div>`),
      ...state.printFailures.map((failure) => `<div class="totem-result-ticket failed"><strong>Não emitida</strong><span>${escapeHtml(failure.sector?.name)}: ${escapeHtml(failure.message)}</span></div>`)
    ].join("");
    setPrintStateFromJobs();
    state.resultTimer = setTimeout(resetOperation, RESULT_DISPLAY_MS);
  }

  async function pollPrintJobs(jobIds) {
    if (elements.result.hidden) return;
    clearTimeout(state.pollingTimer);
    const results = await Promise.all(jobIds.map(async (jobId) => {
      try {
        const result = await api(`/api/kiosk/print-jobs/${encodeURIComponent(jobId)}`);
        return { jobId, status: result.job.status, error: result.job.lastError };
      } catch (error) {
        return { jobId, status: "failed", error: error.message };
      }
    }));
    if (elements.result.hidden) return;
    results.forEach((result) => state.printJobStatuses.set(result.jobId, result.status));
    setPrintStateFromJobs(results);
    if (results.some((result) => ["pending", "printing"].includes(result.status))) {
      state.pollingTimer = setTimeout(() => pollPrintJobs(jobIds), 1200);
    }
  }

  function setPrintStateFromJobs(latestResults = []) {
    const statuses = [...state.printJobStatuses.values()];
    const hasFailure = state.printFailures.length > 0 || statuses.includes("failed");
    const status = hasFailure
      ? "failed"
      : statuses.includes("printing")
        ? "printing"
        : statuses.includes("pending") || !statuses.length
          ? "pending"
          : "printed";
    const count = state.issuedTicketCount || 1;
    const subject = count === 1 ? "sua senha" : `${count} senhas`;
    const labels = {
      pending: `${subject} aguardando a impressora`,
      printing: `Imprimindo ${subject}`,
      printed: `${subject[0].toUpperCase()}${subject.slice(1)} impressas. Retire o papel.`,
      failed: state.printFailures[0]?.message || latestResults.find((result) => result.status === "failed")?.error || "Falha na impressão. Solicite ajuda."
    };
    elements.printState.dataset.state = status;
    elements.printState.querySelector("p").textContent = labels[status];
  }

  function resetOperation() {
    clearTimeout(state.pollingTimer);
    clearTimeout(state.resultTimer);
    state.pollingTimer = null;
    state.resultTimer = null;
    state.selectedSector = state.mode === "sector" ? state.selectedSector : null;
    state.selectedSectors = [];
    state.serviceType = null;
    state.priorityReason = null;
    state.printJobs = [];
    state.printJobStatuses = new Map();
    state.printFailures = [];
    state.issuedTicketCount = 0;
    state.issueInFlight = false;
    elements.feedback.textContent = "";
    renderStatus();
  }

  function hideTotemSteps() {
    document.querySelectorAll(".totem-step").forEach((step) => { step.hidden = true; });
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
