"use strict";

// Tauri globals (present when running inside the desktop app; absent in a plain
// browser, where we fall back gracefully for dev/preview).
const TAURI = window.__TAURI__ || null;

// ── Persistent settings ────────────────────────────────────────────────────
const store = {
  get apiBase() {
    return (localStorage.getItem("briefly.apiBase") || "https://api.sendbriefly.app").replace(/\/$/, "");
  },
  set apiBase(v) {
    localStorage.setItem("briefly.apiBase", v);
  },
  get token() {
    return localStorage.getItem("briefly.token") || "";
  },
  set token(v) {
    localStorage.setItem("briefly.token", v);
  },
  get wakeEnabled() {
    return localStorage.getItem("briefly.wakeEnabled") !== "0";
  },
  set wakeEnabled(v) {
    localStorage.setItem("briefly.wakeEnabled", v ? "1" : "0");
  },
  get wakeMuted() {
    return localStorage.getItem("briefly.wakeMuted") === "1";
  },
  set wakeMuted(v) {
    localStorage.setItem("briefly.wakeMuted", v ? "1" : "0");
  },
};

const state = {
  mode: "idle", // idle | listening | thinking | speaking
  mediaRecorder: null,
  audioChunks: [],
  micStream: null,
  listeningStartedAt: 0,
  turnAbort: null,
  speakAbort: null,
  ttsAudio: null,
  wakeRecognizer: null,
  wakeRestartTimer: null,
  wakeBackend: "none",
  wakeEventUnlisten: null,
};

// ── Window helpers (Tauri) ──────────────────────────────────────────────────
async function showWindow() {
  try {
    if (TAURI?.window) {
      const w = TAURI.window.getCurrentWindow();
      await w.show();
      await w.setFocus();
    }
  } catch (_) {}
}

async function hideWindow() {
  try {
    if (TAURI?.window) await TAURI.window.getCurrentWindow().hide();
  } catch (_) {}
}

// ── API ─────────────────────────────────────────────────────────────────────
async function apiGet(path) {
  const url = store.apiBase + path;
  const headers = { Authorization: "Bearer " + store.token };
  const doFetch = TAURI?.http?.fetch || window.fetch;
  const res = await doFetch(url, { method: "GET", headers });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return await res.json();
}

async function apiTurn(audioBlob, signal) {
  const form = new FormData();
  form.append("audio", audioBlob, "turn.webm");
  const doFetch = TAURI?.http?.fetch || window.fetch;
  const res = await doFetch(store.apiBase + "/api/v1/orb/turn", {
    method: "POST",
    headers: { Authorization: "Bearer " + store.token },
    body: form,
    signal,
  });
  if (!res.ok) throw new Error("Turn failed: HTTP " + res.status);
  return await res.json();
}

async function apiTurnText(text, signal) {
  const form = new FormData();
  form.append("text", text);
  const doFetch = TAURI?.http?.fetch || window.fetch;
  const res = await doFetch(store.apiBase + "/api/v1/orb/turn", {
    method: "POST",
    headers: { Authorization: "Bearer " + store.token },
    body: form,
    signal,
  });
  if (!res.ok) throw new Error("Turn failed: HTTP " + res.status);
  return await res.json();
}

async function apiSpeakToBlob(text, signal) {
  const doFetch = TAURI?.http?.fetch || window.fetch;
  const res = await doFetch(store.apiBase + "/api/v1/orb/speak", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + store.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!res.ok) throw new Error("Speak failed: HTTP " + res.status);
  return await res.blob();
}

function setMode(mode) {
  state.mode = mode;
  document.body.dataset.mode = mode;
  document.body.classList.toggle("is-speaking", mode === "speaking");
  const chip = document.getElementById("modeChip");
  if (chip) {
    chip.textContent =
      mode === "listening" ? "Listening" :
      mode === "thinking" ? "Thinking" :
      mode === "speaking" ? "Speaking" :
      "Idle";
  }
  energyTarget =
    mode === "listening" ? 0.86 :
    mode === "thinking" ? 0.46 :
    mode === "speaking" ? 0.68 :
    0.08;
}

