"use strict";

// Tauri globals (present when running inside the desktop app; absent in a plain
// browser, where we fall back gracefully for dev/preview).
const TAURI = window.__TAURI__ || null;
const DEFAULT_APP_BASE = "https://www.sendbriefly.app";
const WEB_SESSION_KEY = "briefly_token";
const IS_MOBILE_WEB =
  !TAURI &&
  (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(max-width: 768px) and (pointer: coarse)").matches));

function orbSurface() {
  return IS_MOBILE_WEB ? "mobile" : "desktop";
}

// ── Persistent settings ────────────────────────────────────────────────────
const store = {
  get apiBase() {
    return (localStorage.getItem("briefly.apiBase") || "https://api.sendbriefly.app").replace(/\/$/, "");
  },
  set apiBase(v) {
    localStorage.setItem("briefly.apiBase", v);
  },
  get token() {
    return (localStorage.getItem("briefly.token") || "").trim();
  },
  set token(v) {
    localStorage.setItem("briefly.token", String(v || "").trim());
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

// Voice activity detection — client-side endpointing (always on; server STT is optional).
const VAD = {
  POLL_MS: 48,
  BASE_SILENCE_MS: 850,
  MAX_ADAPTIVE_SILENCE_MS: 450,
  MIN_SPEECH_MS: 380,
  HANGOVER_MS: 280,
  CALIBRATE_MS: 380,
  MIN_LISTEN_MS: 550,
  MAX_LISTEN_MS: 45000,
  MAX_LISTEN_NO_SPEECH_MS: 12000,
  TRAILING_SILENCE_MS: 520,
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
  micWakeMonitor: null,
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
  endpointer: null,
  pcmNode: null,
  useServerEndpointing: false,
  serverStreamingStt: false,
  wsTurnActive: false,
  wakePrimed: false,
  wakeErrorShownAt: 0,
  linkVerified: false,
  connectPollTimer: null,
  connecting: false,
};

function isAccountLinked() {
  return state.linkVerified;
}

function stopConnectPoll() {
  if (state.connectPollTimer) {
    clearInterval(state.connectPollTimer);
    state.connectPollTimer = null;
  }
}

async function refreshLinkState(options = {}) {
  const { announce = false } = options;
  if (!store.token) {
    state.linkVerified = false;
    updateLinkStatus();
    return false;
  }
  const check = await verifyDeviceToken();
  state.linkVerified = check.ok;
  updateLinkStatus();
  if (check.ok && announce) {
    flashCaption("Briefly account connected.", 2200);
  }
  if (!check.ok && check.reason === "rejected") {
    state.linkVerified = false;
  }
  return check.ok;
}

function onAccountLinkedSuccess() {
  stopConnectPoll();
  state.connecting = false;
  updateLinkStatus();
  void primeWakeListening();
  void startWakeWord();
  void initLiveSession();
}

function pollForBrowserConnect() {
  stopConnectPoll();
  const tokenAtStart = store.token;
  let attempts = 0;
  state.connectPollTimer = setInterval(() => {
    attempts += 1;
    if (attempts > 30) {
      stopConnectPoll();
      state.connecting = false;
      updateLinkStatus();
      return;
    }
    void refreshLinkState({ announce: false }).then((ok) => {
      if (!ok) return;
      const changed = store.token !== tokenAtStart;
      if (changed || attempts <= 3) {
        flashCaption("Briefly account connected.", 2200);
      }
      onAccountLinkedSuccess();
    });
  }, 2000);
}

function connectPageUrl(relayPort) {
  if (IS_MOBILE_WEB) {
    const base = `${window.location.origin.replace(/\/$/, "")}/login?next=${encodeURIComponent("/orb")}`;
    return relayPort ? base : base;
  }
  const base =
    store.apiBase.includes("localhost")
      ? "http://localhost:3000/desktop/connect"
      : `${DEFAULT_APP_BASE}/desktop/connect`;
  if (!relayPort) return base;
  return `${base}?relay_port=${relayPort}`;
}

/** On mobile web, mint a capture token from the logged-in web session (same origin). */
async function bridgeWebSessionToOrb() {
  if (TAURI) return true;
  if (store.token) {
    await refreshLinkState();
    return state.linkVerified;
  }
  const webToken = localStorage.getItem(WEB_SESSION_KEY);
  if (!webToken) {
    window.location.replace(`/login?next=${encodeURIComponent("/orb")}`);
    return false;
  }
  try {
    const res = await apiFetch(`${store.apiBase}/api/v1/capture/tokens`, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + webToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: `Mobile Orb (${navigator.platform || "mobile"})`,
        platform: "mobile",
      }),
    });
    if (!res.ok) throw new Error("token create failed");
    const data = await res.json();
    if (!data?.token) throw new Error("no token");
    store.token = data.token;
    state.linkVerified = true;
    updateLinkStatus();
    return true;
  } catch (_) {
    flashCaption("Could not link account — sign in again.", 3200);
    window.location.replace(`/login?next=${encodeURIComponent("/orb")}`);
    return false;
  }
}

