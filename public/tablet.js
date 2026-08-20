const PRIORITY_CATEGORIES = [
  { id: "deficiencia_ou_mobilidade_reduzida", label: "Deficiência ou mobilidade reduzida", icon: "♿" },
  { id: "tea", label: "Pessoa com TEA", icon: "🧩" },
  { id: "idoso_60_mais", label: "Pessoa com 60 anos ou mais", icon: "🧓" },
  { id: "gestante_ou_lactante", label: "Gestante ou lactante", icon: "🤰" },
  { id: "crianca_de_colo", label: "Pessoa com criança de colo", icon: "👶" },
  { id: "obesidade", label: "Pessoa com obesidade", icon: "🧍" }
];

const state = {
  status: null,
  serviceType: null,
  priorityReason: null,
  selectedSector: null,
  step: "type",
  inFlight: false,
  refreshTimer: null
};

const elements = {
  loading: document.querySelector("#tabletLoading"),
  error: document.querySelector("#tabletError"),
  errorTitle: document.querySelector("#tabletErrorTitle"),
  errorMessage: document.querySelector("#tabletErrorMessage"),
  operation: document.querySelector("#tabletOperation"),
  result: document.querySelector("#tabletResult"),
  connection: document.querySelector("#tabletConnection"),
  feedback: document.querySelector("#tabletFeedback"),
  sectors: document.querySelector("#tabletSectors"),
  priorityOptions: document.querySelector("#tabletPriorityOptions"),
  confirmSummary: document.querySelector("#tabletConfirmSummary"),
  continueButton: document.querySelector("#tabletContinueToConfirm"),
  issueButton: document.querySelector("#tabletIssueButton"),
  resultTickets: document.querySelector("#tabletResultTickets")
};

document.querySelectorAll("[data-tablet-type]").forEach((button) => {
  button.addEventListener("click", () => selectServiceType(button.dataset.tabletType));
});
document.querySelector("#tabletBackToType")?.addEventListener("click", () => setStep("type"));
document.querySelector("#tabletBackToTypeFromSector")?.addEventListener("click", () => setStep("type"));
document.querySelector("#tabletBackToSector")?.addEventListener("click", () => setStep("sector"));
elements.continueButton?.addEventListener("click", () => {
  if (state.selectedSector) setStep("confirm");
});
elements.issueButton?.addEventListener("click", issueTicket);
document.querySelector("#tabletNewRequest")?.addEventListener("click", resetOperation);
document.querySelector("#tabletLogoutButton")?.addEventListener("click", logout);

renderPriorityOptions();
loadStatus();

async function loadStatus() {
  setConnection("loading", "Conectando");
  try {
    const response = await fetch("/api/tablet/status", { credentials: "same-origin", cache: "no-store" });
    const payload = await parseApiPayload(response);
    if (response.status === 401) {
      location.href = "/login?next=%2Ftablet";
      return;
    }
    if (!response.ok || payload.error) throw new Error(payload.error || "Não foi possível carregar os setores.");
    state.status = payload;
    renderStatus();
    setConnection("online", "Tablet online");
  } catch (error) {
    showError("Acesso indisponível", error.message);
    setConnection("offline", "Falha de conexão");
  }
}

function renderStatus() {
  elements.loading.hidden = true;
  elements.error.hidden = true;
  elements.operation.hidden = false;
  elements.result.hidden = true;
  renderSectors(state.status?.sectors || []);
  resetOperation();
  clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(refreshStatus, 15000);
}

async function refreshStatus() {
  if (elements.operation.hidden || state.step !== "sector") return;
  try {
    const response = await fetch("/api/tablet/status", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) return;
    state.status = await response.json();
    renderSectors(state.status.sectors || []);
  } catch {
    // A lista atual continua disponível até a próxima atualização.
  }
}

function renderSectors(sectors) {
  elements.sectors.innerHTML = "";
  if (!sectors.length) {
    elements.sectors.innerHTML = '<p class="tablet-empty">Nenhum setor está aberto neste momento.</p>';
    return;
  }
  sectors.forEach((sector) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tablet-sector";
    button.dataset.sectorId = sector.id;
    button.setAttribute("aria-pressed", "false");
    button.innerHTML = [
      `<span class="tablet-sector-prefix">${escapeHtml(sector.prefix || "")}</span>`,
      `<span class="tablet-sector-copy"><strong>${escapeHtml(sector.name)}</strong><small>${Number(sector.queueSize || 0)} aguardando</small></span>`,
      '<span class="tablet-sector-arrow" aria-hidden="true">→</span>'
    ].join("");
    button.addEventListener("click", () => selectSector(sector));
    elements.sectors.append(button);
  });
}

function renderPriorityOptions() {
  elements.priorityOptions.innerHTML = PRIORITY_CATEGORIES.map((category) => `
    <button class="tablet-priority" type="button" data-tablet-priority="${category.id}">
      <span aria-hidden="true">${category.icon}</span><strong>${escapeHtml(category.label)}</strong>
    </button>
  `).join("");
  elements.priorityOptions.querySelectorAll("[data-tablet-priority]").forEach((button) => {
    button.addEventListener("click", () => {
      state.priorityReason = button.dataset.tabletPriority;
      elements.priorityOptions.querySelectorAll(".selected").forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
      setStep("sector");
    });
  });
}