function wakeStatusEl() {
  return document.getElementById("wakeStatus");
}

function updateWakeStatus() {
  const el = wakeStatusEl();
  if (!el) return;
  if (!store.wakeEnabled) {
    el.textContent = "Wake word off";
  } else if (store.wakeMuted) {
    el.textContent = "Wake word muted";
  } else if (state.wakeBackend === "native") {
    el.textContent = 'Wake word local: "hey briefly"';
  } else if (state.wakeBackend === "web") {
    el.textContent = 'Wake word beta: "hey briefly"';
  } else {
    el.textContent = "Wake word unavailable";
  }
  const wakeBtn = document.getElementById("wake");
  if (wakeBtn) {
    wakeBtn.classList.toggle("active", store.wakeEnabled && !store.wakeMuted);
    wakeBtn.title = store.wakeMuted ? "Unmute wake word" : "Mute wake word";
  }
}

function stopSpeaking() {
  if (state.speakAbort) {
    state.speakAbort.abort();
    state.speakAbort = null;
  }
  if (state.ttsAudio) {
    try {
      state.ttsAudio.pause();
      state.ttsAudio.currentTime = 0;
    } catch (_) {}
    state.ttsAudio = null;
  }
  setMode("idle");
}

function stopListening() {
  const rec = state.mediaRecorder;
  if (!rec) return;
  if (rec.state !== "inactive") rec.stop();
  state.mediaRecorder = null;
}

function stopCurrentTurn() {
  if (state.turnAbort) {
    state.turnAbort.abort();
    state.turnAbort = null;
  }
  if (state.speakAbort) {
    state.speakAbort.abort();
    state.speakAbort = null;
  }
  stopListening();
  stopSpeaking();
  setCaption("");
}

function normalizeTranscript(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function transcriptMatchesWakePhrase(text) {
  const norm = normalizeTranscript(text);
  return norm.includes("hey briefly") || norm.includes("hi briefly");
}

async function ensureMic() {
  if (state.micStream) return state.micStream;
  state.micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  return state.micStream;
}

function chooseMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const candidate of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return "";
}

async function startListening() {
  if (!store.token) {
    setCaption("Add a device token in settings first.");
    openSettings(true);
    return;
  }
  if (state.mode === "listening") return;
  stopCurrentTurn();
  await showWindow();
  setCaption("Listening… click again to send");
  setMode("listening");
  state.audioChunks = [];
  state.listeningStartedAt = Date.now();

  try {
    const stream = await ensureMic();
    const opts = {};
    const mimeType = chooseMimeType();
    if (mimeType) opts.mimeType = mimeType;
    const recorder = new MediaRecorder(stream, opts);
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) state.audioChunks.push(e.data);
    };
    recorder.start();
    state.mediaRecorder = recorder;
  } catch (_) {
    setMode("idle");
    setCaption("Microphone access was blocked.");
  }
}

async function stopListeningAndSend() {
  if (state.mode !== "listening") return;
  const recorder = state.mediaRecorder;
  const elapsed = Date.now() - state.listeningStartedAt;
  if (!recorder) {
    setMode("idle");
    return;
  }
  const blob = await new Promise((resolve) => {
    recorder.onstop = () => resolve(new Blob(state.audioChunks, { type: recorder.mimeType || "audio/webm" }));
    recorder.stop();
  });
  state.mediaRecorder = null;

  if (elapsed < 120 || !blob || blob.size === 0) {
    setMode("idle");
    setCaption("Click the orb and start talking.");
    setTimeout(() => setCaption(""), 1200);
    return;
  }

  await executeTurn(async (signal) => apiTurn(blob, signal));
}