async function openBrieflyConnect() {
  if (IS_MOBILE_WEB) {
    window.location.href = `/login?next=${encodeURIComponent("/orb")}`;
    return;
  }
  if (store.token && !state.linkVerified) {
    store.token = "";
    state.linkVerified = false;
  }
  state.connecting = true;
  updateLinkStatus();

  let relayPort = null;
  if (TAURI?.core?.invoke) {
    try {
      relayPort = await TAURI.core.invoke("start_auth_relay_cmd");
    } catch (_) {}
  }

  const url = connectPageUrl(relayPort);
  try {
    if (TAURI?.opener?.openUrl) {
      await TAURI.opener.openUrl(url);
    } else {
      window.open(url, "_blank", "noopener");
    }
    flashCaption("Sign in in your browser to connect.", 3200);
    pollForBrowserConnect();
  } catch (_) {
    state.connecting = false;
    updateLinkStatus();
    flashCaption("Open " + url + " in your browser.", 4000);
  }
}

function updateLinkStatus() {
  const el = document.getElementById("linkStatus");
  const label = el?.querySelector(".link-label");
  const btn = document.getElementById("connect");
  const hint = document.querySelector("#settings .hint");
  const linked = state.linkVerified && !state.connecting;

  if (el && label) {
    if (state.connecting) {
      label.textContent = "Connecting via browser…";
      el.classList.remove("linked");
    } else if (state.linkVerified) {
      label.textContent = "Connected to Briefly";
      el.classList.add("linked");
    } else if (store.token) {
      label.textContent = "Account link invalid — click Connect";
      el.classList.remove("linked");
    } else {
      label.textContent = "Not connected";
      el.classList.remove("linked");
    }
  }

  if (btn) {
    if (linked) {
      btn.hidden = true;
      btn.disabled = false;
      btn.classList.remove("connecting");
    } else {
      btn.hidden = false;
      btn.textContent = state.connecting ? "Connecting…" : "Connect Briefly account";
      btn.disabled = state.connecting;
      btn.classList.toggle("connecting", state.connecting);
    }
  }

  if (hint) {
    hint.hidden = linked;
  }
}

function appendTurnFormFields(form) {
  if (store.threadId) form.append("thread_id", store.threadId);
  if (store.sessionId) form.append("session_id", store.sessionId);
  form.append("surface", orbSurface());
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
  if (IS_MOBILE_WEB) {
    window.location.href = "/dashboard";
    return;
  }
  try {
    if (TAURI?.window) await TAURI.window.getCurrentWindow().hide();
  } catch (_) {}
}

// ── API ─────────────────────────────────────────────────────────────────────
function apiFetch(url, options = {}) {
  // Prefer Tauri native HTTP — bypasses WebView CORS (tauri.localhost is not on API allowlist).
  if (TAURI?.http?.fetch) {
    return TAURI.http.fetch(url, options);
  }
  return window.fetch(url, options);
}

