(function initializeTotem() {
  const state = {
    status: null,
    selectedSector: null,
    idempotencyKey: null,
    pollingTimer: null
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
    dialog: document.querySelector("#confirmDialog"),
    issueButton: document.querySelector("#issueTicketButton"),
    newTicketButton: document.querySelector("#newTicketButton"),
    resultSector: document.querySelector("#resultSector"),
    resultTicket: document.querySelector("#resultTicket"),
    printState: document.querySelector("#printState"),
    installQr: document.querySelector("#totemInstallQr")
  };

  elements.pairButton?.addEventListener("click", pairKiosk);
  elements.issueButton?.addEventListener("click", issueTicket);
  elements.newTicketButton?.addEventListener("click", resetOperation);
  window.addEventListener("online", loadStatus);
  window.addEventListener("offline", () => setConnection("offline", "Sem internet"));
  loadStatus();

  async function loadStatus() {
    setConnection("loading", "Conectando");
    try {
      state.status = await api("/api/kiosk/status");
      renderStatus();
      setConnection("online", "Totem online");
    } catch (error) {
      showOnly(elements.pair);
      elements.feedback.textContent = error.message;
      setConnection("offline", "Falha de conexao");
    }
  }

  function renderStatus() {
    if (!state.status.paired) {
      showOnly(elements.pair);
      elements.pairButton.hidden = !state.status.canPair;
      elements.pairLogin.hidden = state.status.canPair;
      document.querySelector("#totemPairMessage").textContent = state.status.canPair
        ? "Autorize este equipamento para liberar a emissao de senhas."
        : "Entre como gestor para autorizar a emissao de senhas neste equipamento.";
      return;
    }
    showOnly(elements.operation);
    renderSectors(state.status.sectors || []);
    renderInstallQr(state.status.kiosk?.installUrl);
  }

  function renderSectors(sectors) {
    elements.sectors.innerHTML = "";
    sectors.forEach((sector) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "totem-sector";
      button.innerHTML = [
        `<span class="totem-sector-prefix">${escapeHtml(sector.prefix)}</span>`,
        "<span class=\"totem-sector-copy\">",
        `<strong>${escapeHtml(sector.name)}</strong>`,
        `<small>${Number(sector.queueSize || 0)} pessoa(s) aguardando</small>`,
        "</span>",
        "<span class=\"totem-sector-arrow\" aria-hidden=\"true\">&#8594;</span>"
      ].join("");
      button.addEventListener("click", () => selectSector(sector));
      elements.sectors.append(button);
    });
    if (!sectors.length) elements.feedback.textContent = "Nenhum setor esta aberto neste momento.";
  }

  function selectSector(sector) {
    state.selectedSector = sector;
    state.idempotencyKey = createIdempotencyKey();
    document.querySelector("#confirmSectorName").textContent = sector.name;
    elements.dialog.showModal();
  }

  async function pairKiosk() {
    elements.pairButton.disabled = true;
    try {
      state.status = await api("/api/kiosk/pair", {
        method: "POST",
        body: { kioskId: "totem-pompeia-01" },
        csrf: "fz_csrf"
      });
      renderStatus();
    } catch (error) {
      document.querySelector("#totemPairMessage").textContent = error.message;
    } finally {
      elements.pairButton.disabled = false;
    }
  }

  async function issueTicket(event) {
    event.preventDefault();
    if (!state.selectedSector || !state.idempotencyKey) return;
    elements.issueButton.disabled = true;
    elements.issueButton.textContent = "Emitindo...";
    try {
      const result = await api("/api/kiosk/tickets", {
        method: "POST",
        body: {
          sectorId: state.selectedSector.id,
          idempotencyKey: state.idempotencyKey
        },
        csrf: "fz_kiosk_csrf",
        csrfHeader: "x-kiosk-csrf"
      });
      elements.dialog.close();
      showResult(result);
      pollPrintJob(result.printJob.id);
    } catch (error) {
      elements.feedback.textContent = error.message;
      elements.dialog.close();
    } finally {
      elements.issueButton.disabled = false;
      elements.issueButton.textContent = "Emitir senha";
    }
  }

  function showResult(result) {
    showOnly(elements.result);
    elements.resultSector.textContent = result.ticket.sector;
    elements.resultTicket.textContent = result.ticket.ticket;
    setPrintState(result.printJob.status);
  }

  async function pollPrintJob(jobId) {
    clearTimeout(state.pollingTimer);
    try {
      const result = await api(`/api/kiosk/print-jobs/${encodeURIComponent(jobId)}`);
      setPrintState(result.job.status, result.job.lastError);
      if (["pending", "printing"].includes(result.job.status)) {
        state.pollingTimer = setTimeout(() => pollPrintJob(jobId), 1200);
      }
    } catch {
      setPrintState("failed", "Nao foi possivel consultar a impressao.");
    }
  }

  function setPrintState(status, error) {
    const labels = {
      pending: "Aguardando a impressora",
      printing: "Imprimindo sua senha",
      printed: "Senha impressa. Retire o papel.",
      failed: error || "Falha na impressao. Solicite ajuda."
    };
    elements.printState.dataset.state = status;
    elements.printState.querySelector("p").textContent = labels[status] || labels.pending;
  }

  function resetOperation() {
    clearTimeout(state.pollingTimer);
    state.selectedSector = null;
    state.idempotencyKey = null;
    elements.feedback.textContent = "";
    renderStatus();
  }

  function showOnly(target) {
    [elements.loading, elements.pair, elements.operation, elements.result].forEach((section) => {
      section.hidden = section !== target;
    });
  }

  function setConnection(status, label) {
    elements.connection.dataset.state = status;
    elements.connection.querySelector("strong").textContent = label;
  }

  function renderInstallQr(installUrl) {
    if (!elements.installQr || elements.installQr.childElementCount) return;
    const target = String(installUrl || "https://fila-zero-mauve.vercel.app/instalar");
    if (!target.startsWith("https://") || typeof window.qrcode !== "function") {
      elements.installQr.textContent = "QR indisponivel";
      return;
    }
    const code = window.qrcode(0, "M");
    code.addData(target, "Byte");
    code.make();
    elements.installQr.innerHTML = code.createSvgTag({
      cellSize: 5,
      margin: 4,
      scalable: true
    });
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
    if (!response.ok || payload.error) throw new Error(payload.error || "Falha na comunicacao.");
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