async function executeTurn(turnFactory) {
  setMode("thinking");
  setCaption("Thinking…");
  const turnAbort = new AbortController();
  state.turnAbort = turnAbort;
  try {
    const turn = await turnFactory(turnAbort.signal);
    state.turnAbort = null;
    const answer = (turn && turn.answer ? String(turn.answer) : "").trim();
    if (!answer) throw new Error("No answer");
    const trace = Array.isArray(turn?.tool_trace) ? turn.tool_trace : [];
    if (trace.length) {
      const names = trace.map((t) => String(t.tool || "")).filter(Boolean).join(" + ");
      const ws = wakeStatusEl();
      if (ws && names) ws.textContent = `Mode: ${names}`;
    }
    setCaption(answer);
    await playTts(answer);
  } catch (err) {
    if (turnAbort.signal.aborted) return;
    setMode("idle");
    setCaption(err instanceof Error ? err.message : "Turn failed.");
    setTimeout(() => setCaption(""), 3000);
  }
}

async function playTts(text) {
  const speakAbort = new AbortController();
  state.speakAbort = speakAbort;
  setMode("speaking");
  const audioBlob = await apiSpeakToBlob(text, speakAbort.signal);
  if (speakAbort.signal.aborted) return;
  const url = URL.createObjectURL(audioBlob);
  await new Promise((resolve) => {
    const audio = new Audio(url);
    state.ttsAudio = audio;
    audio.onended = resolve;
    audio.onerror = resolve;
    audio.play().catch(() => resolve());
  });
  URL.revokeObjectURL(url);
  if (!speakAbort.signal.aborted) {
    setMode("idle");
  }
  state.speakAbort = null;
  state.ttsAudio = null;
}

function toggleTalk() {
  if (state.mode === "speaking" || state.mode === "thinking") {
    stopCurrentTurn();
    setCaption("Interrupted");
    setTimeout(() => setCaption(""), 900);
    return;
  }
  if (state.mode === "listening") {
    void stopListeningAndSend();
    return;
  }
  void startListening();
}

function handleDesktopAuth(payload) {
  const token = payload && payload.token ? String(payload.token).trim() : "";
  const apiBase = payload && payload.api_base ? String(payload.api_base).trim().replace(/\/$/, "") : "";
  if (!token) return;
  if (apiBase) store.apiBase = apiBase;
  store.token = token;
  openSettings(false);
  setCaption("Desktop orb linked. Click to talk.");
  setTimeout(() => setCaption(""), 2500);
}

async function registerGlobalHotkey() {
  if (!TAURI?.globalShortcut) return;
  try {
    await TAURI.globalShortcut.unregisterAll();
    await TAURI.globalShortcut.register("Ctrl+Shift+Space", () => {
      toggleTalk();
    });
    setCaption("Hotkey ready: Ctrl+Shift+Space");
    setTimeout(() => setCaption(""), 1200);
  } catch (_) {}
}

function stopWakeWord() {
  if (state.wakeEventUnlisten) {
    try { state.wakeEventUnlisten(); } catch (_) {}
    state.wakeEventUnlisten = null;
  }
  if (state.wakeRestartTimer) {
    clearTimeout(state.wakeRestartTimer);
    state.wakeRestartTimer = null;
  }
  if (state.wakeRecognizer) {
    try {
      state.wakeRecognizer.onresult = null;
      state.wakeRecognizer.onend = null;
      state.wakeRecognizer.onerror = null;
      state.wakeRecognizer.stop();
    } catch (_) {}
  }
  state.wakeRecognizer = null;
  if (state.wakeBackend === "native" && TAURI?.core?.invoke) {
    TAURI.core.invoke("wakeword_stop").catch(() => {});
  }
  state.wakeBackend = "none";
}

