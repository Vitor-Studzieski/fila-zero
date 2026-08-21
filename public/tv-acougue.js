(function initializeButcherDisplay() {
  const POLL_INTERVAL_MS = 2000;
  const WEATHER_REFRESH_MS = 25 * 60 * 1000;
  const PLAYLIST_REFRESH_MS = 5 * 60 * 1000;
  const WAITING_STATUSES = new Set(["aguardando", "proximo", "espera_inteligente", "standby"]);
  const WEATHER_CONFIG = {
    city: "Pompéia, SP",
    latitude: -22.10883,
    longitude: -50.17208,
    timezone: "America/Sao_Paulo"
  };
  const WEATHER_CODES = {
    0: { label: "Céu limpo", icon: "☀" },
    1: { label: "Predominantemente limpo", icon: "◐" },
    2: { label: "Parcialmente nublado", icon: "◑" },
    3: { label: "Nublado", icon: "☁" },
    45: { label: "Neblina", icon: "≋" },
    48: { label: "Neblina congelante", icon: "≋" },
    51: { label: "Garoa leve", icon: "☂" },
    53: { label: "Garoa", icon: "☂" },
    55: { label: "Garoa forte", icon: "☂" },
    56: { label: "Garoa congelante", icon: "❄" },
    57: { label: "Garoa congelante forte", icon: "❄" },
    61: { label: "Chuva leve", icon: "☂" },
    63: { label: "Chuva", icon: "☂" },
    65: { label: "Chuva forte", icon: "☂" },
    66: { label: "Chuva congelante", icon: "❄" },
    67: { label: "Chuva congelante forte", icon: "❄" },
    71: { label: "Neve leve", icon: "❄" },
    73: { label: "Neve", icon: "❄" },
    75: { label: "Neve forte", icon: "❄" },
    77: { label: "Granizo", icon: "❄" },
    80: { label: "Pancadas de chuva", icon: "☂" },
    81: { label: "Pancadas de chuva", icon: "☂" },
    82: { label: "Pancadas fortes", icon: "☂" },
    85: { label: "Pancadas de neve", icon: "❄" },
    86: { label: "Pancadas de neve fortes", icon: "❄" },
    95: { label: "Trovoada", icon: "⚡" },
    96: { label: "Trovoada com granizo", icon: "⚡" },
    99: { label: "Trovoada forte", icon: "⚡" }
  };
  const state = {
    lastCall: "",
    timer: null,
    requestInFlight: false,
    weatherTimer: null,
    playlistTimer: null,
    playlist: [],
    playlistSignature: "",
    currentVideoIndex: -1,
    failedVideos: new Set(),
    videoErrorHandled: false
  };
  const elements = {
    clock: document.querySelector("#tvClock"),
    date: document.querySelector("#tvDate"),
    weather: document.querySelector("#tvWeather"),
    weatherIcon: document.querySelector("#tvWeatherIcon"),
    weatherTemperature: document.querySelector("#tvWeatherTemperature"),
    weatherCondition: document.querySelector("#tvWeatherCondition"),
    connection: document.querySelector("#tvConnection"),
    queueTitle: document.querySelector("#tvQueueTitle"),
    queueSubtitle: document.querySelector("#tvQueueSubtitle"),
    waitingSubtitle: document.querySelector("#tvWaitingSubtitle"),
    recentCalls: document.querySelector("#tvRecentCalls"),
    waitingCount: document.querySelector("#tvWaitingCount"),
    waitingTickets: document.querySelector("#tvWaitingTickets"),
    currentCall: document.querySelector("#tvCurrentCall"),
    currentStatus: document.querySelector("#tvCurrentStatus"),
    currentTicket: document.querySelector("#tvCurrentTicket"),
    currentCustomer: document.querySelector("#tvCurrentCustomer"),
    feedback: document.querySelector("#tvFeedback"),
    videoStage: document.querySelector("#tvVideoStage"),
    video: document.querySelector("#tvPlaylistVideo"),
    videoPlaceholder: document.querySelector("#tvVideoPlaceholder"),
    videoLabel: document.querySelector("#tvVideoLabel"),
    videoCounter: document.querySelector("#tvVideoCounter"),
    playlistList: document.querySelector("#tvPlaylistList"),
    playlistStatus: document.querySelector("#tvPlaylistStatus"),
    mediaFeedback: document.querySelector("#tvMediaFeedback")
  };

  updateClock();
  loadWeather();
  loadPlaylist();
  if (elements.video) {
    elements.video.addEventListener("ended", playNextVideo);
    elements.video.addEventListener("error", handleVideoError);
    elements.video.addEventListener("loadeddata", handleVideoReady);
  }
  window.setInterval(updateClock, 1000);
  loadState();
  state.timer = window.setInterval(loadState, POLL_INTERVAL_MS);
  state.weatherTimer = window.setInterval(loadWeather, WEATHER_REFRESH_MS);
  state.playlistTimer = window.setInterval(loadPlaylist, PLAYLIST_REFRESH_MS);
  window.addEventListener("online", loadState);
  window.addEventListener("offline", () => setConnection("offline", "Sem conexão"));

  async function loadState() {
    if (state.requestInFlight) return;
    state.requestInFlight = true;
    setConnection("loading", "Atualizando");
    try {
      const payload = await api("/api/display/state");
      const sector = payload.sectors?.[0];
      if (!sector) throw new Error("A fila deste atendimento ainda não está disponível.");
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
    const sectorLabel = displaySectorName(sector.name || sector.id);
    const storeLabel = storeName(sector.storeCode || sector.store_code || sector.name);
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
    if (elements.queueTitle) elements.queueTitle.textContent = sectorLabel;
    if (elements.queueSubtitle) elements.queueSubtitle.textContent = `${storeLabel} · Senhas em tempo real`;
    if (elements.waitingSubtitle) elements.waitingSubtitle.textContent = `Próximas senhas de ${sectorLabel.toLowerCase()}`;
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
    return `<div class="tv-call-row ${latest ? "is-latest" : ""}"><span class="tv-call-sector">${escapeHtml(displaySectorName(sector.name || sector.id).toUpperCase())}</span><strong>${escapeHtml(ticket)}</strong><time>${time}</time></div>`;
  }

  function waitingRow(ticket, sector) {
    const position = Number(ticket.position) > 0 ? `${ticket.position}º` : "--";
    return `<div class="tv-waiting-row"><strong>${escapeHtml(formatTicket(ticket.ticket || ticket.ticketNumber, sector.prefix))}</strong><span>${escapeHtml(position)} na fila</span></div>`;
  }

  function updateClock() {
    const now = new Date();
    if (elements.clock) elements.clock.textContent = now.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
    if (elements.date) elements.date.textContent = now.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "long", year: "numeric" });
  }

  async function loadWeather() {
    const query = new URLSearchParams({
      latitude: String(WEATHER_CONFIG.latitude),
      longitude: String(WEATHER_CONFIG.longitude),
      current: "temperature_2m,weather_code",
      temperature_unit: "celsius",
      timezone: WEATHER_CONFIG.timezone
    });
    try {
      const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      const current = payload.current;
      if (!response.ok || !current || !Number.isFinite(Number(current.temperature_2m))) throw new Error("Clima indisponível");
      renderWeather(current, false);
    } catch {
      renderWeather(null, true);
    }
  }

  function renderWeather(current, fallback) {
    const description = WEATHER_CODES[Number(current?.weather_code)] || { label: "Condição não informada", icon: "☁" };
    if (elements.weather) elements.weather.dataset.state = fallback ? "offline" : "online";
    if (elements.weatherIcon) elements.weatherIcon.textContent = current ? description.icon : "—";
    if (elements.weatherTemperature) elements.weatherTemperature.textContent = current ? `${Math.round(Number(current.temperature_2m))}°C` : "--°C";
    if (elements.weatherCondition) elements.weatherCondition.textContent = current ? `${description.label} · ${WEATHER_CONFIG.city}` : "Clima indisponível";
  }

  async function loadPlaylist() {
    try {
      const response = await fetch("/data/tv-playlist.json", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(payload.items)) throw new Error("Playlist indisponível");
      const playlist = payload.items
        .filter((item) => item && item.active !== false && typeof item.src === "string" && item.src.trim())
        .map((item, index) => ({
          id: String(item.id || `video-${index + 1}`),
          title: String(item.title || `Vídeo ${index + 1}`).trim(),
          src: item.src.trim(),
          orientation: item.orientation === "portrait" ? "portrait" : "landscape",
          order: Number.isFinite(Number(item.order)) ? Number(item.order) : index
        }))
        .sort((left, right) => left.order - right.order);
      const signature = playlist.map((item) => `${item.id}|${item.src}|${item.orientation}|${item.order}|${item.title}`).join("||");
      if (signature === state.playlistSignature) return;
      state.playlistSignature = signature;
      state.playlist = playlist;
      state.failedVideos.clear();
      state.currentVideoIndex = -1;
      renderPlaylist();
      if (playlist.length) playNextVideo();
      else showEmptyPlaylist("Aguardando materiais");
    } catch {
      if (!state.playlist.length) showEmptyPlaylist("Playlist indisponível");
    }
  }

  function renderPlaylist() {
    if (!elements.playlistList) return;
    if (!state.playlist.length) {
      showEmptyPlaylist("Aguardando materiais");
      return;
    }
    elements.playlistList.innerHTML = state.playlist.map((item, index) => `
      <div class="tv-playlist-item" data-video-id="${escapeHtml(item.id)}">
        <span>${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(item.title)}</strong><small>${item.orientation === "portrait" ? "Vertical" : "Horizontal"}</small>
      </div>
    `).join("");
    if (elements.playlistStatus) elements.playlistStatus.textContent = `${state.playlist.length} ${state.playlist.length === 1 ? "vídeo ativo" : "vídeos ativos"}`;
  }

  function playNextVideo() {
    if (!state.playlist.length) {
      showEmptyPlaylist("Aguardando materiais");
      return;
    }
    const nextIndex = findNextVideoIndex();
    if (nextIndex < 0) {
      showEmptyPlaylist("Nenhum vídeo pôde ser reproduzido");
      if (elements.mediaFeedback) elements.mediaFeedback.textContent = "Verifique os arquivos da playlist.";
      return;
    }
    state.currentVideoIndex = nextIndex;
    const item = state.playlist[nextIndex];
    state.videoErrorHandled = false;
    if (elements.videoStage) {
      elements.videoStage.dataset.state = "loading";
      elements.videoStage.dataset.orientation = item.orientation;
    }
    if (elements.videoPlaceholder) elements.videoPlaceholder.hidden = true;
    if (elements.videoLabel) elements.videoLabel.textContent = item.title;
    if (elements.videoCounter) elements.videoCounter.textContent = `${nextIndex + 1}/${state.playlist.length}`;
    document.querySelectorAll(".tv-playlist-item").forEach((row) => row.classList.toggle("is-active", row.dataset.videoId === item.id));
    if (!elements.video) return;
    elements.video.src = item.src;
    elements.video.load();
    const playRequest = elements.video.play();
    if (playRequest?.catch) playRequest.catch(handleVideoError);
  }

  function findNextVideoIndex() {
    for (let step = 1; step <= state.playlist.length; step += 1) {
      const index = (state.currentVideoIndex + step) % state.playlist.length;
      if (!state.failedVideos.has(state.playlist[index].id)) return index;
    }
    return -1;
  }

  function handleVideoError() {
    if (state.videoErrorHandled || state.currentVideoIndex < 0) return;
    state.videoErrorHandled = true;
    const item = state.playlist[state.currentVideoIndex];
    if (item) state.failedVideos.add(item.id);
    if (elements.mediaFeedback) elements.mediaFeedback.textContent = `Não foi possível reproduzir “${item?.title || "este vídeo"}”.`;
    window.setTimeout(playNextVideo, 250);
  }

  function handleVideoReady() {
    if (elements.videoStage) elements.videoStage.dataset.state = "playing";
  }

  function showEmptyPlaylist(status) {
    if (elements.videoStage) elements.videoStage.dataset.state = "empty";
    if (elements.video) {
      elements.video.pause();
      elements.video.removeAttribute("src");
      elements.video.load();
    }
    if (elements.videoPlaceholder) elements.videoPlaceholder.hidden = false;
    if (elements.playlistStatus) elements.playlistStatus.textContent = status;
    if (elements.playlistList && !state.playlist.length) elements.playlistList.innerHTML = `<div class="tv-playlist-empty">Adicione vídeos à playlist para iniciar a reprodução.</div>`;
  }

  function displaySectorName(value) {
    return String(value || "Atendimento").replace(/\s+-\s+Loja\s+[12]$/i, "").trim() || "Atendimento";
  }

  function storeName(value) {
    const match = String(value || "").match(/loja[- ]?([12])/i);
    return match ? `Loja ${match[1]}` : "Loja Pompeia";
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
