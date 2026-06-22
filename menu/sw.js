/* ===========================================================================
 * Service Worker · El Sanatorio QR menus
 * ---------------------------------------------------------------------------
 * Caches the three QR menu HTML pages + CSS/JS so they work even when the
 * venue Wi-Fi drops. Best-effort cache; never blocks navigation.
 * =========================================================================== */
const CACHE = "qr-menu-2026-06-21";
const ASSETS = [
  "/menu/",
  "/menu/chuzo",
  "/menu/chuzo/",
  "/menu/bar",
  "/menu/bar/",
  "/menu/tickets",
  "/menu/tickets/",
  "/css/qr-menu.css",
  "/js/qr-menu.js",
  "/favicon.svg",
  "/images/sanatorio-yakitori-night.webp",
  "/images/sanatorio-cocktails.webp",
  "/images/sanatorio-admisiones.webp"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS).catch(() => null)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Only handle GET requests on our origin
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  // Network-first for HTML so we get fresh menu copy; cache fallback if offline
  if (event.request.headers.get("accept")?.includes("text/html")) {
    event.respondWith(
      fetch(event.request).then((res) => {
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, clone)).catch(() => null);
        return res;
      }).catch(() => caches.match(event.request).then((r) => r || caches.match("/menu/")))
    );
    return;
  }
  // Cache-first for static assets
  event.respondWith(
    caches.match(event.request).then((cached) =>
      cached || fetch(event.request).then((res) => {
        if (res.ok && (url.pathname.startsWith("/css/") || url.pathname.startsWith("/js/") || url.pathname.startsWith("/images/"))) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, clone)).catch(() => null);
        }
        return res;
      })
    )
  );
});
