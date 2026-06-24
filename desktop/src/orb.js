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
  BASE_SILENCE_MS: 1600,
  MAX_ADAPTIVE_SILENCE_MS: 1000,
  MIN_SPEECH_MS: 320,
  HANGOVER_MS: 500,
  CALIBRATE_MS: 600,
  MIN_LISTEN_MS: 700,
  MAX_LISTEN_MS: 60000,
  MAX_LISTEN_NO_SPEECH_MS: 15000,
  MAX_POST_SPEECH_SILENCE_MS: 3200,
  SPEECH_START_FRAMES: 2,
};

/** Pause before reopening the mic after the agent speaks (avoids echo). */
const LISTEN_REOPEN_DELAY_MS = 150;

/** Barge-in — STT-confirmed primary; RMS backup if live STT unavailable. */
const BARGE_IN = {
  GRACE_AFTER_SPEAK_MS: 350,
  COOLDOWN_MS: 800,
  RMS_POLL_MS: 80,
  RMS_CALIBRATE_MS: 400,
  RMS_NOISE_MULT: 3.8,
  RMS_MIN_ABS: 0.028,
  RMS_SUSTAIN_MS: 380,
  RMS_DECAY_MS: 45,
};

/** If speech was heard but VAD never endpointed, force-send after this silence. */
const LISTEN_STUCK_SILENCE_MS = 3200;

/** Abort a stuck turn (listen → thinking with no response). */
const TURN_TIMEOUT_MS = 90000;

/** WS: max wait after speech ends before turn_start. */
const WS_TURN_START_TIMEOUT_MS = 45000;

/** Stop auto-reopening mic after this many consecutive turn failures. */
const MAX_TURN_FAILURE_RETRIES = 1;

const state = {
  mode: "idle", // idle | listening | thinking | speaking
  mediaRecorder: null,
  audioChunks: [],
  micStream: null,
  listeningStartedAt: 0,
  turnAbort: null,
  turnAbortReason: null,
  turnTimeoutHandle: null,
  wsTurnWatchdog: null,
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
  wsTurnSpeaker: null,
  liveSttActive: false,
  wakePrimed: false,
  wakeErrorShownAt: 0,
  linkVerified: false,
  connectPollTimer: null,
  connecting: false,
  conversationActive: false,
  conversationMuted: false,
  lastAssistantAnswer: "",
  turnFailureCount: 0,
  playbackCtx: null,
  playbackUnlocked: false,
  conversationGeneration: 0,
  activeTurnEpoch: 0,
  currentTurnEpoch: 0,
  bargeInTimer: null,
  bargeInAnalyser: null,
  bargeInCtx: null,
  bargeInSpeechMs: 0,
  bargeInCooldownUntil: 0,
  speakingStartedAt: 0,
  interruptInFlight: false,
  liveListenMode: null,
  auxPcmCtx: null,
  auxPcmNode: null,
  agentSpokenText: "",
  wakeListenActive: false,
  bargeListenActive: false,
};

function wakePhraseMatched(transcript) {
  return transcriptMatchesWakePhrase(transcript)
    || (typeof transcriptLikelyWakePhrase === "function" && transcriptLikelyWakePhrase(transcript));
}

function isEchoOfAgentSpeech(text) {
  const norm = normalizeCommandText(text);
  if (!norm || !state.agentSpokenText) return false;
  const agent = normalizeCommandText(state.agentSpokenText);
  if (!agent) return false;
  if (agent.includes(norm) && norm.length >= 4) return true;
  const tail = agent.slice(-Math.min(agent.length, 48));
  if (tail && norm.length >= 5 && tail.includes(norm)) return true;
  const agentWords = agent.split(/\s+/).filter(Boolean);
  const userWords = norm.split(/\s+/).filter(Boolean);
  if (userWords.length >= 2 && agentWords.length >= 2) {
    const overlap = userWords.filter((w) => agentWords.includes(w)).length;
    if (overlap >= Math.min(userWords.length, 3)) return true;
  }
  return false;
}

function looksLikeUserBargeIn(text, isFinal) {
  if (!text || isEchoOfAgentSpeech(text)) return false;
  if (matchVoiceCommand(text)) return true;
  if (wakePhraseMatched(text)) return true;
  const norm = normalizeCommandText(text);
  if (!norm) return false;
  const words = norm.split(/\s+/).filter(Boolean);
  const oneWordBarge = new Set([
    "stop", "wait", "hold", "no", "mute", "pause", "hey", "briefly", "shh", "quiet",
  ]);
  if (words.length === 1 && oneWordBarge.has(words[0])) return true;
  if (words.length >= 2) return true;
  if (isFinal && norm.length >= 4) return true;
  if (!isFinal && norm.length >= 6) return true;
  return false;
}

function stopAuxPcmStream() {
  if (state.auxPcmNode) {
    try {
      state.auxPcmNode.onaudioprocess = null;
      state.auxPcmNode.disconnect();
    } catch (_) {}
    state.auxPcmNode = null;
  }
  state.wakeListenActive = false;
  state.bargeListenActive = false;
  state.liveListenMode = null;
}

