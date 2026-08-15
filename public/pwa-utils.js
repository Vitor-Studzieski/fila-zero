(function exposeSenhaHubPwaUtils(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SenhaHubPwaUtils = api;
})(typeof self !== "undefined" ? self : globalThis, function createSenhaHubPwaUtils() {
  const ALLOWED_NOTIFICATION_VIEWS = new Set(["status", "account"]);

  function urlBase64ToUint8Array(value) {
    const input = String(value || "").trim();
    if (!input || !/^[A-Za-z0-9_-]+$/.test(input)) throw new Error("Chave publica VAPID invalida.");
    const padding = "=".repeat((4 - (input.length % 4)) % 4);
    const base64 = (input + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    return Uint8Array.from(raw, (character) => character.charCodeAt(0));
  }

  function safeAppUrl(value, origin) {
    try {
      const base = new URL(origin);
      const target = new URL(String(value || "/"), base);
      if (target.origin !== base.origin || target.pathname !== "/") return null;
      const parameters = [...target.searchParams.keys()];
      if (parameters.some((key) => key !== "view")) return null;
      const view = target.searchParams.get("view");
      if (view && !ALLOWED_NOTIFICATION_VIEWS.has(view)) return null;
      target.hash = "";
      return target.href;
    } catch {
      return null;
    }
  }

  function isStandaloneDisplay(navigatorValue = globalThis.navigator, matchMediaValue = globalThis.matchMedia) {
    return Boolean(
      navigatorValue?.standalone === true
      || (typeof matchMediaValue === "function" && matchMediaValue("(display-mode: standalone)").matches)
    );
  }

  function classifyPlatform(userAgent = "", platform = "") {
    const value = `${userAgent} ${platform}`.toLowerCase();
    if (/iphone|ipad|ipod/.test(value)) return "ios";
    if (/android/.test(value)) return "android";
    if (/mac/.test(value)) return "macos";
    if (/win/.test(value)) return "windows";
    if (/linux/.test(value)) return "linux";
    return "unknown";
  }

  function deviceNameFor(platform, userAgent = "") {
    if (platform === "ios") return /ipad/i.test(userAgent) ? "iPad" : "iPhone";
    if (platform === "android") return "Dispositivo Android";
    if (platform === "macos") return "Mac";
    if (platform === "windows") return "Computador Windows";
    if (platform === "linux") return "Computador Linux";
    return "Navegador atual";
  }

  return {
    classifyPlatform,
    deviceNameFor,
    isStandaloneDisplay,
    safeAppUrl,
    urlBase64ToUint8Array
  };
});
