# Publish Briefly to the Chrome Web Store

## Pre-flight (do this first)

1. **Regenerate icons** from the brand mark:
   ```powershell
   cd extension
   python scripts/generate_icons.py
   ```
2. **Load unpacked** once in Chrome and verify:
   - Popup branding (logo + tagline)
   - Connect → save article → connection feedback
   - “Already in Briefly” on duplicate URL
   - Error on `chrome://` pages (friendly message)
3. **Screenshots** — see `store-assets/README.md` (1280×800)

## Prerequisites

- [Chrome Web Store Developer account](https://chrome.google.com/webstore/devconsole) ($5 one-time)
- Latest backend deployed to Railway (`POST /api/v1/capture/url`)
- Latest frontend deployed to Vercel (`/extension/connect`, `/saved`)
- Privacy policy live: https://www.sendbriefly.app/privacy

## 1. Build the store package

From repo root (PowerShell):

```powershell
cd extension
Copy-Item manifest.store.json manifest.json -Force
.\scripts\package-store.ps1
```

This creates `briefly-extension-store.zip` (no localhost permissions).

For local dev again after packaging:

```powershell
git checkout manifest.json
```

## 2. Store listing copy

**Name:** Briefly — Feed your second brain

**Summary (132 chars max):**
Save articles to Briefly. See instantly what they connect to in your reading threads. Fed into tomorrow's briefing.

**Description:**
Briefly is your personal AI briefing agent. This extension lets you feed any article to your second brain with one click — not bookmark it for later.

When you save an article, Briefly:
- Scrapes and processes the full text
- Finds connections to your active reading threads
- Queues it for your next morning briefing

Optional: add a quick note about why it caught your eye.

Requires a free Briefly account at sendbriefly.app.

**Category:** Productivity

**Privacy policy:** https://www.sendbriefly.app/privacy

## 3. Permission justifications (required by Google)

| Permission | Why |
|------------|-----|
| `activeTab` | Read the current tab URL and title when you click Save |
| `storage` | Store your Briefly device token locally after you connect |
| `host_permissions` (api.sendbriefly.app) | Send captured URLs to your Briefly account |

## 4. Screenshots & store icon

- **Store icon:** upload `store-assets/store-icon-128.png` (128×128)
- **Screenshots:** 1280×800 — popup after save, connect screen, Saved page (see `store-assets/README.md`)

## 5. Upload & submit

1. [Developer Dashboard](https://chrome.google.com/webstore/devconsole) → **New item**
2. Upload `briefly-extension-store.zip`
3. Fill listing fields above
4. Submit for review (typically 1–3 business days)

## 6. After approval

Set **one** of these in Vercel (frontend) environment variables:

```
NEXT_PUBLIC_CHROME_EXTENSION_ID=abcdefghijklmnopqrstuvwxyzabcdef
```

or the full store URL:

```
NEXT_PUBLIC_CHROME_STORE_URL=https://chromewebstore.google.com/detail/briefly/abcdefghijklmnopqrstuvwxyzabcdef
```

The **Add to Chrome** button on the Saved page appears automatically. Users install from the store in one click — no “Load unpacked” or local files.

## Mobile note

Chrome extensions are desktop-first. Mobile users should use **Share → Briefly** (install the web app to home screen) or paste URLs on the Saved page — same backend, same experience.