async function readResponseBlob(res, fallbackType = "audio/mpeg") {
  if (typeof res.blob === "function") {
    try {
      return await res.blob();
    } catch (_) {}
  }
  const buf = await res.arrayBuffer();
  let type = fallbackType;
  try {
    type = res.headers?.get?.("content-type") || res.headers?.["content-type"] || fallbackType;
  } catch (_) {}
  return new Blob([buf], { type });
}

function turnJsonBody(extra = {}) {
  return {
    thread_id: store.threadId || null,
    session_id: store.sessionId || null,
    surface: orbSurface(),
    ...extra,
  };
}

async function parseApiJson(res, label) {
  if (!res.ok) {
    let detail = "";
    try {
      const payload = await res.json();
      detail = payload?.detail ? String(payload.detail) : "";
    } catch (_) {}
    throw new Error(detail ? `${label}: HTTP ${res.status} — ${detail}` : `${label}: HTTP ${res.status}`);
  }
  return await res.json();
}

async function apiGet(path) {
  const url = store.apiBase + path;
  const headers = { Authorization: "Bearer " + store.token };
  const res = await apiFetch(url, { method: "GET", headers });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return await res.json();
}

async function apiPostJson(path, payload) {
  const res = await apiFetch(store.apiBase + path, {
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
    const res = await apiFetch(store.apiBase + "/api/v1/orb/session", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + store.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        thread_id: store.threadId || null,
        surface: orbSurface(),
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
  const mime = audioBlob.type || "audio/webm";
  const res = await apiFetch(store.apiBase + "/api/v1/orb/turn/json", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + store.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(turnJsonBody({
      audio_base64: await blobToBase64(audioBlob),
      content_type: mime,
      filename: mime.includes("mp4") ? "turn.m4a" : "turn.webm",
    })),
    signal,
  });
  return await parseApiJson(res, "Turn failed");
}

async function apiTurnText(text, signal) {
  await ensureOrbSession();
  const res = await apiFetch(store.apiBase + "/api/v1/orb/turn/json", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + store.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(turnJsonBody({ text })),
    signal,
  });
  return await parseApiJson(res, "Turn failed");
}

async function apiSpeakToBlob(text, signal) {
  const res = await apiFetch(store.apiBase + "/api/v1/orb/speak", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + store.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!res.ok) throw new Error("Speak failed: HTTP " + res.status);
  return await readResponseBlob(res);
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
  } else if (state.wakeBackend === "mic") {
    el.textContent = isAccountLinked()
      ? 'Wake word listening: say "hey briefly"'
      : "Connect account to enable wake word";
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
  state.endpointer = null;
  state.vadHasSpeech = false;
  state.vadSpeechStartedAt = 0;
  state.vadLastSpeechAt = 0;
  state.vadCalibratingUntil = 0;
  if (state.pcmNode) {
    try {
      state.pcmNode.disconnect();
      state.pcmNode.onaudioprocess = null;
    } catch (_) {}
    state.pcmNode = null;
  }
  if (state.vadAudioCtx) {
    try { state.vadAudioCtx.close(); } catch (_) {}
    state.vadAudioCtx = null;
  }
  state.vadAnalyser = null;
}

function shouldStreamPcmToServer() {
  // Client VAD + HTTP upload is the reliable turn path. Streaming PCM in parallel
  // can duplicate turns when both client and Deepgram utterance-end fire.
  return false;
}

function stopListeningOnly() {
  stopVadMonitor();
  const rec = state.mediaRecorder;
  if (rec && rec.state !== "inactive") {
    try { rec.stop(); } catch (_) {}
  }
  state.mediaRecorder = null;
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
  state.useServerEndpointing = false;

  if (shouldStreamPcmToServer() && typeof float32ToInt16PCM === "function") {
    const pcmNode = ctx.createScriptProcessor(4096, 1, 1);
    pcmNode.onaudioprocess = (ev) => {
      if (state.mode !== "listening" || !state.liveClient?.ready) return;
      const input = ev.inputBuffer.getChannelData(0);
      state.liveClient.sendAudio(float32ToInt16PCM(input));
    };
    source.connect(pcmNode);
    pcmNode.connect(ctx.destination);
    state.pcmNode = pcmNode;
  }

  state.endpointer = new SpeechEndpointer({
    pollMs: VAD.POLL_MS,
    baseSilenceMs: VAD.BASE_SILENCE_MS,
    maxAdaptiveSilenceMs: VAD.MAX_ADAPTIVE_SILENCE_MS,
    minSpeechMs: VAD.MIN_SPEECH_MS,
    hangoverMs: VAD.HANGOVER_MS,
    calibrateMs: VAD.CALIBRATE_MS,
    minListenMs: VAD.MIN_LISTEN_MS,
    maxListenMs: VAD.MAX_LISTEN_MS,
    maxListenNoSpeechMs: VAD.MAX_LISTEN_NO_SPEECH_MS,
    trailingSilenceMs: VAD.TRAILING_SILENCE_MS,
  });
  state.endpointer.begin(Date.now());

  state.vadPollTimer = setInterval(() => {
    if (state.mode !== "listening" || !state.vadAnalyser || !state.endpointer) return;

    const now = Date.now();
    const rms = measureMicRms(state.vadAnalyser);
    const result = state.endpointer.feed(rms, now);
    state.vadHasSpeech = state.endpointer.speechDetected;

    if (result === "calibrating") return;

    if (state.endpointer.speechActive) {
      bumpEnergy();
    }

    if (result === "end") {
      void stopListeningAndSend();
      return;
    }

    if (result === "cancel") {
      void cancelListening();
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

async function ensureMic() {
  if (state.micStream) return state.micStream;
  state.micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false,
    },
  });
  return state.micStream;
}

async function verifyDeviceToken() {
  const token = store.token;
  if (!token) return { ok: false, reason: "missing" };
  try {
    const res = await apiFetch(store.apiBase + "/api/v1/orb/session", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ surface: orbSurface() }),
    });
    if (res.status === 401) return { ok: false, reason: "rejected" };
    if (!res.ok) return { ok: false, reason: "http_" + res.status };
    const data = await res.json();
    if (data.session_id) store.sessionId = data.session_id;
    if (data.thread_id) store.threadId = data.thread_id;
    return { ok: true };
  } catch (_) {
    return { ok: false, reason: "network" };
  }
}

