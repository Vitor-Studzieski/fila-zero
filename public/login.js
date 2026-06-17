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
  document.querySelector("#loginForm").classList.toggle("active", panel === "login");
  document.querySelector("#registerForm").classList.toggle("active", panel === "register");
  document.querySelector("#passwordForm").classList.toggle("active", panel === "password");
  document.querySelector("#loginError").textContent = "";
  document.querySelector("#registerError").textContent = "";
  document.querySelector("#passwordError").textContent = "";
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
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: {
      "content-type": "application/json",
      ...csrfHeader()
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await parseApiPayload(response);
  if (!response.ok || payload.error) throw new Error(payload.error || "Falha na API.");
  return payload;
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
  const token = getCookie("fz_csrf");
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
  if (normalizedRole === "manager") return "/";
  if (role === "attendant" && next === "/attendant") return next;
  if (role === "customer" && next === "/") return next;
  return home;
}
