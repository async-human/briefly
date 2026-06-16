# Briefly Desktop — the floating voice orb

An always-on desktop companion: a small floating orb that lives in the corner of
your screen, launches on login, and supports **push-to-talk voice turns** against
the orb backend. Built with [Tauri v2](https://v2.tauri.app) — a
~5 MB native app with a tiny memory footprint (it sits idle all day, so that
matters).

Wake-word support is available with a native-worker-first design:
- preferred: local wake worker process (emits wake events to the app)
- fallback: web speech recognition beta
- always available: click-to-talk

To run the native worker in local dev, set:

```bash
BRIEFLY_WAKEWORD_EXE=python
BRIEFLY_WAKEWORD_ARGS="desktop/wake/openwakeword_worker.py"
```

```
desktop/
├── src/                 # the orb UI (static HTML/CSS/JS — no build step)
│   ├── index.html
│   ├── styles.css
│   └── orb.js           # orb animation + PTT capture + /orb/turn + /orb/speak
└── src-tauri/           # the native shell (Rust)
    ├── src/lib.rs       # tray menu, autostart, window positioning
    ├── tauri.conf.json  # frameless, transparent, always-on-top window
    └── capabilities/    # permissions (window, events, http to the API)
```

---

## Prerequisites

1. **Rust** — install via [rustup.rs](https://rustup.rs).
2. **Node 18+** — for the Tauri CLI.
3. **Platform webview**:
   - **Windows**: WebView2 (preinstalled on Windows 10/11).
   - **macOS**: nothing extra.
   - **Linux**: `webkit2gtk` + `libayatana-appindicator` (see Tauri's Linux setup).

## First run

```bash
cd desktop
npm install

# 1. Generate the app + tray icons (one-time). Reuses the Briefly logo.
npm run icons

# 2. Run it (hot-reloads the orb UI; rebuilds Rust on change)
npm run dev
```

On first launch the app:
- registers itself to **start on login**,
- drops a **tray icon** (bottom-right of the screen for the orb),
- starts **hidden** — open it from the tray, or it appears on its own for your
  first briefing of the day.

## Connect your account

The orb talks to your Briefly backend with the same token the web app uses.

1. Click the **gear** on the orb (hover to reveal the controls).
2. **API base** — `https://api.sendbriefly.app` (or `http://localhost:8000` for local dev).
3. **Device token** — create one in Briefly web app: **Settings → Connected devices**.
   Use a `desktop` token (`bcap_...`) and paste it into the orb settings.

> A cleaner one-click handoff (a `/desktop` page in the web app that deep-links
> the token straight into the orb) is the natural next step — noted in the
> roadmap below.

Hold the orb core to talk, then release to send. The orb transcribes with
`/orb/turn` and plays back with `/orb/speak`.

## How it behaves

| Action | Result |
|--------|--------|
| Left-click tray icon | Show / hide the orb |
| Right-click tray icon | Menu: Push-to-talk · Show/hide · Open Briefly · Quit |
| Hold orb core | Start listening |
| Release orb core | Send audio to `/orb/turn` |
| Press while speaking | Interrupt (barge-in) |
| Hover the orb | Reveals PTT / settings / hide controls |
| Drag the orb | Reposition it anywhere |

Audio synthesis now comes from backend `/orb/speak`, so desktop behavior matches
backend-selected TTS provider.

## Build a distributable

```bash
npm run build
```

Outputs installers under `src-tauri/target/release/bundle/` (`.msi`/`.exe` on
Windows, `.dmg` on macOS, `.AppImage`/`.deb` on Linux).

### Before you ship it to anyone

- **Code signing** — unsigned builds trigger "unknown publisher" warnings
  (Windows SmartScreen / macOS Gatekeeper). You'll want an Authenticode cert
  (Windows) and an Apple Developer ID + notarization (macOS).
- **Auto-update** — wire up the Tauri updater so users get new versions without
  reinstalling.

Neither is needed to run it yourself — only to distribute.

## Notes & next steps

- **Auth**: token-paste today; a `/desktop` deep-link handoff is the clean next step.
- **Briefing source**: `GET /api/v1/digests/today` + `/api/v1/me`. The CORS-free
  path is the Tauri HTTP plugin (configured in `capabilities/default.json` — add
  your production API origin there if it changes).
- **Heads-up**: this scaffold was written against the Tauri v2 spec but **not
  compiled in this environment** (no Rust toolchain here). Run `npm run dev`
  first; if the Rust side needs a tweak it'll surface there.