function startAuxPcmStream(mode) {
  stopAuxPcmStream();
  if (!state.micStream || !state.liveClient?.ready || typeof float32To16kPcm !== "function") {
    return;
  }
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  if (!state.auxPcmCtx || state.auxPcmCtx.state === "closed") {
    state.auxPcmCtx = new AudioCtx();
  }
  const ctx = state.auxPcmCtx;
  if (ctx.state === "suspended") void ctx.resume();
  const source = ctx.createMediaStreamSource(state.micStream);
  const pcmNode = ctx.createScriptProcessor(2048, 1, 1);
  const inputRate = ctx.sampleRate || 48000;
  pcmNode.onaudioprocess = (ev) => {
    if (!state.liveClient?.ready) return;
    if (mode === "wake") {
      if (state.liveListenMode !== "wake" || state.mode !== "idle") return;
      if (!store.wakeEnabled || store.wakeMuted) return;
    } else if (mode === "barge_in") {
      if (state.liveListenMode !== "barge_in") return;
      if (state.mode !== "speaking" && state.mode !== "thinking") return;
      if (Date.now() - state.speakingStartedAt < BARGE_IN.GRACE_AFTER_SPEAK_MS) return;
    } else {
      return;
    }
    const input = ev.inputBuffer.getChannelData(0);
    state.liveClient.sendAudio(float32To16kPcm(input, inputRate));
  };
  source.connect(pcmNode);
  pcmNode.connect(ctx.destination);
  state.auxPcmNode = pcmNode;
  state.liveListenMode = mode;
  if (mode === "wake") state.wakeListenActive = true;
  if (mode === "barge_in") state.bargeListenActive = true;
}

async function startWakeListenStream() {
  if (!store.wakeEnabled || store.wakeMuted || !isAccountLinked()) return;
  if (state.mode !== "idle" || state.conversationActive) return;
  if (!state.liveClient?.ready || !state.serverStreamingStt) return;
  try {
    await ensureMic();
    const ok = await state.liveClient.prepareWakeListen();
    if (!ok || state.mode !== "idle") return;
    startAuxPcmStream("wake");
  } catch (_) {}
}

function stopWakeListenStream() {
  if (state.liveListenMode === "wake") stopAuxPcmStream();
}

async function startSemanticBargeIn() {
  if (state.mode !== "speaking" && state.mode !== "thinking") return;
  if (!state.liveClient?.ready) {
    startBargeInMonitor();
    return;
  }
  try {
    await ensureMic();
    const ok = await state.liveClient.prepareBargeIn();
    if (state.mode !== "speaking" && state.mode !== "thinking") return;
    if (ok) {
      startAuxPcmStream("barge_in");
      return;
    }
  } catch (_) {}
  startBargeInMonitor();
}

function stopSemanticBargeIn() {
  if (state.liveListenMode === "barge_in") stopAuxPcmStream();
}

function scheduleWakeListenRestart(delayMs = 400) {
  setTimeout(() => {
    if (state.mode === "idle" && store.wakeEnabled && !store.wakeMuted && !state.conversationActive) {
      void startWakeListenStream();
    }
  }, delayMs);
}

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

