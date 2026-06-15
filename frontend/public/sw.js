/* Minimal service worker — required for PWA install + Web Share Target on Android.
 * Does not cache Next.js pages; capture API calls always hit the network. */
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/* A fetch handler must exist for the app to be installable on desktop Chrome/Edge.
 * Pure network passthrough — we deliberately don't cache app pages or API calls. */
self.addEventListener("fetch", () => {
  /* default browser handling */
});
