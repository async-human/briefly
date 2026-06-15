# Save to Briefly — PWA share target

A dependency-free Progressive Web App that gives users the **"Save to Briefly"**
experience on both desktop and Android from a single codebase:

- **Android:** install once ("Add to Home screen") and Briefly appears in the
  native **share sheet** — share any link from any app → Briefly.
- **Desktop (Chrome/Edge):** installable app; also a place to paste a link to
  save. (Desktop power users will mostly use the browser extension in `../extension`.)

Every client — this PWA, the browser extension, the iOS Shortcut below — posts the
same `POST /api/v1/capture/url` with a **capture device token** (`bcap_…`), so the
backend path (scrape → pool → embed → enrich → next briefing) is shared.

## How it works

1. User mints a **device token** in Briefly → Settings → Connected devices.
2. They open this PWA once and paste the token (stored in `localStorage` only).
3. Sharing a link opens `index.html` via the [Web Share Target API](https://developer.mozilla.org/en-US/docs/Web/Manifest/share_target)
   with the URL as a query param; `app.js` POSTs it to `/capture/url`.

## Deploy

Static files — host anywhere over **HTTPS** (required for PWAs and service workers),
e.g. `https://save.sendbriefly.app`. On Vercel, drop this folder as a static project.

Set the backend/frontend URLs in `config.js` before deploying.

## Platform coverage

| Platform | Share-sheet "Save to Briefly" | Mechanism |
|----------|-------------------------------|-----------|
| Android (Chrome) | ✅ | This PWA (Web Share Target) |
| Desktop (Chrome/Edge) | ✅ installable app + extension | This PWA + `../extension` |
| iOS / iPadOS | ⚠️ not via PWA | **iOS Shortcut** (below) — Safari doesn't support Web Share Target |

## iOS: ship a Shortcut (covers the iOS share sheet today)

iOS Safari can't be a Web Share Target, so for iOS publish a **Shortcut** users add once.
It appears in the system Share sheet as "Save to Briefly". The Shortcut:

1. Accepts **URLs** (and Safari web pages) as input → *Shortcut input*.
2. **Text** action holding the user's device token (`bcap_…`).
3. **Get Contents of URL**:
   - URL: `https://api.sendbriefly.app/api/v1/capture/url`
   - Method: `POST`
   - Headers: `Authorization: Bearer <token>`, `Content-Type: application/json`
   - Request Body (JSON): `{ "url": <Shortcut Input> }`
4. Optional: **Show Notification** with the response title.

In Shortcut settings enable **"Show in Share Sheet"** and accept *URLs / Safari web pages*.
Distribute via an iCloud Shortcut link. A native iOS **Share Extension** app (App Store)
is the Phase-2 upgrade for a fully branded experience.

## Icons

`icons/icon-192.png` and `icons/icon-512.png` are simple generated placeholders —
replace with branded assets before launch.
