(function initializeInstallPage() {
  const stateTitle = document.querySelector("#installStateTitle");
  const stateDescription = document.querySelector("#installStateDescription");
  const installAction = document.querySelector("#installAction");
  const openAppAction = document.querySelector("#openAppAction");
  const steps = document.querySelector("#installSteps");

  renderPlatform();
  installAction?.addEventListener("click", requestInstall);
  window.addEventListener("appinstalled", renderPlatform);

  function renderPlatform() {
    const installed = window.FilaZeroPwaUtils?.isStandaloneDisplay?.() || false;
    const platform = detectPlatform();
    if (installed) {
      stateTitle.textContent = "Aplicativo instalado";
      stateDescription.textContent = "O Fila Zero ja esta aberto como aplicativo neste dispositivo.";
      installAction.hidden = true;
      openAppAction.textContent = "Abrir minha conta";
      return;
    }

    stateTitle.textContent = platform === "ios" ? "Instalacao pelo Safari" : "Pronto para instalar";
    stateDescription.textContent = platform === "ios"
      ? "No iPhone, a instalacao e concluida pelo menu Compartilhar."
      : "Toque no botao abaixo para adicionar o Fila Zero ao celular.";
    installAction.textContent = platform === "ios" ? "Ver como instalar no iPhone" : "Instalar aplicativo";
    steps.innerHTML = platform === "ios"
      ? [
          "<li><span>1</span><p>Abra esta pagina usando o Safari.</p></li>",
          "<li><span>2</span><p>Toque em Compartilhar, o quadrado com seta para cima.</p></li>",
          "<li><span>3</span><p>Escolha Adicionar a Tela de Inicio e confirme.</p></li>"
        ].join("")
      : [
          "<li><span>1</span><p>Toque em Instalar aplicativo.</p></li>",
          "<li><span>2</span><p>Confirme a instalacao quando o navegador solicitar.</p></li>",
          "<li><span>3</span><p>Abra o Fila Zero pelo novo icone.</p></li>"
        ].join("");
  }

  async function requestInstall() {
    installAction.disabled = true;
    try {
      const pwa = window.filaZeroPwa;
      if (pwa?.requestInstallation) {
        await pwa.requestInstallation();
      }
      if (detectPlatform() === "ios") {
        document.querySelector(".install-guide")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } finally {
      installAction.disabled = false;
      renderPlatform();
    }
  }

  function detectPlatform() {
    const value = `${navigator.userAgent || ""} ${navigator.platform || ""}`;
    return /iPhone|iPad|iPod/i.test(value) ? "ios" : "other";
  }
})();
