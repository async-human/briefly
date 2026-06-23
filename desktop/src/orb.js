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
  // Proactive voice: lets Briefly speak up on its own through the orb.
  get proactiveEnabled() {
    return localStorage.getItem("briefly.proactiveEnabled") !== "0";
  },
  set proactiveEnabled(v) {
    localStorage.setItem("briefly.proactiveEnabled", v ? "1" : "0");
  },
  get sessionId() {
    return localStorage.getItem("briefly.orbSessionId") || "";
  },
  set sessionId(v) {
    if (v) localStorage.setItem("briefly.orbSessionId", v);
    else localStorage.removeItem("briefly.orbSessionId");
  },
  get threadId() {
    return localStorage.getItem("briefly.orbThreadId") || "";
  },
  set threadId(v) {
    if (v) localStorage.setItem("briefly.orbThreadId", v);
    else localStorage.removeItem("briefly.orbThreadId");
  },
};

// How often the idle orb checks whether Briefly has something to say.
const PROACTIVE_POLL_MS = 90000;

// Voice activity detection — auto-detect end of speech so the user never has
// to click again to send. Tuned for typical desktop mic + WebView2 on Windows.
const VAD = {
  POLL_MS: 48,
  CALIBRATE_MS: 320,
  SPEECH_MARGIN: 2.8,
  MIN_SPEECH_RMS: 0.012,
  SILENCE_MS: 1100,
  MIN_SPEECH_MS: 380,
  MAX_LISTEN_MS: 45000,
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
  vadAudioCtx: null,
  vadAnalyser: null,
  vadPollTimer: null,
  vadNoiseFloor: 0.004,
  vadHasSpeech: false,
  vadSpeechStartedAt: 0,
  vadLastSpeechAt: 0,
  vadCalibratingUntil: 0,
  sendingUtterance: false,
  liveClient: null,
};

function appendTurnFormFields(form) {
  if (store.threadId) form.append("thread_id", store.threadId);
  if (store.sessionId) form.append("session_id", store.sessionId);
  form.append("surface", "desktop");
}

function applyTurnMeta(turn) {
  if (turn?.thread_id) store.threadId = turn.thread_id;
  if (turn?.session_id) store.sessionId = turn.session_id;
}

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

// Reveal the orb without stealing keyboard focus — used when Briefly speaks up
// on its own, so it never interrupts what you're typing.
async function showWindowQuiet() {
  try {
    if (TAURI?.window) await TAURI.window.getCurrentWindow().show();
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

async function apiPostJson(path, payload) {
  const doFetch = TAURI?.http?.fetch || window.fetch;
  const res = await doFetch(store.apiBase + path, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + store.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res;
}

async function ensureOrbSession() {
  if (store.sessionId || !store.token) return;
  try {
    const doFetch = TAURI?.http?.fetch || window.fetch;
    const res = await doFetch(store.apiBase + "/api/v1/orb/session", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + store.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        thread_id: store.threadId || null,
        surface: "desktop",
      }),
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.session_id) store.sessionId = data.session_id;
    if (data.thread_id) store.threadId = data.thread_id;
  } catch (_) {}
}

async function apiTurn(audioBlob, signal) {
  await ensureOrbSession();
  const form = new FormData();
  form.append("audio", audioBlob, "turn.webm");
  appendTurnFormFields(form);
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
  await ensureOrbSession();
  const form = new FormData();
  form.append("text", text);
  appendTurnFormFields(form);
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
  if (mode === "idle") {
    updateWakeStatus();
  } else {
    setStatusForMode(mode);
  }
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
  stopVadMonitor();
  const rec = state.mediaRecorder;
  if (!rec) return;
  if (rec.state !== "inactive") rec.stop();
  state.mediaRecorder = null;
}

function measureMicRms(analyser) {
  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

function stopVadMonitor() {
  if (state.vadPollTimer) {
    clearInterval(state.vadPollTimer);
    state.vadPollTimer = null;
  }
  state.vadHasSpeech = false;
  state.vadSpeechStartedAt = 0;
  state.vadLastSpeechAt = 0;
  state.vadCalibratingUntil = 0;
  if (state.vadAudioCtx) {
    try { state.vadAudioCtx.close(); } catch (_) {}
    state.vadAudioCtx = null;
  }
  state.vadAnalyser = null;
}

function startVadMonitor(stream) {
  stopVadMonitor();
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;

  const ctx = new AudioCtx();
  if (ctx.state === "suspended") void ctx.resume();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.55;
  source.connect(analyser);

  state.vadAudioCtx = ctx;
  state.vadAnalyser = analyser;
  state.vadNoiseFloor = 0.004;
  state.vadHasSpeech = false;
  state.vadCalibratingUntil = Date.now() + VAD.CALIBRATE_MS;

  state.vadPollTimer = setInterval(() => {
    if (state.mode !== "listening" || !state.vadAnalyser) return;

    const now = Date.now();
    const rms = measureMicRms(state.vadAnalyser);

    if (now < state.vadCalibratingUntil) {
      state.vadNoiseFloor = state.vadNoiseFloor * 0.85 + rms * 0.15;
      return;
    }

    const threshold = Math.max(
      VAD.MIN_SPEECH_RMS,
      state.vadNoiseFloor * VAD.SPEECH_MARGIN
    );
    const speaking = rms > threshold;

    if (speaking) {
      if (!state.vadHasSpeech) {
        state.vadHasSpeech = true;
        state.vadSpeechStartedAt = now;
      }
      state.vadLastSpeechAt = now;
      state.vadNoiseFloor = state.vadNoiseFloor * 0.92 + rms * 0.08;
      bumpEnergy();
      return;
    }

    if (!state.vadHasSpeech) {
      state.vadNoiseFloor = state.vadNoiseFloor * 0.97 + rms * 0.03;
      return;
    }

    const speechMs = state.vadLastSpeechAt - state.vadSpeechStartedAt;
    const silenceMs = now - state.vadLastSpeechAt;
    const listenMs = now - state.listeningStartedAt;

    if (
      silenceMs >= VAD.SILENCE_MS &&
      speechMs >= VAD.MIN_SPEECH_MS
    ) {
      void stopListeningAndSend();
      return;
    }

    if (listenMs >= VAD.MAX_LISTEN_MS) {
      void stopListeningAndSend();
    }
  }, VAD.POLL_MS);
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
  if (state.liveClient) state.liveClient.interrupt();
  stopListening();
  stopSpeaking();
  setCaption("");
  updateWakeStatus();
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
    flashCaption("Add a device token in settings first.", 2500);
    openSettings(true);
    return;
  }
  if (state.mode === "listening") return;
  stopCurrentTurn();
  await showWindow();
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
    recorder.start(250);
    state.mediaRecorder = recorder;
    startVadMonitor(stream);
  } catch (_) {
    setMode("idle");
    flashCaption("Microphone access was blocked.", 2500);
  }
}

