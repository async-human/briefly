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
  get lastSpoken() {
    return localStorage.getItem("briefly.lastSpoken") || "";
  },
  set lastSpoken(v) {
    localStorage.setItem("briefly.lastSpoken", v);
  },
};

const todayKey = () => new Date().toISOString().slice(0, 10);

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

async function loadBriefing() {
  const [me, digest] = await Promise.all([
    apiGet("/api/v1/me").catch(() => null),
    apiGet("/api/v1/digests/today").catch(() => null),
  ]);
  return { me, digest };
}

// ── Spoken script ───────────────────────────────────────────────────────────
function firstName(me) {
  const n = me?.user?.name || me?.name || "";
  return n ? n.split(" ")[0] : "";
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function buildScript(me, digest) {
  const name = firstName(me);
  const hi = greeting() + (name ? `, ${name}` : "") + ".";
  const items = (digest && digest.items) || [];

  if (items.length === 0) {
    return [
      hi,
      "Your briefing isn't ready just yet. Open Briefly to finish connecting your sources, and I'll have it for you soon.",
    ];
  }

  const top = items.slice(0, 3);
  const lines = [hi];
  const count = digest.total_items_shown || items.length;
  lines.push(`Here's your briefing. ${count} ${count === 1 ? "thing" : "things"} matter today.`);

  const ordinals = ["First", "Second", "Third"];
  top.forEach((it, i) => {
    lines.push(`${ordinals[i] || ""}. ${it.headline}.`.trim());
    const why = it.why_this_summary || it.why_it_matters;
    if (why) lines.push(why);
  });

  lines.push("That's the headline view. Open Briefly for the full briefing.");
  return lines;
}

// ── Voice ───────────────────────────────────────────────────────────────────
let speaking = false;

function pickVoice() {
  const vs = window.speechSynthesis ? speechSynthesis.getVoices() : [];
  return (
    vs.find((v) => /en(-|_)?(US|GB)/i.test(v.lang) && /natural|google|samantha|aria|jenny|libby/i.test(v.name)) ||
    vs.find((v) => /^en/i.test(v.lang)) ||
    vs[0]
  );
}

function speakLine(line) {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(line);
    const v = pickVoice();
    if (v) u.voice = v;
    u.rate = 1.0;
    u.pitch = 1.0;
    u.onstart = () => setCaption(line);
    u.onboundary = () => bumpEnergy();
    u.onend = resolve;
    u.onerror = resolve;
    speechSynthesis.speak(u);
  });
}

async function speakLines(lines) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  await showWindow();
  setSpeaking(true);
  for (const line of lines) {
    if (!speaking) break;
    await speakLine(line);
  }
  setSpeaking(false);
  setCaption("");
}

function stopSpeaking() {
  speaking = false;
  try {
    speechSynthesis.cancel();
  } catch (_) {}
  setSpeaking(false);
  setCaption("");
}

async function speakBriefing() {
  if (speaking) {
    stopSpeaking();
    return;
  }
  if (!store.token) {
    await showWindow();
    await speakLines([
      greeting() + ".",
      "Welcome to Briefly. Open settings and paste your access token, and I'll read you your morning briefing.",
    ]);
    openSettings(true);
    return;
  }
  setCaption("Fetching your briefing…");
  try {
    const { me, digest } = await loadBriefing();
    await speakLines(buildScript(me, digest));
    store.lastSpoken = todayKey();
  } catch (_) {
    await speakLines(["I couldn't reach Briefly just now. I'll try again a little later."]);
  }
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
function setSpeaking(on) {
  speaking = on;
  energyTarget = on ? 0.5 : 0.06;
  document.body.classList.toggle("is-speaking", on);
}
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

  // Warm up speech voices (they load asynchronously).
  if (window.speechSynthesis) {
    speechSynthesis.getVoices();
    speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
  }

  document.getElementById("orb-hit").addEventListener("click", () => speakBriefing());
  document.getElementById("replay").addEventListener("click", () => speakBriefing());
  document.getElementById("gear").addEventListener("click", () => openSettings());
  document.getElementById("hide").addEventListener("click", () => {
    stopSpeaking();
    hideWindow();
  });
  document.getElementById("save").addEventListener("click", () => {
    store.apiBase = document.getElementById("apiBase").value.trim();
    store.token = document.getElementById("token").value.trim();
    openSettings(false);
    setCaption("Saved. Click the orb to hear your briefing.");
    setTimeout(() => setCaption(""), 3500);
  });

  // Tray "Speak my briefing" → frontend.
  if (TAURI?.event) {
    TAURI.event.listen("speak-briefing", () => speakBriefing());
  }

  // First unlock of the day: greet + speak once, automatically.
  if (store.token && store.lastSpoken !== todayKey()) {
    setTimeout(() => speakBriefing(), 1500);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
