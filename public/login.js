document.querySelector("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.querySelector("#loginError");
  const submit = form.querySelector(".yellow-action");
  error.textContent = "";
  setSubmitting(submit, true);

  try {
    const result = await api("/api/auth/login", {
      method: "POST",
      body: Object.fromEntries(new FormData(form).entries())
    });
    const next = new URLSearchParams(location.search).get("next");
    location.href = allowedNextForRole(result.user.role, next);
  } catch (exception) {
    error.textContent = exception.message;
    showLoginToast(exception.message);
  } finally {
    setSubmitting(submit, false);
  }
});

document.querySelector("#passwordForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.querySelector("#passwordError");
  const submit = form.querySelector(".yellow-action");
  error.textContent = "";
  setSubmitting(submit, true);

  try {
    const result = await api("/api/auth/change-password", {
      method: "POST",
      body: Object.fromEntries(new FormData(form).entries())
    });
    form.reset();
    showLoginToast(result.message || "Senha alterada com sucesso.");
    activatePanel("login");
  } catch (exception) {
    error.textContent = exception.message;
    showLoginToast(exception.message);
  } finally {
    setSubmitting(submit, false);
  }
});

document.querySelector("#recoverForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.querySelector("#recoverError");
  const submit = form.querySelector(".yellow-action");
  error.textContent = "";
  setSubmitting(submit, true);

  try {
    const result = await api("/api/auth/forgot-password", {
      method: "POST",
      body: Object.fromEntries(new FormData(form).entries())
    });
    form.reset();
    showLoginToast(result.message || "Confira seu e-mail para continuar.");
  } catch (exception) {
    error.textContent = exception.message;
    showLoginToast(exception.message);
  } finally {
    setSubmitting(submit, false);
  }
});

document.querySelector("#resetForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.querySelector("#resetError");
  const data = Object.fromEntries(new FormData(form).entries());
  const submit = form.querySelector(".yellow-action");
  error.textContent = "";

  if (data.newPassword !== data.confirmPassword) {
    error.textContent = "As senhas precisam ser iguais.";
    showLoginToast(error.textContent);
    return;
  }
  if (!isStrongPassword(data.newPassword)) {
    error.textContent = "Use ao menos 12 caracteres, letras maiusculas, minusculas e numeros. Evite senhas comuns.";
    showLoginToast(error.textContent);
    return;
  }

  setSubmitting(submit, true);
  try {
    const result = await api("/api/auth/reset-password", {
      method: "POST",
      body: { accessToken: recoveryAccessToken(), newPassword: data.newPassword }
    });
    form.reset();
    history.replaceState({}, document.title, `${location.pathname}${location.search}`);
    showLoginToast(result.message || "Senha redefinida com sucesso.");
    activatePanel("login");
  } catch (exception) {
    error.textContent = exception.message;
    showLoginToast(exception.message);
  } finally {
    setSubmitting(submit, false);
  }
});

document.querySelector("#registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.querySelector("#registerError");
  const submit = form.querySelector(".yellow-action");
  const data = Object.fromEntries(new FormData(form).entries());
  error.textContent = "";

  if (data.password !== data.confirmPassword) {
    error.textContent = "As senhas precisam ser iguais.";
    showLoginToast(error.textContent);
    return;
  }
  if (!isStrongPassword(data.password)) {
    error.textContent = "Use ao menos 12 caracteres, letras maiusculas, minusculas e numeros. Evite senhas comuns.";
    showLoginToast(error.textContent);
    return;
  }

  setSubmitting(submit, true);
  try {
    const result = await api("/api/auth/register", {
      method: "POST",
      body: {
        name: data.name,
        email: data.email,
        password: data.password
      }
    });
    form.reset();
    showLoginToast(result.message || "Conta criada com sucesso. Entre usando seu e-mail e senha.");
    activatePanel("login");
  } catch (exception) {
    error.textContent = exception.message;
    showLoginToast(exception.message);
  } finally {
    setSubmitting(submit, false);
  }
});

