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
    data: {
      url: data.url || "/dashboard",
      voice: Boolean(data.voice),
      voiceUrl: data.voiceUrl || "/api/v1/proactive/voice",
    },
  };

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options);
      // Jarvis-style outreach: if a window is already open, ask it to speak now
      // (it has the audio context + any prior user gesture). Otherwise the spoken
      // briefing plays after the user clicks the notification (see below).
      if (data.voice) {
        const clientList = await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        });
        for (const client of clientList) {
          client.postMessage({
            type: "briefly-voice",
            voiceUrl: options.data.voiceUrl,
          });
        }
      }
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const nd = event.notification.data || {};
  let url = nd.url || "/dashboard";
  // The click is a user gesture — let the destination page autoplay the briefing.
  if (nd.voice) {
    url += (url.includes("?") ? "&" : "?") + "briefly_voice=1";
  }
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
