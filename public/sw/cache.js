(function exposeFilaZeroCache(scope) {
  const config = scope.FZ_SW_CONFIG;

  function isNetworkOnly(request, url) {
    if (request.method !== "GET") return true;
    if (request.headers.has("authorization")) return true;
    if (url.origin !== scope.location.origin) return true;
    return (
      url.pathname.startsWith("/api/")
      || url.pathname === "/login"
      || url.pathname.startsWith("/login/")
      || url.pathname === "/sw.js"
      || url.pathname.startsWith("/sw/")
    );
  }

  function isHashedStatic(url) {
    return url.origin === scope.location.origin && url.pathname.startsWith("/_next/static/");
  }

  function isPublicVisualAsset(request, url) {
    if (url.origin !== scope.location.origin) return false;
    return (
      url.pathname.startsWith("/assets/")
      || url.pathname.startsWith("/icons/")
      || url.pathname.startsWith("/data/")
      || ["/styles.css", "/pwa.css", "/app.js", "/admin.js", "/attendant.js", "/login.js", "/pwa.js", "/pwa-utils.js"].includes(url.pathname)
      || ["image", "style", "font"].includes(request.destination)
    );
  }

  function canStore(response) {
    if (!response || !response.ok || response.type === "opaque") return false;
    const cacheControl = String(response.headers.get("cache-control") || "").toLowerCase();
    if (cacheControl.includes("no-store") || cacheControl.includes("private")) return false;
    return !response.headers.has("set-cookie");
  }

  async function trimCache(cacheName, maximumEntries) {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    const removals = keys.slice(0, Math.max(0, keys.length - maximumEntries));
    await Promise.all(removals.map((key) => cache.delete(key)));
  }

  async function cacheFirst(request) {
    const cache = await caches.open(config.staticCacheName);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (canStore(response)) {
      await cache.put(request, response.clone());
      await trimCache(config.staticCacheName, config.maxStaticEntries);
    }
    return response;
  }

  async function staleWhileRevalidate(request, event) {
    const cache = await caches.open(config.visualCacheName);
    const cached = await cache.match(request);
    const network = fetch(request)
      .then(async (response) => {
        if (canStore(response)) {
          await cache.put(request, response.clone());
          await trimCache(config.visualCacheName, config.maxVisualEntries);
        }
        return response;
      })
      .catch(() => null);
    if (cached) {
      event.waitUntil(network);
      return cached;
    }
    return (await network) || Response.error();
  }

  async function networkFirstNavigation(request) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.navigationTimeoutMs);
    try {
      return await fetch(request, {
        signal: controller.signal,
        cache: "no-store"
      });
    } catch {
      return (await caches.match(config.offlineUrl, { cacheName: config.precacheName })) || Response.error();
    } finally {
      clearTimeout(timer);
    }
  }

  async function precache() {
    const cache = await caches.open(config.precacheName);
    await cache.addAll(config.precacheUrls);
  }

  async function removeOldCaches() {
    const current = new Set([config.precacheName, config.staticCacheName, config.visualCacheName]);
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith(`${config.cachePrefix}-`) && !current.has(name))
        .map((name) => caches.delete(name))
    );
  }

  scope.FilaZeroCache = {
    cacheFirst,
    isHashedStatic,
    isNetworkOnly,
    isPublicVisualAsset,
    networkFirstNavigation,
    precache,
    removeOldCaches,
    staleWhileRevalidate
  };
})(self);
