# Chrome Web Store listing assets

Generated icons (run from `extension/`):

```powershell
python scripts/generate_icons.py
```

| File | Use |
|------|-----|
| `icons/icon128.png` | Extension package + store icon |
| `store-assets/store-icon-128.png` | Upload as **Store icon** (128×128) |
| `store-assets/store-icon-512.png` | High-res reference / marketing |

## Screenshots (required: at least 1, recommended 3–5)

Capture at **1280×800** (PNG or JPEG):

1. **After save** — extension popup showing article title + thread connection
2. **Connect flow** — popup on first run with “Connect to Briefly”
3. **Saved page** — sendbriefly.app/saved with the article listed

Save files here as `screenshot-1.png`, etc., for your own reference before upload.

## Promo tile (optional)

**Small promo tile:** 440×280 PNG — Briefly mark + “Save articles to your briefing” on brand background.

## Pre-submit checklist

- [ ] `manifest.store.json` copied to `manifest.json` (no localhost permissions)
- [ ] `briefly-extension-store.zip` built via `scripts/package-store.ps1`
- [ ] Icons show the gold **Briefly mark** (not a flat placeholder)
- [ ] Tested: connect → save article → connection feedback → add note
- [ ] Privacy policy URL live: https://www.sendbriefly.app/privacy
- [ ] `NEXT_PUBLIC_CHROME_EXTENSION_ID` ready to set in Vercel after approval
