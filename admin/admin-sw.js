const CACHE_NAME = "quiz-admin-v3";
const PRECACHE_URLS = [
  "./admin-manifest.json",
  "./admin-icon-192.png",
  "./admin-icon-512.png",
  "../shared/theme.css",
  "./admin-style.css",
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

// Código do app (.js, .html, .json) NUNCA fica em cache — vai sempre
// direto pra rede, sem intermediário. Um JS desatualizado pode importar
// funções que não existem mais e quebrar o app inteiro silenciosamente,
// então preferimos falhar (mostrando nosso próprio erro) a rodar código
// velho. Só ícones/CSS (puramente visuais) usam cache como reforço.
const NEVER_CACHE = [".js", ".html", ".json"];

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const isCode = NEVER_CACHE.some((ext) => url.pathname.endsWith(ext)) || event.request.mode === "navigate";
  if (isCode) {
    event.respondWith(fetch(event.request, { cache: "no-store" }));
    return;
  }

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
