const CACHE_NAME = "quiz-jogo-v2";
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./jogo-app.js",
  "./jogo-style.css",
  "./jogo-manifest.json",
  "./jogo-icon-192.png",
  "./jogo-icon-512.png",
  "../shared/theme.css",
  "../shared/firebase-config.js",
  "../shared/avatar.js",
  "../shared/scoring.js",
  "../shared/pdf-helpers.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

// network-first: tenta buscar na rede (dados sempre atualizados); se falhar
// (sem internet), cai pro que tiver salvo em cache — só pros arquivos do
// próprio site. Chamadas ao Firestore/Firebase não passam por aqui.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
