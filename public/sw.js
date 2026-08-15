importScripts("/pwa-utils.js", "/sw/config.js", "/sw/cache.js", "/sw/push.js");

self.addEventListener("install", (event) => {
  event.waitUntil(self.SenhaHubCache.precache());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    self.SenhaHubCache.removeOldCaches()
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (self.SenhaHubCache.isNetworkOnly(request, url)) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(self.SenhaHubCache.networkFirstNavigation(request));
    return;
  }

  if (self.SenhaHubCache.isHashedStatic(url)) {
    event.respondWith(self.SenhaHubCache.cacheFirst(request));
    return;
  }

  if (self.SenhaHubCache.isPublicVisualAsset(request, url)) {
    event.respondWith(self.SenhaHubCache.staleWhileRevalidate(request, event));
  }
});

self.addEventListener("push", (event) => {
  event.waitUntil(self.SenhaHubPush.handlePush(event));
});

self.addEventListener("notificationclick", (event) => {
  event.waitUntil(self.SenhaHubPush.handleNotificationClick(event));
});

self.addEventListener("notificationclose", (event) => {
  event.waitUntil(self.SenhaHubPush.handleNotificationClose(event));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    event.waitUntil(self.skipWaiting());
    return;
  }
  if (event.data?.type === "GET_VERSION") {
    event.source?.postMessage({
      type: "SERVICE_WORKER_VERSION",
      version: self.SENHAHUB_SW_CONFIG.version
    });
  }
});
