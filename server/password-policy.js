const crypto = require("node:crypto");

const HIBP_RANGE_URL = "https://api.pwnedpasswords.com/range/";
const HIBP_TIMEOUT_MS = 2500;

// Pequena lista local para bloquear escolhas previsíveis sem enviar a senha a lugar algum.
// A consulta HIBP abaixo continua sendo necessária para senhas comprometidas.
const COMMON_PASSWORDS = new Set([
  "123456789012",
  "1234567890",
  "12345678",
  "123456789",
  "password",
  "password123",
  "senha",
  "senha123",
  "senhahub",
  "senhahub123",
  "senhahub1234",
  "qwerty",
  "qwerty123",
  "qwertyuiop",
  "asdfghjkl",
  "abc123",
  "admin",
  "admin123",
  "letmein",
  "welcome",
  "welcome123",
  "supermercado",
  "supermercado123",
  "pompeia",
  "pompeia123"
]);

function isStrongPassword(password, minimum = 12) {
  return (
    typeof password === "string" &&
    password.length >= minimum &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password)
  );
}

function normalizeForCommonPasswordCheck(password) {
  return String(password || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s._-]+/g, "");
}

function isCommonPassword(password) {
  const normalized = normalizeForCommonPasswordCheck(password);
  if (COMMON_PASSWORDS.has(normalized)) return true;
  if (/^(.)\1{11,}$/u.test(normalized)) return true;
  return false;
}

async function evaluatePasswordPolicy(password, options = {}) {
  if (!isStrongPassword(password, options.minimum || 12)) {
    return { ok: false, reason: "weak" };
  }
  if (isCommonPassword(password)) {
    return { ok: false, reason: "common" };
  }

  const digest = crypto.createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const prefix = digest.slice(0, 5);
  const suffix = digest.slice(5);
  const endpoint = `${options.endpoint || process.env.HIBP_RANGE_URL || HIBP_RANGE_URL}${prefix}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || HIBP_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(endpoint, {
      headers: {
        "Add-Padding": "true",
        "User-Agent": "SenhaHub-password-policy"
      },
      signal: controller.signal,
      cache: "no-store"
    });
  } catch {
    return { ok: false, reason: "unavailable" };
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 404) return { ok: true, pwnedCount: 0 };
  if (!response.ok) return { ok: false, reason: "unavailable", status: response.status };

  const entries = (await response.text()).split(/\r?\n/);
  const match = entries.find((entry) => entry.slice(0, 35).toUpperCase() === suffix);
  const pwnedCount = match ? Number.parseInt(match.slice(36).trim(), 10) || 0 : 0;
  if (pwnedCount > 0) return { ok: false, reason: "compromised", pwnedCount };
  return { ok: true, pwnedCount: 0 };
}

function passwordPolicyError(result) {
  if (result?.ok) return {};
  if (result?.reason === "unavailable") {
    return {
      httpStatus: 503,
      error: "Nao foi possivel validar a seguranca da senha agora. Tente novamente em instantes."
    };
  }
  return {
    httpStatus: 400,
    error: "Escolha uma senha com ao menos 12 caracteres, letras maiusculas, minusculas e numeros, que nao seja comum ou exposta em vazamentos."
  };
}

module.exports = {
  evaluatePasswordPolicy,
  isCommonPassword,
  isStrongPassword,
  passwordPolicyError
};