function selectServiceType(type) {
  state.serviceType = type === "preferencial" ? "preferencial" : "normal";
  state.priorityReason = null;
  state.selectedSector = null;
  document.querySelectorAll("[data-tablet-type]").forEach((button) => {
    button.classList.toggle("selected", button.dataset.tabletType === state.serviceType);
  });
  elements.priorityOptions.querySelectorAll(".selected").forEach((item) => item.classList.remove("selected"));
  setStep(state.serviceType === "preferencial" ? "priority" : "sector");
}

function selectSector(sector) {
  state.selectedSector = sector;
  document.querySelectorAll(".tablet-sector").forEach((button) => {
    const selected = button.dataset.sectorId === sector.id;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  elements.continueButton.disabled = false;
  elements.feedback.textContent = "";
}

function setStep(step) {
  state.step = step;
  const steps = {
    type: document.querySelector("#tabletStepType"),
    priority: document.querySelector("#tabletStepPriority"),
    sector: document.querySelector("#tabletStepSector"),
    confirm: document.querySelector("#tabletStepConfirm")
  };
  Object.entries(steps).forEach(([name, element]) => { element.hidden = name !== step; });
  document.querySelectorAll("[data-tablet-progress]").forEach((item) => {
    item.classList.toggle("active", item.dataset.tabletProgress === step);
  });
  if (step === "confirm") renderConfirmSummary();
  elements.continueButton.disabled = !state.selectedSector;
  elements.feedback.textContent = "";
}

function renderConfirmSummary() {
  const category = PRIORITY_CATEGORIES.find((item) => item.id === state.priorityReason);
  const service = state.serviceType === "preferencial" ? "Atendimento preferencial" : "Atendimento normal";
  elements.confirmSummary.innerHTML = [
    `<div><span>Tipo de atendimento</span><strong>${escapeHtml(service)}</strong></div>`,
    state.serviceType === "preferencial" ? `<div><span>Categoria</span><strong>${escapeHtml(category?.label || "Não selecionada")}</strong></div>` : "",
    `<div><span>Setor</span><strong>${escapeHtml(state.selectedSector?.name || "Não selecionado")}</strong></div>`
  ].join("");
}

async function issueTicket() {
  if (!state.selectedSector || state.inFlight) return;
  state.inFlight = true;
  elements.issueButton.disabled = true;
  elements.issueButton.textContent = "Solicitando...";
  elements.feedback.textContent = "";
  try {
    const payload = await api("/api/tablet/tickets", {
      method: "POST",
      body: {
        sectorIds: [state.selectedSector.id],
        priority: state.serviceType === "preferencial",
        priorityReason: state.priorityReason
      }
    });
    renderResult(payload.tickets || []);
  } catch (error) {
    elements.feedback.textContent = error.message;
  } finally {
    state.inFlight = false;
    elements.issueButton.disabled = false;
    elements.issueButton.textContent = "Solicitar senha";
  }
}

function renderResult(tickets) {
  elements.operation.hidden = true;
  elements.result.hidden = false;
  elements.resultTickets.innerHTML = tickets.map((ticket) => `
    <article class="tablet-ticket-card">
      <span>${escapeHtml(ticket.sector || "Setor")}</span>
      <strong>${escapeHtml(ticket.ticket || "---")}</strong>
      <small>${ticket.priority ? "Atendimento preferencial" : "Atendimento normal"}</small>
    </article>
  `).join("");
}

function resetOperation() {
  state.serviceType = null;
  state.priorityReason = null;
  state.selectedSector = null;
  document.querySelectorAll("[data-tablet-type], .tablet-sector, .tablet-priority").forEach((item) => item.classList.remove("selected"));
  setStep("type");
  elements.result.hidden = true;
  elements.operation.hidden = false;
}

async function logout() {
  try { await api("/api/auth/logout", { method: "POST", body: {} }); } catch { /* A sessão pode já estar expirada. */ }
  location.href = "/login";
}

function showError(title, message) {
  elements.loading.hidden = true;
  elements.operation.hidden = true;
  elements.result.hidden = true;
  elements.error.hidden = false;
  elements.errorTitle.textContent = title;
  elements.errorMessage.textContent = message;
}

function setConnection(stateName, label) {
  elements.connection.dataset.state = stateName;
  const strong = elements.connection.querySelector("strong");
  if (strong) strong.textContent = label;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...csrfHeader() },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await parseApiPayload(response);
  if (!response.ok || payload.error) throw new Error(payload.error || "Falha na comunicação com o sistema.");
  return payload;
}

async function parseApiPayload(response) {
  const text = await response.text();
  if (!text.trim()) return response.ok ? {} : { error: "Falha na comunicação com o sistema." };
  try { return JSON.parse(text); } catch { return { error: `Falha na comunicação com o sistema (${response.status}).` }; }
}

function csrfHeader() {
  const token = getCookie("senhahub_local_csrf") || getCookie("senhahub_csrf");
  return token ? { "x-csrf-token": token } : {};
}

function getCookie(name) {
  return document.cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1) || "";
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}