async function ensureLiveSession() {
  if (!state.liveClient || !state.liveClient.ready) {
    await initLiveSession();
  }
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
  const answer = (turn?.answer || "").trim();
  if (answer) state.lastAssistantAnswer = answer.slice(0, 500);
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
  if (!store.token || store.sessionId) return;
  try {
    const res = await apiFetch(store.apiBase + "/api/v1/orb/session", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + store.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session_id: store.sessionId || null,
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
  if (signal?.aborted) return null;
  const mime = audioBlob.type || "audio/webm";
  const filename = mime.includes("mp4") ? "turn.m4a" : "turn.webm";

  const streamPayload = {
    audio_base64: await blobToBase64(audioBlob),
    content_type: mime,
    filename,
  };
  const streamed = await runOrbTurnWithStream(streamPayload, signal);
  if (streamed) return streamed;
  if (signal?.aborted) return null;

  // Web/mobile: multipart upload avoids base64 inflation (~33% smaller, faster).
  if (!TAURI && typeof FormData !== "undefined") {
    const form = new FormData();
    form.append("audio", audioBlob, filename);
    if (store.threadId) form.append("thread_id", store.threadId);
    if (store.sessionId) form.append("session_id", store.sessionId);
    form.append("surface", orbSurface());
    const res = await apiFetch(store.apiBase + "/api/v1/orb/turn", {
      method: "POST",
      headers: { Authorization: "Bearer " + store.token },
      body: form,
      signal,
    });
    return await parseApiJson(res, "Turn failed");
  }

  const res = await apiFetch(store.apiBase + "/api/v1/orb/turn/json", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + store.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(turnJsonBody({
      audio_base64: await blobToBase64(audioBlob),
      content_type: mime,
      filename,
    })),
    signal,
  });
  return await parseApiJson(res, "Turn failed");
}

async function apiTurnText(text, signal) {
  await ensureOrbSession();
  const streamed = await runOrbTurnWithStream({ text }, signal);
  if (streamed) return streamed;
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

async function requestOrbTurnStream(body, signal) {
  return apiFetch(store.apiBase + "/api/v1/orb/turn/stream", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + store.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(turnJsonBody(body)),
    signal,
  });
}

/**
 * Stream LLM response and speak each sentence as it completes (low-latency path).
 * Falls back to batch turn + playTts on 404 or stream errors.
 */
async function runOrbTurnWithStream(payload, signal) {
  if (state.conversationMuted) return null;

  const fetchAbort = new AbortController();
  const onParentAbort = () => fetchAbort.abort();
  if (signal) signal.addEventListener("abort", onParentAbort, { once: true });

  let res;
  try {
    res = await requestOrbTurnStream(payload, fetchAbort.signal);
  } catch (_) {
    if (signal) signal.removeEventListener("abort", onParentAbort);
    if (signal?.aborted) return null;
    return null;
  }
  if (signal) signal.removeEventListener("abort", onParentAbort);

  if (res.status === 404 || res.status === 405) return null;

  if (!res.ok) {
    let detail = "";
    try {
      const errBody = await res.json();
      detail = errBody?.detail ? String(errBody.detail) : "";
    } catch (_) {}
    throw new Error(detail || `Turn stream failed: HTTP ${res.status}`);
  }

  const speakAbort = new AbortController();
  state.speakAbort = speakAbort;
  const linked = () => {
    if (signal?.aborted) speakAbort.abort();
  };
  signal?.addEventListener("abort", linked, { once: true });

  setMode("thinking");
  setStatusForMode("thinking", "Thinking…");

  let voiceCmd = null;
  try {
    const turn = await streamOrbTurnAndSpeak({
      response: res,
      speakFn: apiSpeakToBlob,
      speakStreamFn: apiSpeakStreamToBlob,
      signal: speakAbort.signal,
      onAudio: (audio) => {
        state.ttsAudio = audio;
      },
      onSpeakingStart: () => setMode("speaking"),
      onMeta: (meta) => {
        applyTurnMeta(meta);
        const cmd = matchVoiceCommand(meta.transcript || "");
        if (cmd) {
          voiceCmd = cmd;
          speakAbort.abort();
          fetchAbort.abort();
        }
      },
    });

    signal?.removeEventListener("abort", linked);
    state.speakAbort = null;
    state.ttsAudio = null;

    if (!speakAbort.signal.aborted) setMode("idle");
    turn._ttsPlayed = true;
    return turn;
  } catch (err) {
    signal?.removeEventListener("abort", linked);
    state.speakAbort = null;
    state.ttsAudio = null;
    if (signal?.aborted) return null;
    if (voiceCmd) {
      await applyVoiceCommand(voiceCmd);
      return { _ttsPlayed: true };
    }
    throw err;
  }
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

async function apiSpeakStreamToBlob(text, signal) {
  const res = await apiFetch(store.apiBase + "/api/v1/orb/speak/stream", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + store.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!res.ok) throw new Error("Speak stream failed: HTTP " + res.status);
  return await readResponseBlob(res);
}

/** Unlock audio output after a user gesture (required on mobile Safari). */
async function primeAudioPlayback() {
  if (state.playbackUnlocked) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!state.playbackCtx) state.playbackCtx = new AudioCtx();
    if (state.playbackCtx.state === "suspended") await state.playbackCtx.resume();
    const buffer = state.playbackCtx.createBuffer(1, 1, 22050);
    const source = state.playbackCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(state.playbackCtx.destination);
    source.start(0);
    state.playbackUnlocked = true;
  } catch (_) {}
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
    stopBargeInMonitor();
    stopSemanticBargeIn();
    updateWakeStatus();
    if (store.wakeEnabled && !store.wakeMuted && !state.conversationActive) {
      void startWakeListenStream();
    }
  } else {
    stopWakeListenStream();
    setStatusForMode(mode);
    if (mode === "speaking" || mode === "thinking") {
      state.speakingStartedAt = Date.now();
      state.bargeInCooldownUntil = 0;
      void ensureMic().then(() => startSemanticBargeIn()).catch(() => {});
    } else {
      stopBargeInMonitor();
      stopSemanticBargeIn();
    }
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

function clearWsTurnWatchdog() {
  if (state.wsTurnWatchdog) {
    clearTimeout(state.wsTurnWatchdog);
    state.wsTurnWatchdog = null;
  }
}

function armWsTurnWatchdog() {
  clearWsTurnWatchdog();
  state.wsTurnWatchdog = setTimeout(() => {
    state.wsTurnWatchdog = null;
    if (state.wsTurnActive) return;
    if (!state.sendingUtterance && state.mode !== "thinking") return;
    state.sendingUtterance = false;
    state.wsTurnActive = false;
    if (state.liveClient) state.liveClient.interrupt();
    setMode("idle");
    flashCaption("Didn't get a response — tap and try again.", 2800);
  }, WS_TURN_START_TIMEOUT_MS);
}

function abortHttpTurn(reason) {
  state.turnAbortReason = reason;
  if (state.turnTimeoutHandle) {
    clearTimeout(state.turnTimeoutHandle);
    state.turnTimeoutHandle = null;
  }
  if (state.turnAbort) {
    state.turnAbort.abort();
    state.turnAbort = null;
  }
}

function hardStopSpeech() {
  state.conversationGeneration += 1;
  state.activeTurnEpoch += 1;
  state.sendingUtterance = false;
  state.wsTurnActive = false;
  state.agentSpokenText = "";
  clearWsTurnWatchdog();
  if (typeof stopAllPlayback === "function") stopAllPlayback();
  abortHttpTurn("user");
  if (state.speakAbort) {
    try { state.speakAbort.abort(); } catch (_) {}
    state.speakAbort = null;
  }
  if (state.wsTurnSpeaker) {
    state.wsTurnSpeaker.abort();
    state.wsTurnSpeaker = null;
  }
  if (state.ttsAudio) {
    try {
      state.ttsAudio.pause();
      state.ttsAudio.currentTime = 0;
      state.ttsAudio.src = "";
      state.ttsAudio.load();
    } catch (_) {}
    state.ttsAudio = null;
  }
  stopBargeInMonitor();
  stopSemanticBargeIn();
  if (state.liveClient?.ready) {
    const client = state.liveClient;
    setTimeout(() => { client.interrupt(); }, 0);
  }
}

function stopSpeaking() {
  hardStopSpeech();
  if (state.mode === "speaking" || state.mode === "thinking") setMode("idle");
}

function stopBargeInMonitor() {
  if (state.bargeInTimer) {
    clearInterval(state.bargeInTimer);
    state.bargeInTimer = null;
  }
  state.bargeInAnalyser = null;
  state.bargeInSpeechMs = 0;
}

function startBargeInMonitor() {
  stopBargeInMonitor();
  if (!state.micStream || state.conversationMuted) return;
  if (state.mode !== "speaking" && state.mode !== "thinking") return;

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;

  if (!state.bargeInCtx) state.bargeInCtx = new AudioCtx();
  const ctx = state.bargeInCtx;
  if (ctx.state === "suspended") void ctx.resume();

  const source = ctx.createMediaStreamSource(state.micStream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.72;
  source.connect(analyser);
  state.bargeInAnalyser = analyser;
  state.bargeInSpeechMs = 0;
  state.bargeInNoiseFloor = 0.008;
  state.bargeInCalibratingUntil = Date.now() + BARGE_IN.RMS_CALIBRATE_MS;

  state.bargeInTimer = setInterval(() => {
    if (state.mode !== "speaking" && state.mode !== "thinking") {
      stopBargeInMonitor();
      return;
    }
    const now = Date.now();
    if (now < state.bargeInCooldownUntil) return;
    if (now - state.speakingStartedAt < BARGE_IN.GRACE_AFTER_SPEAK_MS) return;

    const rms = measureMicRms(analyser);
    if (now < state.bargeInCalibratingUntil) {
      state.bargeInNoiseFloor = Math.max(state.bargeInNoiseFloor, Math.min(rms, 0.022));
      return;
    }

    const threshold = Math.max(
      BARGE_IN.RMS_MIN_ABS,
      state.bargeInNoiseFloor * BARGE_IN.RMS_NOISE_MULT,
    );

    if (rms >= threshold) {
      state.bargeInSpeechMs += BARGE_IN.RMS_POLL_MS;
      if (state.bargeInSpeechMs >= BARGE_IN.RMS_SUSTAIN_MS) {
        state.bargeInSpeechMs = 0;
        state.bargeInCooldownUntil = now + BARGE_IN.COOLDOWN_MS;
        interruptAndListen();
      }
    } else {
      state.bargeInSpeechMs = Math.max(0, state.bargeInSpeechMs - BARGE_IN.RMS_DECAY_MS);
    }
  }, BARGE_IN.RMS_POLL_MS);
}

function interruptAndListen() {
  if (state.mode === "listening") return;
  if (state.interruptInFlight) return;
  state.interruptInFlight = true;
  state.conversationActive = true;
  hardStopSpeech();
  setMode("listening");
  setStatusForMode("listening", "Listening…");
  void startListening({ afterInterrupt: true }).finally(() => {
    state.interruptInFlight = false;
  });
}

function stopCurrentTurn(options = {}) {
  const { reopenMic = false } = options;
  hardStopSpeech();
  stopListening();
  setCaption("");
  updateWakeStatus();
  if (reopenMic) void startListening();
}

function stopListening() {
  const rec = state.mediaRecorder;
  state.mediaRecorder = null;
  if (rec && rec.state !== "inactive") {
    try {
      if (rec.state === "recording") rec.requestData();
      rec.stop();
    } catch (_) {}
  }
  stopVadMonitor();
}

/** Flush and stop MediaRecorder before tearing down the VAD AudioContext (same mic stream). */
function finalizeMediaRecording(recorder, chunks) {
  if (!recorder || recorder.state === "inactive") {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      resolve(blob.size > 0 ? blob : null);
    };
    try {
      if (recorder.state === "recording") recorder.requestData();
      recorder.stop();
    } catch (_) {
      resolve(null);
    }
  });
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

function shouldUseLiveStt() {
  return !!(state.serverStreamingStt && state.liveClient?.ready && state.liveClient.streamingStt);
}

function shouldStreamPcmToServer() {
  return shouldUseLiveStt() && state.mode === "listening" && !state.wsTurnActive;
}

function shouldUseServerEndpointing() {
  return shouldUseLiveStt();
}

function stopListeningOnly() {
  const rec = state.mediaRecorder;
  state.mediaRecorder = null;
  if (rec && rec.state !== "inactive") {
    try {
      if (rec.state === "recording") rec.requestData();
      rec.stop();
    } catch (_) {}
  }
  stopVadMonitor();
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
  analyser.smoothingTimeConstant = 0.62;
  source.connect(analyser);

  state.vadAudioCtx = ctx;
  state.vadAnalyser = analyser;
  state.useServerEndpointing = shouldUseServerEndpointing();

  if (shouldStreamPcmToServer() && typeof float32To16kPcm === "function") {
    const inputRate = ctx.sampleRate || 48000;
    const pcmNode = ctx.createScriptProcessor(2048, 1, 1);
    pcmNode.onaudioprocess = (ev) => {
      if (state.mode !== "listening" || !state.liveClient?.ready) return;
      const input = ev.inputBuffer.getChannelData(0);
      state.liveClient.sendAudio(float32To16kPcm(input, inputRate));
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
    maxPostSpeechSilenceMs: VAD.MAX_POST_SPEECH_SILENCE_MS,
    speechStartFrames: VAD.SPEECH_START_FRAMES,
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

    if (state.useServerEndpointing) {
      if (result === "cancel") void cancelListening();
      return;
    }

    if (
      state.endpointer.speechDetected &&
      state.endpointer.lastSpeechAt > 0 &&
      now - state.endpointer.lastSpeechAt >= LISTEN_STUCK_SILENCE_MS
    ) {
      void stopListeningAndSend();
      return;
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
      body: JSON.stringify({
        session_id: store.sessionId || null,
        thread_id: store.threadId || null,
        surface: orbSurface(),
      }),
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

async function startListening(options = {}) {
  const afterInterrupt = !!options.afterInterrupt;
  const soft = !!options.soft;
  if (state.mode === "listening" && !afterInterrupt) return;

  stopWakeListenStream();
  stopSemanticBargeIn();
  if (soft) {
    stopListening();
  } else if (!afterInterrupt) {
    hardStopSpeech();
    stopListening();
  }

  if (!isAccountLinked()) {
    if (store.token) {
      const ok = await refreshLinkState();
      if (!ok) {
        setMode("idle");
        flashCaption("Session expired — click Connect in settings.", 3200);
        openSettings(true);
        return;
      }
    } else {
      setMode("idle");
      flashCaption("Connect your Briefly account first (gear icon).", 2800);
      openSettings(true);
      return;
    }
  }

  setMode("listening");
  setStatusForMode("listening", "Listening…");
  state.audioChunks = [];
  state.listeningStartedAt = Date.now();
  void primeAudioPlayback();
  void showWindow();

  try {
    const [, stream] = await Promise.all([ensureLiveSession(), ensureMic()]);
    if (state.mode !== "listening") return;

    // Open the mic immediately — don't wait for STT session prep.
    startVadMonitor(stream);

    if (state.liveClient?.ready) {
      await state.liveClient.prepareListen();
    }
    if (state.mode !== "listening") return;

    state.liveSttActive = shouldUseLiveStt();
    if (!state.liveSttActive && !state.mediaRecorder) {
      const opts = {};
      const mimeType = chooseMimeType();
      if (mimeType) opts.mimeType = mimeType;
      const recorder = new MediaRecorder(stream, opts);
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) state.audioChunks.push(e.data);
      };
      recorder.start(250);
      state.mediaRecorder = recorder;
    } else if (state.liveSttActive && state.mediaRecorder) {
      stopListeningOnly();
    }
    startVadMonitor(stream);
  } catch (_) {
    setMode("idle");
    flashCaption("Microphone access was blocked.", 2500);
  }
}

async function stopListeningAndSend() {
  if (state.mode !== "listening" || state.sendingUtterance || state.wsTurnActive) return;

  if (state.useServerEndpointing && state.liveClient?.ready) {
    state.sendingUtterance = true;
    state.liveClient.sendEndUtterance();
    setStatusForMode("listening", "Processing…");
    stopListeningOnly();
    armWsTurnWatchdog();
    return;
  }

  // Prefer live STT — don't upload a corrupt batch recording if WS is up but STT isn't ready yet.
  if (state.liveClient?.ready && state.serverStreamingStt === false) {
    state.sendingUtterance = false;
    flashCaption("Reconnecting live speech…", 1600);
    void state.liveClient.prepareListen().then((ok) => {
      state.serverStreamingStt = !!ok;
      if (ok && state.conversationActive) void startListening();
    });
    stopListeningOnly();
    setMode("idle");
    return;
  }

  if (state.endpointer && !state.endpointer.speechDetected) {
    void cancelListening();
    return;
  }
  state.sendingUtterance = true;
  const recorder = state.mediaRecorder;
  const chunks = state.audioChunks;
  state.mediaRecorder = null;
  const elapsed = Date.now() - state.listeningStartedAt;
  if (!recorder) {
    state.sendingUtterance = false;
    stopVadMonitor();
    setMode("idle");
    return;
  }
  const blob = await finalizeMediaRecording(recorder, chunks);
  stopVadMonitor();
  state.sendingUtterance = false;

  if (elapsed < 120 || !blob || blob.size < 800) {
    state.sendingUtterance = false;
    setMode("idle");
    flashCaption("Didn't catch that — try again.", 1400);
    if (state.conversationActive && !state.conversationMuted) {
      await continueConversationAfterSpeak();
    }
    return;
  }

  state.conversationActive = true;
  await executeTurn(async (signal) => apiTurn(blob, signal));
}

async function cancelListening() {
  if (state.mode !== "listening") return;
  stopListening();
  setMode("idle");
  flashCaption("Cancelled.", 900);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function continueConversationAfterSpeak(turn) {
  if (state.conversationMuted) return;
  if (!state.conversationActive) state.conversationActive = true;
  const generation = state.conversationGeneration;
  if (LISTEN_REOPEN_DELAY_MS > 0) {
    await sleep(LISTEN_REOPEN_DELAY_MS);
    if (generation !== state.conversationGeneration) return;
    if (state.mode !== "idle" || state.conversationMuted) return;
  }
  flashCaption("Listening…", 900);
  await startListening({ soft: true });
}

function normalizeCommandText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\w\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Local voice commands — obey immediately without waiting for the LLM. */
function matchVoiceCommand(text) {
  const n = normalizeCommandText(text);
  if (!n) return null;
  if (/\b(that s all|thats all|we re done|we are done|goodbye|bye briefly|stop listening|go away|leave me alone)\b/.test(n)) {
    return "end_conversation";
  }
  if (/\b(mute|be quiet|keep quiet|stay quiet|silence|stop talking|quiet down|shut up|don t speak|do not speak|hold on|hold your tongue)\b/.test(n)) {
    return "mute";
  }
  if (/\b(unmute|start listening|listen again|you can talk|speak again)\b/.test(n)) {
    return "unmute";
  }
  if (/\b(cancel|never mind|nevermind|forget it|stop that|scratch that)\b/.test(n)) {
    return "cancel";
  }
  if (/\b(mute wake|turn off wake|disable wake|stop wake word)\b/.test(n)) {
    return "mute_wake";
  }
  if (/\b(mute proactive|stop interrupting|don t interrupt|no interruptions)\b/.test(n)) {
    return "mute_proactive";
  }
  return null;
}

async function applyVoiceCommand(cmd) {
  switch (cmd) {
    case "end_conversation":
      state.conversationActive = false;
      state.conversationMuted = false;
      state.lastAssistantAnswer = "";
      store.threadId = "";
      store.sessionId = "";
      stopCurrentTurn();
      flashCaption("Got it. Say \"hey briefly\" when you need me.", 2800);
      scheduleWakeListenRestart(500);
      return;
    case "mute":
      state.conversationMuted = true;
      store.proactiveEnabled = false;
      updateProactiveStatus();
      stopCurrentTurn();
      flashCaption("Quiet mode — I won't speak unless you ask.", 3200);
      return;
    case "unmute":
      state.conversationMuted = false;
      store.proactiveEnabled = true;
      updateProactiveStatus();
      state.conversationActive = true;
      flashCaption("Back on — I'm listening.", 2200);
      await startListening();
      return;
    case "cancel":
      stopCurrentTurn();
      flashCaption("Cancelled.", 900);
      return;
    case "mute_wake":
      store.wakeMuted = true;
      stopWakeWord();
      updateWakeStatus();
      flashCaption("Wake word muted.", 2000);
      return;
    case "mute_proactive":
      store.proactiveEnabled = false;
      updateProactiveStatus();
      flashCaption("Proactive voice off.", 2000);
      return;
    default:
      return;
  }
}

async function executeTurn(turnFactory) {
  setMode("thinking");
  state.turnAbortReason = null;
  const turnAbort = new AbortController();
  state.turnAbort = turnAbort;
  state.turnTimeoutHandle = setTimeout(() => {
    state.turnAbortReason = "timeout";
    turnAbort.abort();
  }, TURN_TIMEOUT_MS);
  try {
    const turn = await turnFactory(turnAbort.signal);
    if (state.turnTimeoutHandle) {
      clearTimeout(state.turnTimeoutHandle);
      state.turnTimeoutHandle = null;
    }
    state.turnAbort = null;
    state.turnAbortReason = null;
    if (!turn) {
      if (turnAbort.signal.aborted) {
        setMode("idle");
        return;
      }
      throw new Error("No response from server");
    }
    state.turnFailureCount = 0;
    applyTurnMeta(turn);
    const transcript = (turn?.transcript || "").trim();
    const voiceCmd = matchVoiceCommand(transcript);
    if (voiceCmd) {
      await applyVoiceCommand(voiceCmd);
      return;
    }
    if (turn?._ttsPlayed) {
      if (state.conversationMuted) {
        setMode("idle");
        return;
      }
      await continueConversationAfterSpeak(turn);
      return;
    }
    const answer = (turn && turn.answer ? String(turn.answer) : "").trim();
    if (!answer) throw new Error("No answer");
    const trace = Array.isArray(turn?.tool_trace) ? turn.tool_trace : [];
    if (trace.length) {
      const names = trace.map((t) => String(t.tool || "")).filter(Boolean).join(" + ");
      if (names) setStatusForMode("thinking", truncateStatus(`Using ${names}`, 48));
    }
    if (state.conversationMuted) {
      setMode("idle");
      flashCaption("Muted — say \"unmute\" or tap to talk.", 2800);
      return;
    }
    if (!turn._ttsPlayed) {
      await playTts(answer);
    }
    if (turnAbort.signal.aborted) return;
    await continueConversationAfterSpeak(turn);
  } catch (err) {
    if (state.turnTimeoutHandle) {
      clearTimeout(state.turnTimeoutHandle);
      state.turnTimeoutHandle = null;
    }
    const reason = state.turnAbortReason;
    state.turnAbort = null;
    state.turnAbortReason = null;
    if (turnAbort.signal.aborted) {
      setMode("idle");
      if (reason === "timeout") {
        flashCaption("That took too long — try again.", 2800);
      }
      return;
    }
    state.turnFailureCount += 1;
    setMode("idle");
    const msg = err instanceof Error ? err.message : "Turn failed.";
    if (/failed to fetch|networkerror/i.test(msg)) {
      flashCaption("Can't reach API — check connection.", 2800);
    } else if (/playback|audio/i.test(msg)) {
      flashCaption("Couldn't play audio — tap the orb and try again.", 3200);
    } else {
      flashCaption(truncateStatus(msg, 72), 2800);
    }
    if (
      state.conversationActive &&
      !state.conversationMuted &&
      state.turnFailureCount <= MAX_TURN_FAILURE_RETRIES
    ) {
      await continueConversationAfterSpeak();
    } else if (state.turnFailureCount > MAX_TURN_FAILURE_RETRIES) {
      flashCaption("Tap the orb when you're ready to talk.", 2800);
    }
  }
}

async function playTts(text) {
  const speakAbort = new AbortController();
  state.speakAbort = speakAbort;
  setMode("thinking");
  setStatusForMode("thinking", "Preparing voice…");
  let spoke = false;
  try {
    await playAnswerTts({
      text,
      speakFn: apiSpeakToBlob,
      speakStreamFn: apiSpeakStreamToBlob,
      signal: speakAbort.signal,
      prefetch: 3,
      onAudio: (audio) => {
        state.ttsAudio = audio;
      },
      onSpeakingStart: () => {
        if (!spoke) {
          spoke = true;
          setMode("speaking");
        }
      },
    });
  } catch (err) {
    if (!speakAbort.signal.aborted) {
      setMode("idle");
      throw err;
    }
  }
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
    interruptAndListen();
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
  stopWakeListenStream();
}

function onWakePhraseHeard(transcript) {
  if (state.mode === "listening") return;
  const matched = wakePhraseMatched(transcript);
  if (state.mode === "speaking" || state.mode === "thinking") {
    if (matched) interruptAndListen();
    return;
  }
  if (state.mode !== "idle") return;
  if (!matched && transcript) return;
  stopWakeListenStream();
  state.conversationActive = true;
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
      if (state.mode !== "idle") return false;
      if (state.wakeListenActive) return false;
      return true;
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
  void startWakeListenStream();
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
    onWakePhraseHeard(transcript);
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
            onWakePhraseHeard("hey briefly");
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
    if (state.mode === "idle" && store.wakeEnabled && !store.wakeMuted) {
      void startWakeListenStream();
    }
  };

  state.liveClient.onSttReady = (frame) => {
    state.serverStreamingStt = !!frame.streaming_stt;
    state.liveListenMode = frame.listen_mode || state.liveListenMode;
  };

  state.liveClient.onWakeDetected = (text) => {
    onWakePhraseHeard(text || "hey briefly");
    scheduleWakeListenRestart(600);
  };

  state.liveClient.onBargeInPartial = (text, isFinal) => {
    if (state.mode !== "speaking" && state.mode !== "thinking") return;
    if (Date.now() - state.speakingStartedAt < BARGE_IN.GRACE_AFTER_SPEAK_MS) return;
    if (Date.now() < state.bargeInCooldownUntil) return;
    if (!looksLikeUserBargeIn(text, isFinal)) return;
    state.bargeInCooldownUntil = Date.now() + BARGE_IN.COOLDOWN_MS;
    interruptAndListen();
  };

  state.liveClient.onBargeInDetected = (text) => {
    if (state.mode !== "speaking" && state.mode !== "thinking") return;
    if (Date.now() < state.bargeInCooldownUntil) return;
    if (!looksLikeUserBargeIn(text, true)) return;
    state.bargeInCooldownUntil = Date.now() + BARGE_IN.COOLDOWN_MS;
    interruptAndListen();
  };

  state.liveClient.onDisconnected = () => {
    state.serverStreamingStt = false;
    if (state.mode === "listening" && state.liveSttActive) {
      flashCaption("Reconnecting live session…", 1600);
    }
  };

  state.liveClient.onPartialTranscript = (text, isFinal) => {
    if (state.mode === "listening") {
      if (text) state.vadHasSpeech = true;
      setStatusForMode("listening", truncateStatus(text, 48));
      return;
    }
    if (state.mode === "speaking" || state.mode === "thinking") {
      if (looksLikeUserBargeIn(text, isFinal)) {
        if (Date.now() >= state.bargeInCooldownUntil
            && Date.now() - state.speakingStartedAt >= BARGE_IN.GRACE_AFTER_SPEAK_MS) {
          state.bargeInCooldownUntil = Date.now() + BARGE_IN.COOLDOWN_MS;
          interruptAndListen();
        }
      }
      return;
    }
    if (isFinal && state.mode === "thinking") {
      const cmd = matchVoiceCommand(text);
      if (cmd) {
        void applyVoiceCommand(cmd);
        return;
      }
    }
    if (
      state.mode === "idle" &&
      store.wakeEnabled &&
      !store.wakeMuted &&
      wakePhraseMatched(text)
    ) {
      onWakePhraseHeard(text);
    }
  };

  state.liveClient.onSpeechFinal = () => {
    if (state.mode !== "listening" || state.wsTurnActive) return;
    state.sendingUtterance = true;
    setStatusForMode("listening", "Processing…");
    stopListeningOnly();
    armWsTurnWatchdog();
  };

  state.liveClient.onTurnStart = () => {
    clearWsTurnWatchdog();
    abortHttpTurn("user");
    state.activeTurnEpoch += 1;
    state.currentTurnEpoch = state.activeTurnEpoch;
    const turnEpoch = state.currentTurnEpoch;
    state.wsTurnActive = true;
    state.sendingUtterance = false;
    state.agentSpokenText = "";
    state.speakingStartedAt = Date.now();
    stopListeningOnly();
    if (typeof stopAllPlayback === "function") stopAllPlayback();
    if (state.wsTurnSpeaker) {
      state.wsTurnSpeaker.abort();
      state.wsTurnSpeaker = null;
    }
    setMode("thinking");

    const speakAbort = new AbortController();
    state.speakAbort = speakAbort;
    state.wsTurnSpeaker = createDeltaStreamingSpeaker({
      speakFn: apiSpeakToBlob,
      speakStreamFn: apiSpeakStreamToBlob,
      signal: speakAbort.signal,
      onAudio: (audio) => { state.ttsAudio = audio; },
      onSpeakingStart: () => {
        if (turnEpoch === state.currentTurnEpoch) setMode("speaking");
      },
    });
  };

  state.liveClient.onTurnMeta = (meta) => {
    applyTurnMeta(meta);
  };

  state.liveClient.onTurnDelta = (content) => {
    if (content) state.agentSpokenText += content;
    if (state.wsTurnSpeaker && content && state.currentTurnEpoch === state.activeTurnEpoch) {
      state.wsTurnSpeaker.pushDelta(content);
    }
  };

  state.liveClient.onTurnComplete = async (turn) => {
    clearWsTurnWatchdog();
    const turnEpoch = state.currentTurnEpoch;
    if (turnEpoch !== state.activeTurnEpoch) return;

    applyTurnMeta(turn);
    const transcript = (turn?.transcript || "").trim();
    const voiceCmd = matchVoiceCommand(transcript);
    if (voiceCmd) {
      state.wsTurnActive = false;
      state.sendingUtterance = false;
      if (state.wsTurnSpeaker) {
        state.wsTurnSpeaker.abort();
        state.wsTurnSpeaker = null;
      }
      state.speakAbort = null;
      await applyVoiceCommand(voiceCmd);
      return;
    }
    try {
      if (
        turnEpoch !== state.activeTurnEpoch ||
        turnEpoch !== state.currentTurnEpoch
      ) {
        if (state.wsTurnSpeaker) {
          state.wsTurnSpeaker.abort();
          state.wsTurnSpeaker = null;
        }
        return;
      }
      if (
        turnEpoch === state.currentTurnEpoch &&
        state.wsTurnSpeaker &&
        !state.conversationMuted &&
        turn?.answer
      ) {
        await state.wsTurnSpeaker.finish(turn);
      } else if (turnEpoch === state.currentTurnEpoch && turn?.answer && !state.conversationMuted) {
        await playTts(turn.answer);
      } else if (turnEpoch === state.currentTurnEpoch) {
        setMode("idle");
      }
    } catch (_) {
      if (turnEpoch !== state.activeTurnEpoch) return;
      if (turnEpoch === state.currentTurnEpoch && turn?.answer && !state.conversationMuted) {
        await playTts(turn.answer);
      }
    }
    if (turnEpoch !== state.currentTurnEpoch) return;
    state.wsTurnSpeaker = null;
    state.speakAbort = null;
    state.ttsAudio = null;
    state.wsTurnActive = false;
    state.sendingUtterance = false;
    state.turnFailureCount = 0;
    if (state.conversationMuted) return;
    state.conversationActive = true;
    await continueConversationAfterSpeak(turn);
  };

  state.liveClient.onTurnEnd = () => {
    /* lifecycle completed in onTurnComplete */
  };

  state.liveClient.onError = (message) => {
    clearWsTurnWatchdog();
    state.sendingUtterance = false;
    const msg = String(message || "");
    if (msg.toLowerCase().includes("unauthorized")) {
      try { localStorage.setItem("briefly.orbLiveSession", "0"); } catch (_) {}
    }
    if (state.wsTurnActive || state.sendingUtterance) {
      state.wsTurnActive = false;
      state.sendingUtterance = false;
      if (state.wsTurnSpeaker) {
        state.wsTurnSpeaker.abort();
        state.wsTurnSpeaker = null;
      }
      state.speakAbort = null;
      setMode("idle");
      flashCaption(msg || "Something went wrong — tap to try again.", 2600);
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
    void primeAudioPlayback();
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
    const cmd = matchVoiceCommand(text);
    if (cmd) {
      void applyVoiceCommand(cmd);
      return;
    }
    stopCurrentTurn();
    state.conversationActive = true;
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
