const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  evaluatePasswordPolicy,
  isCommonPassword,
  isStrongPassword
} = require("../server/password-policy");

const safePassword = "Azul!Mercado2026";

test("mantem a validacao minima de senha forte", () => {
  assert.equal(isStrongPassword(safePassword), true);
  assert.equal(isStrongPassword("senha-fraca"), false);
});

test("bloqueia senha comum sem consultar servico externo", async () => {
  const originalFetch = global.fetch;
  let called = false;
  global.fetch = async () => {
    called = true;
    return { status: 404, ok: false, text: async () => "" };
  };

  try {
    assert.equal(isCommonPassword("SenhaHub1234"), true);
    const result = await evaluatePasswordPolicy("SenhaHub1234", { endpoint: "https://hibp.test/range/" });
    assert.deepEqual(result, { ok: false, reason: "common" });
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("consulta somente o prefixo do hash e aceita senha nao encontrada", async () => {
  const originalFetch = global.fetch;
  let requestedUrl = "";
  global.fetch = async (url) => {
    requestedUrl = url;
    return { status: 404, ok: false, text: async () => "" };
  };

  try {
    const result = await evaluatePasswordPolicy(safePassword, { endpoint: "https://hibp.test/range/" });
    const digest = crypto.createHash("sha1").update(safePassword).digest("hex").toUpperCase();
    assert.deepEqual(result, { ok: true, pwnedCount: 0 });
    assert.equal(requestedUrl, `https://hibp.test/range/${digest.slice(0, 5)}`);
    assert.equal(requestedUrl.includes(digest.slice(5)), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("recusa senha encontrada no retorno do HIBP", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    const digest = crypto.createHash("sha1").update(safePassword).digest("hex").toUpperCase();
    return {
      status: 200,
      ok: true,
      text: async () => `${digest.slice(5)}:42\r\nOTHER:1\r\n`
    };
  };

  try {
    const result = await evaluatePasswordPolicy(safePassword, { endpoint: "https://hibp.test/range/" });
    assert.deepEqual(result, { ok: false, reason: "compromised", pwnedCount: 42 });
  } finally {
    global.fetch = originalFetch;
  }
});

test("falha fechado quando a consulta gratuita fica indisponivel", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error("offline");
  };

  try {
    const result = await evaluatePasswordPolicy(safePassword, { endpoint: "https://hibp.test/range/" });
    assert.deepEqual(result, { ok: false, reason: "unavailable" });
  } finally {
    global.fetch = originalFetch;
  }
});
