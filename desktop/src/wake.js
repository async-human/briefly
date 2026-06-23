"use strict";

/**
 * Mic-based wake phrase detection for the Tauri desktop orb.
 * Web Speech API is unavailable in WebView2, so we listen via RMS VAD,
 * record a short clip, and verify the phrase server-side (STT only).
 */

function normalizeWakeTranscript(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function transcriptMatchesWakePhrase(text) {
  const norm = normalizeWakeTranscript(text);
  if (!norm) return false;
  const phrases = [
    "hey briefly",
    "hi briefly",
    "hay briefly",
    "a briefly",
    "hey brief",
    "hi brief",
    "hey briefley",
    "hey brieflee",
    "hey breifly",
  ];
  if (phrases.some((p) => norm.includes(p))) return true;
  const words = norm.split(" ");
  for (let i = 0; i < words.length; i += 1) {
    if (["hey", "hi", "hay", "a"].includes(words[i])) {
      if (words.slice(i, i + 4).includes("briefly")) return true;
    }
  }
  return false;
}

class MicWakeMonitor {
  constructor(options) {
    this.getStream = options.getStream;
    this.checkWake = options.checkWake;
    this.onWake = options.onWake;
    this.isIdle = options.isIdle;
    this.measureRms = options.measureRms;
    this.chooseMimeType = options.chooseMimeType;
    this.pollMs = options.pollMs ?? 72;
    this.cooldownMs = options.cooldownMs ?? 2200;
    this.maxClipMs = options.maxClipMs ?? 3200;

    this.active = false;
    this.pollTimer = null;
    this.monitorCtx = null;
    this.monitorAnalyser = null;
    this.busy = false;
    this.cooldownUntil = 0;
    this.speechActive = false;
    this.speechStartedAt = 0;
    this.lastSpeechAt = 0;
    this.noiseFloor = 0.004;
  }

  async start() {
    this.stop();
    this.active = true;
    try {
      const stream = await this.getStream();
      this.monitorCtx = new AudioContext();
      const source = this.monitorCtx.createMediaStreamSource(stream);
      this.monitorAnalyser = this.monitorCtx.createAnalyser();
      this.monitorAnalyser.fftSize = 512;
      source.connect(this.monitorAnalyser);
      this.noiseFloor = 0.004;
      this.pollTimer = setInterval(() => this._poll(), this.pollMs);
    } catch (_) {
      this.active = false;
    }
  }

  stop() {
    this.active = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.monitorCtx) {
      try { this.monitorCtx.close(); } catch (_) {}
      this.monitorCtx = null;
    }
    this.monitorAnalyser = null;
    this.speechActive = false;
    this.busy = false;
  }

  _startThreshold() {
    return Math.max(0.012, this.noiseFloor * 3.4);
  }

  _continueThreshold() {
    return Math.max(0.009, this.noiseFloor * 2.2);
  }

  _poll() {
    if (!this.active || this.busy || !this.monitorAnalyser) return;
    if (!this.isIdle()) {
      this.speechActive = false;
      return;
    }
    if (Date.now() < this.cooldownUntil) return;

    const now = Date.now();
    const rms = this.measureRms(this.monitorAnalyser);
    const threshold = this.speechActive ? this._continueThreshold() : this._startThreshold();
    const speaking = rms > threshold;

    if (speaking) {
      if (!this.speechActive) {
        this.speechActive = true;
        this.speechStartedAt = now;
      }
      this.lastSpeechAt = now;
      this.noiseFloor = this.noiseFloor * 0.92 + rms * 0.08;
      return;
    }

    if (!this.speechActive) {
      this.noiseFloor = this.noiseFloor * 0.97 + rms * 0.03;
      return;
    }

    const silenceMs = now - this.lastSpeechAt;
    const speechMs = this.lastSpeechAt - this.speechStartedAt;
    const elapsed = now - this.speechStartedAt;
    const ended =
      (silenceMs >= 520 && speechMs >= 280) ||
      elapsed >= this.maxClipMs;

    if (!ended) return;

    this.speechActive = false;
    void this._captureAndCheck();
  }

  async _captureAndCheck() {
    if (this.busy || !this.active || !this.isIdle()) return;
    this.busy = true;
    try {
      const stream = await this.getStream();
      const blob = await this._recordClip(stream);
      if (!blob || blob.size < 700) return;
      const result = await this.checkWake(blob);
      if (result?.wake || transcriptMatchesWakePhrase(result?.transcript)) {
        this.cooldownUntil = Date.now() + this.cooldownMs;
        this.onWake(result?.transcript || "");
      }
    } catch (_) {
      // Mic or network hiccup — keep listening.
    } finally {
      this.busy = false;
    }
  }

  async _recordClip(stream) {
    return new Promise((resolve) => {
      const chunks = [];
      const opts = {};
      const mimeType = this.chooseMimeType();
      if (mimeType) opts.mimeType = mimeType;
      const recorder = new MediaRecorder(stream, opts);
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      const endpointer = new SpeechEndpointer({
        pollMs: 64,
        baseSilenceMs: 520,
        minSpeechMs: 260,
        minListenMs: 300,
        hangoverMs: 260,
        calibrateMs: 350,
        minSpeechRms: 0.01,
      });

      const startedAt = Date.now();
      endpointer.begin(startedAt);
      recorder.start(120);

      const timer = setInterval(() => {
        const now = Date.now();
        if (now - startedAt > this.maxClipMs) {
          finish();
          return;
        }
        const action = endpointer.feed(this.measureRms(analyser), now);
        if (action === "end") finish();
      }, 64);

      const finish = () => {
        clearInterval(timer);
        recorder.onstop = () => {
          try { ctx.close(); } catch (_) {}
          resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
        };
        if (recorder.state !== "inactive") recorder.stop();
        else resolve(null);
      };
    });
  }
}
