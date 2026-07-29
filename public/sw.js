importScripts("/pwa-utils.js", "/sw/config.js", "/sw/cache.js", "/sw/push.js");

self.addEventListener("install", (event) => {
  event.waitUntil(self.FilaZeroCache.precache());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    self.FilaZeroCache.removeOldCaches()
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (self.FilaZeroCache.isNetworkOnly(request, url)) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(self.FilaZeroCache.networkFirstNavigation(request));
    return;
  }

  if (self.FilaZeroCache.isHashedStatic(url)) {
    event.respondWith(self.FilaZeroCache.cacheFirst(request));
    return;
  }

  if (self.FilaZeroCache.isPublicVisualAsset(request, url)) {
    event.respondWith(self.FilaZeroCache.staleWhileRevalidate(request, event));
  }
});

self.addEventListener("push", (event) => {
  event.waitUntil(self.FilaZeroPush.handlePush(event));
});

self.addEventListener("notificationclick", (event) => {
  event.waitUntil(self.FilaZeroPush.handleNotificationClick(event));
});

self.addEventListener("notificationclose", (event) => {
  event.waitUntil(self.FilaZeroPush.handleNotificationClose(event));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    event.waitUntil(self.skipWaiting());
    return;
  }
  if (event.data?.type === "GET_VERSION") {
    event.source?.postMessage({
      type: "SERVICE_WORKER_VERSION",
      version: self.FZ_SW_CONFIG.version
    });
  }
});
