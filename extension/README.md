# Briefly Browser Extension

Feed articles to your second brain — not a bookmark pile.

## Production URLs (defaults in `config.js`)

| Setting | URL |
|---------|-----|
| API | `https://api.sendbriefly.app` |
| Web app | `https://www.sendbriefly.app` |
| Connect page | `https://www.sendbriefly.app/extension/connect` |

## Quick test (production)

1. **Deploy** latest backend (Railway) and frontend (Vercel) — capture API + `/extension/connect` must be live
2. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → select this `extension/` folder
3. Click the Briefly icon → **Connect to Briefly** → sign in at sendbriefly.app if prompted
4. Open any article (e.g. a blog post or news story)
5. Click the Briefly icon again → popup should show connection feedback within ~10s

## Local dev

Override URLs in the extension service worker console:

```js
chrome.storage.local.set({
  apiUrl: "http://localhost:8000",
  frontendUrl: "http://localhost:3000",
});
```

Then reload the extension. `manifest.json` still allows localhost host permissions.

Clear overrides:

```js
chrome.storage.local.remove(["apiUrl", "frontendUrl"]);
```

## API

- `POST /api/v1/capture/url` — `{ url, title?, note? }` → scrape + enrich + connection feedback
- Auth: `Authorization: Bearer <bcap_ device token>` (minted on connect) or session JWT

Connect flow creates a long-lived **device token** (`bcap_…`) so the extension keeps working without re-login.

## Icons

```bash
python extension/scripts/generate_icons.py
```