async function blobToBase64(blob) {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function parseWakeCheckResponse(res) {
  if (res.status === 404) {
    throw new Error("Wake API missing — deploy latest backend");
  }
  if (res.status === 401) {
    throw new Error("HTTP 401 — check device token in settings");
  }
  let payload = null;
  try {
    payload = await res.json();
  } catch (_) {
    if (!res.ok) throw new Error("Wake check failed: HTTP " + res.status);
    throw new Error("Wake check returned invalid JSON");
  }
  if (!res.ok) {
    const detail = payload?.detail ? String(payload.detail) : "";
    throw new Error(detail ? `HTTP ${res.status}: ${detail}` : "Wake check failed: HTTP " + res.status);
  }
  return payload;
}

async function apiWakeCheck(audioBlob) {
  const token = store.token;
  if (!token) {
    throw new Error("HTTP 401 — connect your Briefly account in settings");
  }
  const mime = audioBlob.type || "audio/webm";
  const headers = {
    Authorization: "Bearer " + token,
    "Content-Type": "application/json",
  };
  const body = JSON.stringify({
    audio_base64: await blobToBase64(audioBlob),
    content_type: mime,
    filename: mime.includes("mp4") ? "wake.m4a" : "wake.webm",
  });

  const res = await apiFetch(store.apiBase + "/api/v1/orb/wake-check/json", {
    method: "POST",
    headers,
    body,
  });
  return await parseWakeCheckResponse(res);
}

function chooseMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const candidate of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return "";
}

