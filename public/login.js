document.querySelector("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.querySelector("#loginError");
  const submit = form.querySelector("button");
  error.textContent = "";
  submit.disabled = true;

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
    submit.disabled = false;
  }
});

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

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: {
      "content-type": "application/json",
      ...csrfHeader()
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({ error: "Backend indisponivel." }));
  if (!response.ok || payload.error) throw new Error(payload.error || "Falha na API.");
  return payload;
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
