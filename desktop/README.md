# Briefly Desktop — the floating voice orb

> 🟢 **REVIVED (2026-06-22) as the proactive-voice surface.** The desktop orb is
> the channel through which Briefly reaches out *first* by voice — see
> `project_proactive_direction` in project memory. This is a deliberate revival
> of the native-desktop track for proactive voice; it complements (does not
> replace) the in-app dashboard orb.

An always-on desktop companion: a small floating orb that lives in the corner of
your screen, launches on login, and:

- **Two-way voice** — push-to-talk / wake word / hotkey → `/orb/turn` (STT → Ask
  Briefly with its tools → answer) → spoken via `/orb/speak`. Ask it things and
  it performs grounded tasks, same brain as the web assistant.
- **Proactive voice** — when idle it polls `/orb/proactive/voice`; the backend
  applies the context gate (quiet hours / in a meeting / "afraid to miss") and,
  when something's worth it, the orb **speaks up on its own** (toggle on the orb).
- **Zero-setup auth** — the web app deep-links a desktop token via `briefly://`,
  registered by the app (single-instance forwards it to the running orb).

Built with [Tauri v2](https://v2.tauri.app) — a ~5 MB native app with a tiny
memory footprint (it sits idle all day, so that matters).

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

> **One-click handoff (now wired):** after web login, `ensureDesktopOrbLinked()`
> mints a `desktop` capture token and fires `briefly://auth?token=…&api_base=…`.
> The app registers the `briefly://` scheme (`tauri-plugin-deep-link`) and uses
> `tauri-plugin-single-instance` to forward the link into the running orb, so the
> token lands without any copy-paste. Manual paste (below) remains as a fallback.

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

## Verify it end-to-end (the runbook)

This needs a machine with **Rust** + the platform webview (above). The Rust layer
can't be compiled in CI without a toolchain, so do this once locally:

```bash
cd desktop
npm install
npm run icons          # one-time, generates app/tray icons
npm run dev            # compiles Rust, launches the floating orb
```

Then confirm each capability:

1. **Voice task** — click the orb (or say "hey briefly", or Ctrl+Shift+Space),
   ask something ("what's new today?"). It transcribes, answers, and speaks back.
2. **Proactive voice** — ensure the proactive button (the bars icon) is lit. With
   pending proactive events on your account (try `POST /api/v1/push/trigger-proactive`
   from the web app while logged in), the idle orb speaks up within ~90 s — unless
   the gate holds it (quiet hours / in a meeting).
3. **One-click auth** — log into the web app; it should deep-link the token into
   the orb automatically. If the browser blocks the scheme, paste a `bcap_` token
   from **Settings → Connected devices** (gear on the orb).
4. **Single instance** — relaunch the app; the existing orb focuses instead of a
   second one appearing.

## Ship it (distribution)

```bash
npm run build          # installers under src-tauri/target/release/bundle/
```

- **Code signing** — required to avoid SmartScreen/Gatekeeper warnings
  (Authenticode on Windows; Apple Developer ID + notarization on macOS).
- **Auto-update** — wire the Tauri updater so users get new versions in place.
- **Deep link in production** — the installer registers `briefly://` at install
  time; in dev it's registered at runtime by `register_all()` (Windows/Linux).

## Notes

- **Briefing source**: `GET /api/v1/digests/today` + `/api/v1/me`. The CORS-free
  path is the Tauri HTTP plugin (`capabilities/default.json` — add your production
  API origin there if it changes).
- **Heads-up**: the Rust changes for deep-link + single-instance were written to
  the Tauri v2 spec but **compiled-checked is on you** — there's no Rust toolchain
  in the authoring environment. `npm run dev` will surface any tweak needed; the
  most likely spots are plugin version pins in `Cargo.toml`.