async function startListening() {
  if (!isAccountLinked()) {
    if (store.token) {
      const ok = await refreshLinkState();
      if (!ok) {
        flashCaption("Session expired — click Connect in settings.", 3200);
        openSettings(true);
        return;
      }
    } else {
      flashCaption("Connect your Briefly account first (gear icon).", 2800);
      openSettings(true);
      return;
    }
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
  if (state.mode !== "listening" || state.sendingUtterance || state.wsTurnActive) return;
  if (state.endpointer && !state.endpointer.speechDetected) {
    void cancelListening();
    return;
  }
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
    const msg = err instanceof Error ? err.message : "Turn failed.";
    if (/failed to fetch|networkerror/i.test(msg)) {
      flashCaption("Can't reach API — check connection.", 2800);
    } else {
      flashCaption(truncateStatus(msg, 72), 2800);
    }
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
    onAudio: (audio) => {
      state.ttsAudio = audio;
    },
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
    const hasSpeech =
      state.vadHasSpeech ||
      (state.endpointer && state.endpointer.speechDetected);
    if (hasSpeech) {
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
  state.connecting = false;
  state.linkVerified = true;
  updateLinkStatus();
  updateWakeStatus();
  openSettings(false);
  stopConnectPoll();
  void refreshLinkState({ announce: true }).then((ok) => {
    if (ok) {
      onAccountLinkedSuccess();
    } else {
      state.linkVerified = !!store.token;
      updateLinkStatus();
    }
  });
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
  if (state.micWakeMonitor) {
    state.micWakeMonitor.stop();
    state.micWakeMonitor = null;
  }
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

function onWakePhraseHeard() {
  if (state.mode === "listening") return;
  if (state.mode === "speaking" || state.mode === "thinking") {
    stopCurrentTurn();
    flashCaption("Interrupted — listening.", 1200);
    void startListening();
    return;
  }
  if (state.mode !== "idle") return;
  flashCaption("Wake word heard.", 900);
  void startListening();
}

function onWakeMonitorError(kind, err) {
  const now = Date.now();
  if (now - state.wakeErrorShownAt < 8000) return;
  state.wakeErrorShownAt = now;
  const msg = String(err?.message || err || "");
  if (kind === "mic") {
    flashCaption("Mic blocked — allow access for wake word.", 2800);
    return;
  }
  if (msg.includes("404") || msg.includes("Wake API missing")) {
    flashCaption("Wake API not deployed yet — use tap-to-talk.", 3200);
    return;
  }
  if (msg.includes("401") || msg.includes("rejected")) {
    if (isAccountLinked()) return;
    flashCaption("Connect your Briefly account (gear → Connect).", 3600);
    return;
  }
  if (msg.includes("502") || msg.includes("503")) {
    flashCaption("Server busy — opening mic anyway.", 2200);
    return;
  }
  if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
    flashCaption("Can't reach API — check connection.", 2800);
    return;
  }
  if (kind === "check" && msg) {
    flashCaption(truncateStatus(msg, 72) || "Wake check failed.", 2800);
  }
}

async function primeWakeListening() {
  state.wakePrimed = true;
  if (state.micWakeMonitor) {
    await state.micWakeMonitor.ensureAudioRunning();
    return;
  }
  if (store.wakeEnabled && !store.wakeMuted && isAccountLinked()) {
    await startMicWakeWord();
  }
}

async function startMicWakeWord() {
  state.wakeBackend = "none";
  stopWakeWord();
  if (!store.wakeEnabled || store.wakeMuted) {
    updateWakeStatus();
    return;
  }
  if (!isAccountLinked()) {
    state.wakeBackend = "mic";
    updateWakeStatus();
    return;
  }
  state.micWakeMonitor = new MicWakeMonitor({
    getStream: ensureMic,
    checkWake: apiWakeCheck,
    onWake: onWakePhraseHeard,
    onError: onWakeMonitorError,
    isLinked: isAccountLinked,
    verifyLinked: async () => refreshLinkState(),
    isIdle: () => {
      if (!store.wakeEnabled || store.wakeMuted) return false;
      if (state.mode === "listening") return false;
      return state.mode === "idle" || state.mode === "speaking" || state.mode === "thinking";
    },
    measureRms: measureMicRms,
    chooseMimeType,
  });
  await state.micWakeMonitor.start();
  if (state.wakePrimed) {
    await state.micWakeMonitor.ensureAudioRunning();
  }
  if (state.micWakeMonitor.active) {
    state.wakeBackend = "mic";
  }
  updateWakeStatus();
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
    if (state.mode === "listening") return;
    let transcript = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0]?.transcript || "";
    }
    if (!transcriptMatchesWakePhrase(transcript)) return;
    onWakePhraseHeard();
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
            onWakePhraseHeard();
          });
        }
        updateWakeStatus();
        return;
      }
    } catch (_) {}
  }
  await startMicWakeWord();
  if (state.wakeBackend === "mic") return;
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
const ORB_WINDOW = { width: 220, compact: 318, settings: 348, advanced: 430 };

