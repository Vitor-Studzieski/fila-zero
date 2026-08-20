(function initializeSenhaHubPwa() {
  const utils = window.SenhaHubPwaUtils;
  if (!utils) {
    console.error("pwa_utils_unavailable");
    return;
  }

  const INSTALL_DISMISS_MS = 7 * 24 * 60 * 60 * 1000;
  const UPDATE_INTERVAL_MS = 60 * 60 * 1000;
  const state = {
    deferredInstallPrompt: null,
    registration: null,
    criticalOperations: 0,
    updateApplying: false,
    lastNetworkSuccessAt: Number(localStorage.getItem("senhaHubLastNetworkSuccessAt") || 0),
    pushStatus: null,
    pushStatusPromise: null,
    currentSubscription: null
  };

  window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  window.addEventListener("appinstalled", handleAppInstalled);
  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);
  navigator.serviceWorker?.addEventListener("message", handleServiceWorkerMessage);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeDom, { once: true });
  } else {
    initializeDom();
  }
  if (document.readyState === "complete") {
    scheduleServiceWorkerRegistration();
  } else {
    window.addEventListener("load", scheduleServiceWorkerRegistration, { once: true });
  }

  window.senhaHubPwa = {
    markCriticalOperation,
    openNotificationSettings,
    prepareLogout,
    requestInstallation,
    reportNetworkFailure,
    reportNetworkSuccess,
    isInstalled: () => utils.isStandaloneDisplay()
  };

  function initializeDom() {
    createGlobalUi();
    bindGlobalUi();
    bindNotificationSettings();
    bindOfflineActionGuard();
    syncConnectionState();
    syncInstallState();
    if (
      state.deferredInstallPrompt
      && !installationDismissed()
      && !utils.isStandaloneDisplay()
    ) {
      document.querySelector("#pwaInstallPrompt").hidden = false;
    }
  }

  function createGlobalUi() {
    if (!document.querySelector("#pwaConnectionBanner")) {
      const connection = document.createElement("div");
      connection.id = "pwaConnectionBanner";
      connection.className = "pwa-banner";
      connection.hidden = true;
      connection.setAttribute("role", "status");
      connection.setAttribute("aria-live", "polite");
      connection.innerHTML = '<span class="pwa-status-dot" aria-hidden="true"></span><span id="pwaConnectionText"></span>';
      document.body.append(connection);
    }

    if (!document.querySelector("#pwaInstallPrompt")) {
      const install = document.createElement("section");
      install.id = "pwaInstallPrompt";
      install.className = "pwa-prompt";
      install.hidden = true;
      install.setAttribute("aria-labelledby", "pwaInstallTitle");
      install.innerHTML = [
        '<strong id="pwaInstallTitle">Instale o SenhaHub</strong>',
        "<p>Acompanhe sua senha pela tela inicial e receba alertas quando o aplicativo estiver fechado.</p>",
        '<div class="pwa-prompt-actions">',
        '<button class="pwa-button" id="pwaInstallNow" type="button">Instalar</button>',
        '<button class="pwa-button secondary" id="pwaInstallLater" type="button">Agora não</button>',
        "</div>"
      ].join("");
      document.body.append(install);
    }

    if (!document.querySelector("#pwaUpdatePrompt")) {
      const update = document.createElement("section");
      update.id = "pwaUpdatePrompt";
      update.className = "pwa-prompt";
      update.hidden = true;
      update.setAttribute("aria-labelledby", "pwaUpdateTitle");
      update.innerHTML = [
        '<strong id="pwaUpdateTitle">Uma nova versão do SenhaHub está disponível</strong>',
        '<p id="pwaUpdateDescription">Atualize para usar a versão mais recente.</p>',
        '<div class="pwa-prompt-actions">',
        '<button class="pwa-button" id="pwaUpdateNow" type="button">Atualizar agora</button>',
        '<button class="pwa-button secondary" id="pwaUpdateLater" type="button">Depois</button>',
        "</div>"
      ].join("");
      document.body.append(update);
    }
  }

  function bindGlobalUi() {
    document.querySelector("#pwaInstallNow")?.addEventListener("click", requestInstallation);
    document.querySelector("#pwaInstallLater")?.addEventListener("click", dismissInstallation);
    document.querySelector("#pwaUpdateNow")?.addEventListener("click", applyWaitingUpdate);
    document.querySelector("#pwaUpdateLater")?.addEventListener("click", () => {
      document.querySelector("#pwaUpdatePrompt").hidden = true;
    });
  }

  function bindNotificationSettings() {
    const settings = document.querySelector("#notificationSettings");
    if (!settings) return;
    document.querySelector("#enablePushButton")?.addEventListener("click", enablePushNotifications);
    document.querySelector("#disablePushButton")?.addEventListener("click", disableCurrentPushSubscription);
    document.querySelector("#pushTestButton")?.addEventListener("click", sendTestNotification);
    document.querySelector("#accountInstallButton")?.addEventListener("click", requestInstallation);
    document.querySelectorAll("[data-push-preference]").forEach((input) => {
      input.addEventListener("change", savePushPreferences);
    });
    refreshPushStatus();
  }

  function bindOfflineActionGuard() {
    ["click", "submit", "change"].forEach((eventName) => {
      document.addEventListener(eventName, blockOfflineAction, true);
    });
  }

  function blockOfflineAction(event) {
    if (navigator.onLine) return;
    const guardedAction = event.target.closest?.("[data-online-required]");
    if (!guardedAction) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    setConnectionState("offline");
  }

  function scheduleServiceWorkerRegistration() {
    const register = () => registerServiceWorker().catch((error) => {
      console.error("service_worker_registration_failed", error);
      setPushState("Não foi possível preparar o aplicativo", "Recarregue a página e tente novamente.", "error");
    });
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(register, { timeout: 2500 });
    } else {
      setTimeout(register, 300);
    }
  }

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    const registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none"
    });
    state.registration = registration;
    watchRegistration(registration);
    if (registration.waiting && navigator.serviceWorker.controller) showUpdatePrompt();
    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
    setInterval(() => {
      if (!document.hidden && navigator.onLine) registration.update().catch((error) => {
        console.warn("service_worker_update_check_failed", error);
      });
    }, UPDATE_INTERVAL_MS);
    await refreshPushStatus();
  }

  function watchRegistration(registration) {
    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed" && navigator.serviceWorker.controller) showUpdatePrompt();
      });
    });
  }

  function showUpdatePrompt() {
    const prompt = document.querySelector("#pwaUpdatePrompt");
    if (prompt) prompt.hidden = false;
  }

  function applyWaitingUpdate() {
    const waiting = state.registration?.waiting;
    const description = document.querySelector("#pwaUpdateDescription");
    if (!waiting) {
      if (description) description.textContent = "A atualização ainda está sendo preparada. Tente novamente em instantes.";
      state.registration?.update().catch(() => {});
      return;
    }
    if (state.criticalOperations > 0) {
      if (description) description.textContent = "Conclua a operação atual antes de atualizar o aplicativo.";
      return;
    }
    state.updateApplying = true;
    const button = document.querySelector("#pwaUpdateNow");
    if (button) {
      button.disabled = true;
      button.textContent = "Atualizando...";
    }
    waiting.postMessage({ type: "SKIP_WAITING" });
  }

  function handleControllerChange() {
    if (!state.updateApplying) return;
    const lastReload = Number(sessionStorage.getItem("senhaHubPwaUpdateReloadAt") || 0);
    if (Date.now() - lastReload < 10000) return;
    sessionStorage.setItem("senhaHubPwaUpdateReloadAt", String(Date.now()));
    location.reload();
  }

  function handleBeforeInstallPrompt(event) {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    recordPwaEvent("install_available");
    syncInstallState();
    if (!installationDismissed() && !utils.isStandaloneDisplay()) {
      const prompt = document.querySelector("#pwaInstallPrompt");
      if (prompt) prompt.hidden = false;
    }
  }

  async function requestInstallation() {
    if (utils.isStandaloneDisplay()) {
      syncInstallState();
      return;
    }
    if (state.deferredInstallPrompt) {
      const promptEvent = state.deferredInstallPrompt;
      state.deferredInstallPrompt = null;
      await promptEvent.prompt();
      const result = await promptEvent.userChoice;
      recordPwaEvent(result.outcome === "accepted" ? "install_accepted" : "install_rejected");
      document.querySelector("#pwaInstallPrompt").hidden = true;
      syncInstallState();
      return;
    }
    recordPwaEvent("install_unavailable");
    showInstallInstructions();
  }

  function dismissInstallation() {
    localStorage.setItem("senhaHubInstallDismissedAt", String(Date.now()));
    recordPwaEvent("install_dismissed");
    document.querySelector("#pwaInstallPrompt").hidden = true;
  }

  function installationDismissed() {
    const timestamp = Number(localStorage.getItem("senhaHubInstallDismissedAt") || 0);
    return timestamp > 0 && Date.now() - timestamp < INSTALL_DISMISS_MS;
  }

  function handleAppInstalled() {
    state.deferredInstallPrompt = null;
    localStorage.removeItem("senhaHubInstallDismissedAt");
    recordPwaEvent("install_completed");
    const prompt = document.querySelector("#pwaInstallPrompt");
    if (prompt) prompt.hidden = true;
    syncInstallState();
  }

  function syncInstallState() {
    const text = document.querySelector("#installStateText");
    const button = document.querySelector("#accountInstallButton");
    if (!text || !button) return;
    const installed = utils.isStandaloneDisplay();
    text.textContent = installed
      ? "O SenhaHub está aberto como aplicativo neste dispositivo."
      : "Use o aplicativo pela tela inicial para acessar sua fila com mais rapidez.";
    button.hidden = installed;
  }

  function showInstallInstructions() {
    const help = document.querySelector("#pushHelp");
    if (!help) return;
    const platform = currentPlatform();
    help.hidden = false;
    help.textContent = platform === "ios"
      ? "No iPhone ou iPad, abra o menu Compartilhar do navegador, escolha Adicionar à Tela de Início e abra o SenhaHub pelo novo ícone."
      : "Use a opção Instalar aplicativo ou Adicionar à tela inicial no menu do navegador. Se ela não aparecer, este navegador pode não oferecer instalação.";
    openNotificationSettings();
  }

  function handleOffline() {
    setConnectionState("offline");
  }

  function handleOnline() {
    setConnectionState("reconnecting");
    verifyConnection();
  }

  async function verifyConnection() {
    try {
      const response = await fetch("/api/config", {
        cache: "no-store",
        credentials: "same-origin",
        signal: AbortSignal.timeout(6000)
      });
      if (!response.ok) throw new Error("connection_check_failed");
      reportNetworkSuccess();
      window.dispatchEvent(new CustomEvent("senhahub:reconnected"));
    } catch {
      setConnectionState("reconnecting");
    }
  }

  function reportNetworkSuccess(timestamp = Date.now()) {
    state.lastNetworkSuccessAt = Number(timestamp) || Date.now();
    localStorage.setItem("senhaHubLastNetworkSuccessAt", String(state.lastNetworkSuccessAt));
    if (navigator.onLine) setConnectionState("online");
  }

  function reportNetworkFailure() {
    if (!navigator.onLine) setConnectionState("offline");
  }

  function syncConnectionState() {
    setConnectionState(navigator.onLine ? "online" : "offline");
  }

  function setConnectionState(nextState) {
    document.documentElement.dataset.networkState = nextState;
    const banner = document.querySelector("#pwaConnectionBanner");
    const text = document.querySelector("#pwaConnectionText");
    if (!banner || !text) return;
    banner.dataset.state = nextState;
    banner.hidden = nextState === "online";
    if (nextState === "offline") {
      text.textContent = state.lastNetworkSuccessAt
        ? `Sem conexão. Última atualização confirmada às ${formatClock(state.lastNetworkSuccessAt)}.`
        : "Sem conexão. Os dados da fila podem estar desatualizados.";
    } else if (nextState === "reconnecting") {
      text.textContent = "Conexão restaurada. Sincronizando dados da fila...";
    }
  }

  function markCriticalOperation(active) {
    state.criticalOperations = Math.max(0, state.criticalOperations + (active ? 1 : -1));
  }

  function refreshPushStatus() {
    if (state.pushStatusPromise) return state.pushStatusPromise;
    state.pushStatusPromise = loadPushStatus().finally(() => {
      state.pushStatusPromise = null;
    });
    return state.pushStatusPromise;
  }

  async function loadPushStatus() {
    const settings = document.querySelector("#notificationSettings");
    if (!settings) return;
    const compatibility = pushCompatibility();
    if (!compatibility.compatible) {
      setPushState("Alertas não disponíveis neste navegador", compatibility.reason, "error");
      setPreferenceControlsDisabled(true);
      return;
    }
    if (compatibility.requiresInstallation) {
      setPushState("Instale o aplicativo para ativar alertas", "No iPhone e iPad, as notificações funcionam após adicionar o SenhaHub à tela inicial.", "error");
    }
    try {
      const subscription = await navigator.serviceWorker.ready.then((registration) => registration.pushManager.getSubscription());
      const status = await fetchJson("/api/push/status");
      const currentHash = subscription ? await hashEndpoint(subscription.endpoint) : "";
      status.currentDevice = status.devices?.find((device) => device.endpointHash === currentHash) || null;
      status.subscriptionActive = Boolean(status.currentDevice?.enabled);
      state.pushStatus = status;
      state.currentSubscription = subscription;
      renderPushStatus(status, subscription, compatibility);
    } catch (error) {
      setPushState("Não foi possível consultar os alertas", error.message || "Tente novamente em instantes.", "error");
    }
  }

  function renderPushStatus(status, subscription, compatibility) {
    syncPreferenceControls(status.preferences);
    setPreferenceControlsDisabled(!status.configured);
    const enable = document.querySelector("#enablePushButton");
    const disable = document.querySelector("#disablePushButton");
    const test = document.querySelector("#pushTestButton");
    const device = document.querySelector("#pushDeviceDescription");
    const active = Boolean(subscription && status.subscriptionActive);

    if (enable) {
      enable.hidden = active;
      enable.disabled = !status.configured || compatibility.requiresInstallation || Notification.permission === "denied";
    }
    if (disable) disable.hidden = !active;
    if (test) test.hidden = !active || !status.canTest;
    if (device) {
      device.textContent = active
        ? `Dispositivo inscrito: ${status.currentDevice?.deviceName || deviceDescription()}.`
        : "Nenhum alerta ativo neste dispositivo.";
    }

    if (!status.configured) {
      setPushState("Alertas aguardando configuração", "As chaves de envio ainda não foram configuradas no servidor.", "error");
      return;
    }
    if (Notification.permission === "denied") {
      setPushState("Permissão bloqueada", "Abra as configurações do navegador ou do sistema para permitir notificações do SenhaHub.", "error");
      return;
    }
    if (compatibility.requiresInstallation) return;
    if (active) {
      setPushState("Alertas ativos", "Este dispositivo receberá os avisos operacionais selecionados.");
      return;
    }
    setPushState(
      Notification.permission === "granted" ? "Dispositivo ainda não inscrito" : "Permissão ainda não solicitada",
      "Toque em Ativar alertas para escolher se deseja receber os avisos."
    );
  }

  async function enablePushNotifications() {
    const compatibility = pushCompatibility();
    if (!compatibility.compatible) {
      setPushState("Alertas não disponíveis", compatibility.reason, "error");
      return;
    }
    if (compatibility.requiresInstallation) {
      showInstallInstructions();
      setPushState("Instale o aplicativo primeiro", "Depois de abrir o SenhaHub pela tela inicial, volte aqui e ative os alertas.", "error");
      return;
    }
    if (!state.pushStatus?.configured || !state.pushStatus.publicKey) {
      setPushState("Alertas aguardando configuração", "As chaves de envio ainda não foram configuradas no servidor.", "error");
      return;
    }

    const button = document.querySelector("#enablePushButton");
    setButtonBusy(button, true, "Ativando...");
    try {
      const permission = await Notification.requestPermission();
      recordPwaEvent(`notification_permission_${permission}`);
      if (permission !== "granted") {
        setPushState(
          permission === "denied" ? "Permissão bloqueada" : "Permissão não concedida",
          "Os avisos podem ser ativados depois nas configurações do aplicativo.",
          "error"
        );
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription()
        || await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: utils.urlBase64ToUint8Array(state.pushStatus.publicKey)
        });
      await fetchJson("/api/push/subscribe", {
        method: "POST",
        body: {
          subscription: subscription.toJSON(),
          device: {
            deviceName: deviceDescription(),
            platform: currentPlatform()
          },
          preferences: readPreferenceControls()
        }
      });
      state.currentSubscription = subscription;
      await refreshPushStatus();
    } catch (error) {
      console.error("push_subscription_failed", error);
      setPushState("Não foi possível ativar os alertas", friendlyPushError(error), "error");
    } finally {
      setButtonBusy(button, false, "Ativar alertas");
    }
  }

  async function disableCurrentPushSubscription() {
    const button = document.querySelector("#disablePushButton");
    setButtonBusy(button, true, "Removendo...");
    try {
      const subscription = state.currentSubscription
        || await navigator.serviceWorker.ready.then((registration) => registration.pushManager.getSubscription());
      if (subscription) {
        await fetchJson("/api/push/unsubscribe", {
          method: "DELETE",
          body: { endpoint: subscription.endpoint }
        });
        await subscription.unsubscribe();
      }
      state.currentSubscription = null;
      await refreshPushStatus();
    } catch (error) {
      setPushState("Não foi possível remover este dispositivo", error.message || "Tente novamente.", "error");
    } finally {
      setButtonBusy(button, false, "Remover este dispositivo");
    }
  }

  async function savePushPreferences() {
    try {
      const result = await fetchJson("/api/push/preferences", {
        method: "PATCH",
        body: { preferences: readPreferenceControls() }
      });
      state.pushStatus = { ...state.pushStatus, preferences: result.preferences };
      setPushState("Preferências atualizadas", "Os próximos alertas seguirão suas escolhas.");
    } catch (error) {
      setPushState("Não foi possível salvar as preferências", error.message || "Tente novamente.", "error");
    }
  }

  async function sendTestNotification() {
    const button = document.querySelector("#pushTestButton");
    setButtonBusy(button, true, "Enviando...");
    try {
      await fetchJson("/api/push/test", { method: "POST", body: {} });
      setPushState("Notificação de teste enviada", "Ela pode levar alguns segundos para aparecer.");
    } catch (error) {
      setPushState("Falha no teste", error.message || "Tente novamente.", "error");
    } finally {
      setButtonBusy(button, false, "Enviar teste");
    }
  }

  async function prepareLogout() {
    try {
      const task = navigator.serviceWorker.ready
        .then((registration) => registration.pushManager.getSubscription())
        .then(async (subscription) => {
          if (!subscription) return;
          await fetchJson("/api/push/unsubscribe", {
            method: "DELETE",
            body: { endpoint: subscription.endpoint }
          });
          await subscription.unsubscribe();
        });
      await Promise.race([task, new Promise((resolve) => setTimeout(resolve, 2500))]);
    } catch (error) {
      console.warn("push_logout_cleanup_failed", error);
    }
  }

  function pushCompatibility() {
    if (!("serviceWorker" in navigator)) return { compatible: false, reason: "Este navegador não oferece suporte a aplicativos offline." };
    if (!("PushManager" in window) || !("Notification" in window)) {
      return { compatible: false, reason: "Este navegador não oferece suporte a notificações Web Push." };
    }
    const platform = currentPlatform();
    return {
      compatible: true,
      requiresInstallation: platform === "ios" && !utils.isStandaloneDisplay()
    };
  }

  function currentPlatform() {
    return utils.classifyPlatform(navigator.userAgent, navigator.userAgentData?.platform || navigator.platform);
  }

  function deviceDescription() {
    return utils.deviceNameFor(currentPlatform(), navigator.userAgent);
  }

  function readPreferenceControls() {
    return Object.fromEntries(
      [...document.querySelectorAll("[data-push-preference]")]
        .map((input) => [input.dataset.pushPreference, input.checked])
    );
  }

  function syncPreferenceControls(preferences = {}) {
    document.querySelectorAll("[data-push-preference]").forEach((input) => {
      const fallback = input.dataset.pushPreference !== "promotions";
      input.checked = preferences[input.dataset.pushPreference] ?? fallback;
    });
  }

  function setPreferenceControlsDisabled(disabled) {
    document.querySelectorAll("[data-push-preference]").forEach((input) => {
      input.disabled = disabled;
    });
  }

  function setPushState(title, description, kind = "normal") {
    const container = document.querySelector("#pushSettingsState");
    const titleNode = document.querySelector("#pushSettingsTitle");
    const descriptionNode = document.querySelector("#pushSettingsDescription");
    if (!container || !titleNode || !descriptionNode) return;
    container.dataset.kind = kind;
    titleNode.textContent = title;
    descriptionNode.textContent = description;
  }

  function openNotificationSettings() {
    const settings = document.querySelector("#notificationSettings");
    if (!settings) return;
    settings.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    document.querySelector("#enablePushButton")?.focus({ preventScroll: true });
  }

  function handleServiceWorkerMessage(event) {
    if (event.data?.type === "PUSH_EVENT") {
      window.dispatchEvent(new CustomEvent("senhahub:push", { detail: event.data.payload }));
      return;
    }
    if (event.data?.type === "NOTIFICATION_CLICK") {
      window.dispatchEvent(new CustomEvent("senhahub:notification-click", { detail: event.data.payload }));
    }
  }

  async function fetchJson(path, options = {}) {
    const method = options.method || "GET";
    const isMutation = method !== "GET";
    if (isMutation) markCriticalOperation(true);
    try {
      const response = await fetch(path, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          ...csrfHeader()
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(12000)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.error) throw new Error(payload.error || `Falha na API (${response.status}).`);
      reportNetworkSuccess();
      return payload;
    } catch (error) {
      reportNetworkFailure();
      throw error;
    } finally {
      if (isMutation) markCriticalOperation(false);
    }
  }

  function csrfHeader() {
    const token = ["senhahub_local_csrf", "senhahub_csrf"]
      .map((name) => document.cookie
        .split(";")
        .map((item) => item.trim())
        .find((item) => item.startsWith(`${name}=`))
        ?.slice(`${name}=`.length))
      .find(Boolean);
    return token ? { "x-csrf-token": token } : {};
  }

  function setButtonBusy(button, busy, label) {
    if (!button) return;
    button.disabled = busy;
    button.textContent = label;
  }

  function friendlyPushError(error) {
    if (Notification.permission === "denied") return "A permissão foi bloqueada nas configurações do navegador ou do sistema.";
    if (error?.name === "NotAllowedError") return "O navegador não autorizou a inscrição. Confirme a permissão e tente novamente.";
    if (error?.name === "AbortError" || error?.name === "TimeoutError") return "A conexão demorou além do esperado. Tente novamente.";
    return error?.message || "Tente novamente em instantes.";
  }

  async function hashEndpoint(endpoint) {
    const data = new TextEncoder().encode(String(endpoint || ""));
    const digest = await crypto.subtle.digest("SHA-256", data);
    let binary = "";
    new Uint8Array(digest).forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function recordPwaEvent(type) {
    try {
      const current = JSON.parse(localStorage.getItem("senhaHubPwaEvents") || "[]");
      const entries = Array.isArray(current) ? current.slice(-19) : [];
      entries.push({ type: String(type).slice(0, 80), at: new Date().toISOString() });
      localStorage.setItem("senhaHubPwaEvents", JSON.stringify(entries));
    } catch {
      // Installation telemetry is best effort and contains no personal data.
    }
  }

  function formatClock(timestamp) {
    return new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(timestamp));
  }
})();