async function stopListeningAndSend() {
  if (state.mode !== "listening" || state.sendingUtterance) return;
  state.sendingUtterance = true;
  stopVadMonitor();
  const recorder = state.mediaRecorder;
  const elapsed = Date.now() - state.listeningStartedAt;
  if (!recorder) {
    state.sendingUtterance = false;
    setMode("idle");
    return;
  }
  const blob = await new Promise((resolve) => {
    recorder.onstop = () => resolve(new Blob(state.audioChunks, { type: recorder.mimeType || "audio/webm" }));
    recorder.stop();
  });
  state.mediaRecorder = null;
  state.sendingUtterance = false;

  if (elapsed < 120 || !blob || blob.size === 0) {
    setMode("idle");
    flashCaption("Didn't catch that — try again.", 1400);
    return;
  }

  await executeTurn(async (signal) => apiTurn(blob, signal));
}

async function cancelListening() {
  if (state.mode !== "listening") return;
  stopListening();
  setMode("idle");
  flashCaption("Cancelled.", 900);
}

async function executeTurn(turnFactory) {
  setMode("thinking");
  const turnAbort = new AbortController();
  state.turnAbort = turnAbort;
  try {
    const turn = await turnFactory(turnAbort.signal);
    state.turnAbort = null;
    applyTurnMeta(turn);
    const answer = (turn && turn.answer ? String(turn.answer) : "").trim();
    if (!answer) throw new Error("No answer");
    const trace = Array.isArray(turn?.tool_trace) ? turn.tool_trace : [];
    if (trace.length) {
      const names = trace.map((t) => String(t.tool || "")).filter(Boolean).join(" + ");
      if (names) setStatusForMode("thinking", truncateStatus(`Using ${names}`, 48));
    }
    await playTts(answer);
    if (turnAbort.signal.aborted) return;
    if (turn?.expects_reply) {
      await startListening();
    }
  } catch (err) {
    if (turnAbort.signal.aborted) return;
    setMode("idle");
    flashCaption(err instanceof Error ? err.message : "Turn failed.", 2800);
  }
}

async function playTts(text) {
  const speakAbort = new AbortController();
  state.speakAbort = speakAbort;
  setMode("speaking");
  await playSentencePipeline({
    text,
    speakFn: apiSpeakToBlob,
    signal: speakAbort.signal,
    prefetch: 2,
  });
  if (!speakAbort.signal.aborted) {
    setMode("idle");
  }
  state.speakAbort = null;
  state.ttsAudio = null;
}