async function setOrbWindowHeight(height) {
  if (!TAURI?.window) return;
  try {
    const win = TAURI.window.getCurrentWindow();
    const LogicalSize = TAURI.dpi?.LogicalSize;
    if (LogicalSize) {
      await win.setSize(new LogicalSize(ORB_WINDOW.width, height));
    } else {
      await win.setSize({ width: ORB_WINDOW.width, height });
    }
  } catch (_) {}
}

function settingsPanelHeight() {
  const details = document.querySelector(".advanced-settings");
  if (details?.open) return ORB_WINDOW.advanced;
  return ORB_WINDOW.settings;
}

async function syncOrbWindowForSettings(open) {
  await setOrbWindowHeight(open ? settingsPanelHeight() : ORB_WINDOW.compact);
}

function openSettings(open) {
  const panel = document.getElementById("settings");
  const footerMain = document.getElementById("footerMain");
  const gear = document.getElementById("gear");
  if (!panel || !footerMain) return;
  const willOpen = open ?? panel.classList.contains("hidden");
  if (willOpen) {
    document.getElementById("apiBase").value = store.apiBase;
    document.getElementById("token").value = store.token;
    updateLinkStatus();
    if (store.token) {
      void refreshLinkState();
    }
    panel.classList.remove("hidden");
    footerMain.classList.add("hidden");
    document.body.classList.add("settings-open");
    gear?.classList.add("active");
    void syncOrbWindowForSettings(true);
  } else {
    panel.classList.add("hidden");
    footerMain.classList.remove("hidden");
    document.body.classList.remove("settings-open");
    gear?.classList.remove("active");
    void syncOrbWindowForSettings(false);
  }
}

// ── Wire-up ─────────────────────────────────────────────────────────────────
async function initLiveSession() {
  if (typeof OrbSessionClient === "undefined") return;
  if (state.liveClient) state.liveClient.close();
  state.liveClient = new OrbSessionClient({
    getApiBase: () => store.apiBase,
    getToken: () => store.token,
    getSessionId: () => store.sessionId,
    getThreadId: () => store.threadId,
    surface: orbSurface(),
    setSessionId: (id) => { store.sessionId = id; },
    setThreadId: (id) => { store.threadId = id; },
  });
  state.liveClient.onSessionReady = (frame) => {
    state.serverStreamingStt = !!frame.streaming_stt;
  };
  state.liveClient.onPartialTranscript = (text, isFinal) => {
    if (state.mode === "listening") {
      setStatusForMode("listening", truncateStatus(text, 48));
      return;
    }
    if (
      (state.mode === "idle" || state.mode === "speaking" || state.mode === "thinking") &&
      store.wakeEnabled &&
      !store.wakeMuted &&
      transcriptMatchesWakePhrase(text)
    ) {
      onWakePhraseHeard();
    }
  };
  state.liveClient.onTurnStart = () => {
    state.wsTurnActive = true;
    stopListeningOnly();
    setMode("thinking");
  };
  state.liveClient.onTurnResult = async (turn) => {
    applyTurnMeta(turn);
    const answer = (turn && turn.answer ? String(turn.answer) : "").trim();
    if (answer) await playTts(answer);
  };
  state.liveClient.onTurnEnd = (frame) => {
    state.wsTurnActive = false;
    state.sendingUtterance = false;
    if (frame.expects_reply) void startListening();
    else setMode("idle");
  };
  state.liveClient.onSpeechFinal = () => {
    if (state.mode !== "listening" || state.wsTurnActive) return;
    setStatusForMode("listening", "Processing…");
    stopListeningOnly();
  };
  state.liveClient.onError = (message) => {
    if (String(message || "").toLowerCase().includes("unauthorized")) {
      try { localStorage.setItem("briefly.orbLiveSession", "0"); } catch (_) {}
    }
  };
  const connected = await state.liveClient.connect();
  if (!connected) {
    state.serverStreamingStt = false;
    state.useServerEndpointing = false;
  }
}