function startWebWakeWord() {
  state.wakeBackend = "none";
  stopWakeWord();
  if (!store.wakeEnabled || store.wakeMuted) {
    updateWakeStatus();
    return;
  }
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    updateWakeStatus();
    return;
  }
  const rec = new SpeechRec();
  rec.lang = "en-US";
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.onresult = (event) => {
    if (state.mode !== "idle") return;
    let transcript = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0]?.transcript || "";
    }
    if (!transcriptMatchesWakePhrase(transcript)) return;
    setCaption("Wake word heard.");
    setTimeout(() => setCaption(""), 1000);
    toggleTalk();
  };
  rec.onerror = () => {
    state.wakeRestartTimer = setTimeout(() => startWakeWord(), 1500);
  };
  rec.onend = () => {
    state.wakeRestartTimer = setTimeout(() => startWakeWord(), 500);
  };
  try {
    rec.start();
    state.wakeRecognizer = rec;
    state.wakeBackend = "web";
  } catch (_) {
    state.wakeRecognizer = null;
    state.wakeBackend = "none";
  }
  updateWakeStatus();
}

async function startWakeWord() {
  stopWakeWord();
  if (!store.wakeEnabled || store.wakeMuted) {
    updateWakeStatus();
    return;
  }
  if (TAURI?.core?.invoke) {
    try {
      const out = await TAURI.core.invoke("wakeword_start");
      if (out && out.active) {
        state.wakeBackend = "native";
        if (TAURI?.event) {
          state.wakeEventUnlisten = await TAURI.event.listen("wake-detected", () => {
            if (state.mode !== "idle") return;
            setCaption("Wake word heard.");
            setTimeout(() => setCaption(""), 1000);
            toggleTalk();
          });
        }
        updateWakeStatus();
        return;
      }
    } catch (_) {}
  }
  startWebWakeWord();
}

// ── Caption ─────────────────────────────────────────────────────────────────
const captionEl = () => document.getElementById("caption");
function setCaption(text) {
  const el = captionEl();
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("show", !!text);
}

// ── Orb animation ───────────────────────────────────────────────────────────
let energy = 0.06; // smoothed current energy
let energyTarget = 0.06; // idle baseline
function bumpEnergy() {
  energy = Math.min(1, energy + 0.22);
}

