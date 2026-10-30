const PREFIX = "finance-pwa-" + new URL(self.registration.scope).pathname + "-";
const CACHE = PREFIX + __VERSION__;
const FILES = __FILES__.map(
  (path) => new URL(path, self.registration.scope).href,
);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
});
self.addEventListener("activate", (event) => {
  // Activate updates only after old windows close, so their hashed assets stay available.
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(PREFIX) && key !== CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (
    request.method !== "GET" ||
    !request.url.startsWith(self.registration.scope)
  )
    return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const key =
        request.mode === "navigate"
          ? new URL("index.html", self.registration.scope).href
          : request;
      return (await cache.match(key, { ignoreSearch: true })) ?? fetch(request);
    })(),
  );
});
