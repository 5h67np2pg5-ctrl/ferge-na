const CACHE_NAME = "ferge-na-v1";
const ASSETS = ["/", "/styles.css", "/app.js", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.url.includes("/api/")) return;

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