function initOrb() {
  const canvas = document.getElementById("orb");
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const SIZE = 180;
  canvas.width = SIZE * dpr;
  canvas.height = SIZE * dpr;
  ctx.scale(dpr, dpr);

  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const hue = 275;

  function draw(t) {
    // Ease current energy toward target; add gentle idle breathing.
    energy += (energyTarget - energy) * 0.08;
    const breathe = 0.5 + 0.5 * Math.sin(t / 1400);
    const e = Math.min(1, energy + breathe * 0.04);
    if (state.mode === "listening" || state.mode === "speaking") bumpEnergy();

    ctx.clearRect(0, 0, SIZE, SIZE);

    // Outer glow
    const glowR = 46 + e * 34;
    const glow = ctx.createRadialGradient(cx, cy, 8, cx, cy, glowR);
    glow.addColorStop(0, `oklch(62% 0.19 ${hue} / ${0.32 + e * 0.4})`);
    glow.addColorStop(0.6, `oklch(58% 0.18 ${hue} / ${0.1 + e * 0.16})`);
    glow.addColorStop(1, `oklch(58% 0.18 ${hue} / 0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
    ctx.fill();

    // Rotating rings
    const rings = [
      { r: 40, w: 1.4, speed: 0.00018, span: 1.7, alpha: 0.55 },
      { r: 50, w: 1.1, speed: -0.00012, span: 1.2, alpha: 0.4 },
      { r: 60, w: 0.9, speed: 0.00009, span: 2.3, alpha: 0.28 },
    ];
    for (const ring of rings) {
      const wobble = 1 + e * 0.12 * Math.sin(t / 500 + ring.r);
      const start = t * ring.speed * (1 + e * 2);
      ctx.beginPath();
      ctx.strokeStyle = `oklch(72% 0.16 ${hue} / ${ring.alpha + e * 0.3})`;
      ctx.lineWidth = ring.w + e * 0.8;
      ctx.lineCap = "round";
      ctx.arc(cx, cy, ring.r * wobble, start, start + ring.span);
      ctx.stroke();
    }

    // Core
    const coreR = 22 + e * 12;
    const core = ctx.createRadialGradient(cx - coreR * 0.3, cy - coreR * 0.3, 2, cx, cy, coreR);
    core.addColorStop(0, `oklch(86% 0.1 ${hue})`);
    core.addColorStop(0.5, `oklch(64% 0.2 ${hue})`);
    core.addColorStop(1, `oklch(48% 0.18 ${hue})`);
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
    ctx.fill();

    // Orbiting motes
    const motes = 5;
    for (let i = 0; i < motes; i++) {
      const a = t * 0.0004 * (i % 2 ? -1 : 1) + (i / motes) * Math.PI * 2;
      const rr = 34 + i * 4 + e * 10 * Math.sin(t / 600 + i);
      const mx = cx + Math.cos(a) * rr;
      const my = cy + Math.sin(a) * rr;
      ctx.beginPath();
      ctx.fillStyle = `oklch(82% 0.14 ${hue} / ${0.35 + e * 0.5})`;
      ctx.arc(mx, my, 1.3 + e * 1.2, 0, Math.PI * 2);
      ctx.fill();
    }

    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
}

// ── Settings panel ──────────────────────────────────────────────────────────
function openSettings(open) {
  const panel = document.getElementById("settings");
  if (!panel) return;
  const willOpen = open ?? panel.classList.contains("hidden");
  if (willOpen) {
    document.getElementById("apiBase").value = store.apiBase;
    document.getElementById("token").value = store.token;
    panel.classList.remove("hidden");
  } else {
    panel.classList.add("hidden");
  }
}

// ── Wire-up ─────────────────────────────────────────────────────────────────
function init() {
  initOrb();
  setMode("idle");

  document.getElementById("orb-hit").addEventListener("click", (e) => {
    e.preventDefault();
    toggleTalk();
  });
  document.getElementById("replay").addEventListener("click", () => toggleTalk());
  document.getElementById("wake").addEventListener("click", () => {
    store.wakeMuted = !store.wakeMuted;
    if (store.wakeMuted) {
      stopWakeWord();
    } else {
      void startWakeWord();
    }
    updateWakeStatus();
  });
  document.getElementById("gear").addEventListener("click", () => openSettings());
  document.getElementById("hide").addEventListener("click", () => {
    stopCurrentTurn();
    hideWindow();
  });
  document.getElementById("save").addEventListener("click", () => {
    store.apiBase = document.getElementById("apiBase").value.trim();
    store.token = document.getElementById("token").value.trim();
    openSettings(false);
    setCaption("Saved. Click orb to talk.");
    setTimeout(() => setCaption(""), 3500);
  });
  document.getElementById("composer").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("query");
    const text = (input.value || "").trim();
    if (!text) return;
    if (!store.token) {
      setCaption("Add a device token in settings first.");
      openSettings(true);
      return;
    }
    input.value = "";
    stopCurrentTurn();
    void executeTurn(async (signal) => apiTurnText(text, signal));
  });
  document.addEventListener("keydown", (e) => {
    if (e.code !== "Space" || e.repeat) return;
    if (document.activeElement && ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) return;
    e.preventDefault();
    void startListening();
  });
  document.addEventListener("keyup", (e) => {
    if (e.code !== "Space") return;
    e.preventDefault();
    void stopListeningAndSend();
  });

  // Tray action now toggles push-to-talk flow.
  if (TAURI?.event) {
    TAURI.event.listen("speak-briefing", () => toggleTalk());
    TAURI.event.listen("desktop-auth", (event) => {
      handleDesktopAuth(event.payload || {});
    });
  }
  if (TAURI?.event) {
    TAURI.event.listen("ptt-start", () => { void startListening(); });
    TAURI.event.listen("ptt-stop", () => { void stopListeningAndSend(); });
  }

  void registerGlobalHotkey();
  void startWakeWord();
  updateWakeStatus();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
