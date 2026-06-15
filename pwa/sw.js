/* Minimal service worker — required for PWA installability + share_target.
 * Caches the app shell so the share handler opens instantly and works offline;
 * capture POSTs always go to the network. */
const CACHE = "briefly-pwa-v1";
const SHELL = [
  "./index.html",
  "./styles.css",
  "./app.js",
  "./config.js",
  "./manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Never cache API calls (captures, auth).
  if (req.method !== "GET" || new URL(req.url).pathname.includes("/api/")) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => cached || fetch(req))
  );
});