// ── Proactive voice ───────────────────────────────────────────────────────
// The orb periodically asks the backend whether Briefly should speak up. The
// server applies the context gate (quiet hours / in a meeting / "afraid to
// miss"), so we only act on a positive, gated response — and never interrupt an
// in-progress turn.
async function pollProactive() {
  if (!store.token || !store.proactiveEnabled) return;
  if (state.mode !== "idle") return;
  let res;
  try {
    res = await apiGet("/api/v1/orb/proactive/voice");
  } catch (_) {
    return; // offline / auth issue — try again next tick
  }
  if (!res || !res.speak || !res.script) return;
  if (state.mode !== "idle") return; // re-check: user may have started talking

  await showWindowQuiet();
  try {
    await playTts(res.script);
  } catch (_) {
    setMode("idle");
  }
  const ids = Array.isArray(res.event_ids) ? res.event_ids : [];
  if (ids.length) {
    try {
      await apiPostJson("/api/v1/orb/proactive/spoken", { event_ids: ids });
    } catch (_) {}
  }
}

function updateProactiveStatus() {
  const btn = document.getElementById("proactive");
  if (!btn) return;
  btn.classList.toggle("active", store.proactiveEnabled);
  btn.title = store.proactiveEnabled
    ? "Proactive voice on — Briefly will speak up"
    : "Proactive voice off";
}

function toggleProactive() {
  store.proactiveEnabled = !store.proactiveEnabled;
  updateProactiveStatus();
  flashCaption(
    store.proactiveEnabled ? "Proactive voice on." : "Proactive voice off.",
    1600
  );
  if (store.proactiveEnabled) void pollProactive();
}

function startProactiveLoop() {
  // Stagger the first check so it doesn't race app startup / auth linking.
  setTimeout(() => void pollProactive(), 8000);
  setInterval(() => void pollProactive(), PROACTIVE_POLL_MS);
}

function toggleTalk() {
  if (state.mode === "speaking" || state.mode === "thinking") {
    stopCurrentTurn();
    flashCaption("Interrupted", 900);
    return;
  }
  if (state.mode === "listening") {
    if (state.vadHasSpeech) {
      void stopListeningAndSend();
    } else {
      void cancelListening();
    }
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
  flashCaption("Desktop orb linked.", 2200);
}

async function registerGlobalHotkey() {
  if (!TAURI?.globalShortcut) return;
  try {
    await TAURI.globalShortcut.unregisterAll();
    await TAURI.globalShortcut.register("Ctrl+Shift+Space", () => {
      toggleTalk();
    });
    flashCaption("Hotkey ready: Ctrl+Shift+Space", 1200);
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
    flashCaption("Wake word heard.", 900);
    void startListening();
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
            flashCaption("Wake word heard.", 900);
            void startListening();
          });
        }
        updateWakeStatus();
        return;
      }
    } catch (_) {}
  }
  startWebWakeWord();
}

// ── Status line (short, single-line hints — not full agent responses) ─────
const STATUS = {
  idle: "",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
};

function truncateStatus(text, maxLen = 72) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1).trimEnd() + "…";
}

const captionEl = () => document.getElementById("caption");
function setCaption(text) {
  const el = captionEl();
  if (!el) return;
  const trimmed = truncateStatus(text);
  el.textContent = trimmed;
  el.classList.toggle("show", !!trimmed);
}

function setStatusForMode(mode, hint) {
  if (hint) {
    setCaption(hint);
    return;
  }
  setCaption(STATUS[mode] || "");
}

function flashCaption(text, ms = 1400) {
  setCaption(text);
  setTimeout(() => {
    if (state.mode === "idle") setCaption("");
    else setStatusForMode(state.mode);
  }, ms);
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
async function initLiveSession() {
  if (typeof OrbSessionClient === "undefined") return;
  state.liveClient = new OrbSessionClient({
    apiBase: store.apiBase,
    token: store.token,
    sessionId: store.sessionId,
    threadId: store.threadId,
    surface: "desktop",
    setSessionId: (id) => { store.sessionId = id; },
    setThreadId: (id) => { store.threadId = id; },
  });
  state.liveClient.onPartialTranscript = (text) => {
    if (state.mode === "listening") setStatusForMode("listening", truncateStatus(text, 48));
  };
  state.liveClient.onTurnResult = (turn) => {
    applyTurnMeta(turn);
    setMode("thinking");
  };
  state.liveClient.onTurnEnd = (frame) => {
    if (frame.expects_reply) void startListening();
    else setMode("idle");
  };
  await state.liveClient.connect();
}

function init() {
  initOrb();
  setMode("idle");
  void ensureOrbSession();
  void initLiveSession();

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
  document.getElementById("proactive").addEventListener("click", () => toggleProactive());
  document.getElementById("gear").addEventListener("click", () => openSettings());
  document.getElementById("hide").addEventListener("click", () => {
    stopCurrentTurn();
    hideWindow();
  });
  document.getElementById("save").addEventListener("click", () => {
    store.apiBase = document.getElementById("apiBase").value.trim();
    store.token = document.getElementById("token").value.trim();
    openSettings(false);
    flashCaption("Saved.", 1600);
  });
  document.getElementById("composer").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("query");
    const text = (input.value || "").trim();
    if (!text) return;
    if (!store.token) {
      flashCaption("Add a device token in settings first.", 2500);
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
  updateProactiveStatus();
  startProactiveLoop();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
