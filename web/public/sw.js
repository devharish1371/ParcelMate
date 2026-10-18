const CACHE_NAME = "parcelmate-shell-v1";
const SCOPE = self.registration.scope;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll([
        SCOPE,
        `${SCOPE}logo.svg`,
        `${SCOPE}manifest.webmanifest`,
        `${SCOPE}icons/icon-192.png`,
        `${SCOPE}icons/icon-512.png`,
    ]);
    const html = await (await cache.match(SCOPE)).text();
    const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)]
      .map((match) => new URL(match[1], SCOPE).href);
    await cache.addAll(assets);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("parcelmate-shell-") && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || !request.url.startsWith(SCOPE)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(SCOPE, copy)));
          }
          return response;
        })
        .catch(() => caches.match(SCOPE)),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
      }
      return response;
    })),
  );
});
