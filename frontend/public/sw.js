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

/* ── Web Push ──────────────────────────────────────────────────────────────
 * Proactive notifications: relevant content, meeting prep, breaking updates. */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Briefly";
  const options = {
    body: data.body || "",
    icon: "/briefly-mark.svg",
    badge: "/briefly-mark.svg",
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    data: { url: data.url || "/dashboard" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/dashboard";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) {
            if ("navigate" in client) client.navigate(url);
            return client.focus();
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(url);
      }),
  );
});