function init() {
  if (IS_MOBILE_WEB) {
    document.documentElement.classList.add("mobile-web");
    document.body.classList.add("mobile-web");
  }
  initOrb();
  setMode("idle");
  void ensureOrbSession();
  void initLiveSession();

  document.getElementById("orb-hit").addEventListener("click", (e) => {
    e.preventDefault();
    void primeWakeListening();
    toggleTalk();
  });
  document.getElementById("replay").addEventListener("click", () => toggleTalk());
  document.getElementById("wake").addEventListener("click", () => {
    store.wakeMuted = !store.wakeMuted;
    if (store.wakeMuted) {
      stopWakeWord();
    } else {
      void primeWakeListening();
      void startWakeWord();
    }
    updateWakeStatus();
  });
  document.getElementById("proactive").addEventListener("click", () => toggleProactive());
  document.getElementById("gear").addEventListener("click", () => openSettings());
  document.getElementById("settingsClose").addEventListener("click", () => openSettings(false));
  document.querySelector(".advanced-settings")?.addEventListener("toggle", () => {
    if (!document.body.classList.contains("settings-open")) return;
    void syncOrbWindowForSettings(true);
  });
  document.getElementById("connect").addEventListener("click", () => {
    void openBrieflyConnect();
  });
  document.getElementById("hide").addEventListener("click", () => {
    stopCurrentTurn();
    hideWindow();
  });
  document.getElementById("save").addEventListener("click", async () => {
    store.apiBase = document.getElementById("apiBase").value.trim().replace(/\/$/, "");
    store.token = document.getElementById("token").value.trim();
    if (!store.token) {
      state.linkVerified = false;
      openSettings(false);
      updateLinkStatus();
      flashCaption("Saved.", 1600);
      return;
    }
    const ok = await refreshLinkState();
    openSettings(false);
    if (!ok) {
      const reason =
        !store.token ? "No token saved" :
        "Account link failed — use Connect button instead";
      flashCaption(reason, 3800);
      return;
    }
    flashCaption("Connected.", 2000);
    onAccountLinkedSuccess();
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

  window.addEventListener("storage", (e) => {
    if (e.key === "briefly.token" && e.newValue) {
      void refreshLinkState({ announce: true }).then((ok) => {
        if (ok) onAccountLinkedSuccess();
      });
    }
  });

  void registerGlobalHotkey();
  if (store.token) {
    void refreshLinkState().then((ok) => {
      if (!ok) {
        flashCaption("Session expired — click Connect in settings.", 4200);
        openSettings(true);
      } else {
        void startWakeWord();
      }
    });
  } else {
    updateLinkStatus();
    void startWakeWord();
  }
  updateWakeStatus();
  updateProactiveStatus();
  startProactiveLoop();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    void bridgeWebSessionToOrb().then((ok) => {
      if (ok !== false) init();
    });
  });
} else {
  void bridgeWebSessionToOrb().then((ok) => {
    if (ok !== false) init();
  });
}
