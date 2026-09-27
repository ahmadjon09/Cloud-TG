/* Cloud service worker — offline shell + cached locales/assets.
   Version is injected by the server so a deploy refreshes every cache. */
const BUILD = "{{BUILD}}";
const CACHE = `cloud-${BUILD}`;
const SHELL = ["/app", "/offline", "/manifest.webmanifest", "/public/css/icons.css", "/public/fonts/fa-solid-900.woff2"];

self.addEventListener("install", event => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(cache => cache.addAll(SHELL).catch(() => null))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("cloud-") && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", event => {
  if (event.data === "skipWaiting") self.skipWaiting();
});

/** Never cache API responses — data must always be fresh. */
function isApi(url) {
  return url.pathname.startsWith("/api/") || url.pathname.startsWith("/health");
}

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (isApi(url)) return;

  // HTML: network first (so a new deploy is picked up), offline fallback
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match("/offline")))
    );
    return;
  }

  // CODE (js/css/json/manifest): network first — a stale icon() or el() would
  // break the whole UI, so always prefer fresh copies and only fall back to
  // cache when offline.
  if (/\.(js|mjs|css|json|webmanifest)$/i.test(url.pathname)) {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match("/offline")))
    );
    return;
  }

  // images/fonts/media: cache first (stable content, speed matters), refresh in background
  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req)
        .then(res => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