document.querySelectorAll("[data-login-panel]").forEach((button) => {
  button.addEventListener("click", () => activatePanel(button.dataset.loginPanel));
});

if (recoveryAccessToken()) activatePanel("reset");

document.querySelectorAll("[data-toggle-password]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = button.parentElement?.querySelector("input");
    if (!input) return;
    const visible = input.type === "text";
    input.type = visible ? "password" : "text";
    button.textContent = visible ? "Ver" : "Ocultar";
    button.setAttribute("aria-label", visible ? "Mostrar senha" : "Ocultar senha");
  });
});

function activatePanel(panel) {
  document.querySelectorAll("[data-login-panel]").forEach((button) => {
    button.classList.toggle("active", button.dataset.loginPanel === panel);
  });
  document.querySelectorAll(".login-panel").forEach((form) => {
    form.classList.toggle("active", form.id === `${panel}Form`);
  });
  document.querySelectorAll(".login-error").forEach((error) => {
    error.textContent = "";
  });
}

function recoveryAccessToken() {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  return hash.get("access_token") || new URLSearchParams(location.search).get("access_token") || "";
}

function isStrongPassword(value) {
  return typeof value === "string"
    && value.length >= 12
    && /[a-z]/.test(value)
    && /[A-Z]/.test(value)
    && /\d/.test(value);
}

function showLoginToast(message) {
  const toast = document.querySelector("#loginToast");
  if (!toast) {
    alert(message);
    return;
  }
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(showLoginToast.timer);
  showLoginToast.timer = setTimeout(() => {
    toast.classList.remove("visible");
  }, 4200);
}

function setSubmitting(button, submitting) {
  if (!button.dataset.defaultText) button.dataset.defaultText = button.textContent;
  button.disabled = submitting;
  button.textContent = submitting ? "Aguarde..." : button.dataset.defaultText;
}

async function api(path, options = {}) {
  const method = options.method || "GET";
  const mutation = method !== "GET";
  if (mutation) window.senhaHubPwa?.markCriticalOperation(true);
  try {
    const response = await fetch(path, {
      method,
      headers: {
        "content-type": "application/json",
        ...csrfHeader()
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const payload = await parseApiPayload(response);
    window.senhaHubPwa?.reportNetworkSuccess();
    if (!response.ok || payload.error) throw new Error(payload.error || "Falha na API.");
    return payload;
  } catch (error) {
    window.senhaHubPwa?.reportNetworkFailure();
    throw error;
  } finally {
    if (mutation) window.senhaHubPwa?.markCriticalOperation(false);
  }
}

async function parseApiPayload(response) {
  const text = await response.text();
  if (!text.trim()) return response.ok ? { ok: true } : { error: "Falha na API." };
  try {
    return JSON.parse(text);
  } catch {
    return response.ok ? { ok: true, message: text } : { error: apiTextError(response, text) };
  }
}

function apiTextError(response, text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean && clean.length < 180 && !clean.startsWith("<")) return clean;
  return `Falha na comunicacao com a API (${response.status || "sem status"}). Tente novamente.`;
}

function csrfHeader() {
  const token = getCookie("senhahub_csrf");
  return token ? { "x-csrf-token": token } : {};
}

function getCookie(name) {
  return document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`))
    ?.slice(name.length + 1) || "";
}

function allowedNextForRole(role, next) {
  const home = {
    customer: "/",
    attendant: "/attendant",
    manager: "/",
    admin: "/"
  }[role] || "/";
  const normalizedRole = role === "admin" ? "manager" : role;
  if (!next) return home;
  if (normalizedRole === "manager" && ["/", "/totem"].includes(next)) return next;
  if (role === "attendant" && next === "/attendant") return next;
  if (role === "customer" && next === "/") return next;
  return home;
}
