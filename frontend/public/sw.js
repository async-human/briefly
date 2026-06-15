/* Minimal service worker — required for PWA install + Web Share Target on Android.
 * Does not cache Next.js pages; capture API calls always hit the network. */
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
