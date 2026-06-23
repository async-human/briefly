"use strict";

/**
 * Mic-based wake phrase detection for the Tauri desktop orb.
 * Records audio *while* speech is detected, then verifies via server STT.
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

async function resumeAudioContext(ctx) {
  if (!ctx || ctx.state === "closed") return;
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch (_) {}
  }
}

class MicWakeMonitor {
  constructor(options) {
    this.getStream = options.getStream;
    this.checkWake = options.checkWake;
    this.onWake = options.onWake;
    this.onError = options.onError || null;
    this.isIdle = options.isIdle;
    this.measureRms = options.measureRms;
    this.chooseMimeType = options.chooseMimeType;
    this.pollMs = options.pollMs ?? 72;
    this.cooldownMs = options.cooldownMs ?? 2200;
    this.maxClipMs = options.maxClipMs ?? 4000;

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
    this.recorder = null;
    this.recordChunks = [];
    this.micStream = null;
  }

  async ensureAudioRunning() {
    await resumeAudioContext(this.monitorCtx);
  }

  async start() {
    this.stop();
    this.active = true;
    try {
      this.micStream = await this.getStream();
      this.monitorCtx = new AudioContext();
      await resumeAudioContext(this.monitorCtx);
      const source = this.monitorCtx.createMediaStreamSource(this.micStream);
      this.monitorAnalyser = this.monitorCtx.createAnalyser();
      this.monitorAnalyser.fftSize = 512;
      source.connect(this.monitorAnalyser);
      this.noiseFloor = 0.004;
      this.pollTimer = setInterval(() => this._poll(), this.pollMs);
    } catch (err) {
      this.active = false;
      if (this.onError) this.onError("mic", err);
    }
  }

  stop() {
    this.active = false;
    this._stopRecording();
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
    this.micStream = null;
  }

  _startThreshold() {
    return Math.max(0.009, this.noiseFloor * 2.8);
  }

  _continueThreshold() {
    return Math.max(0.007, this.noiseFloor * 1.9);
  }

  _beginRecording() {
    if (!this.micStream || (this.recorder && this.recorder.state === "recording")) return;
    this.recordChunks = [];
    const opts = {};
    const mimeType = this.chooseMimeType();
    if (mimeType) opts.mimeType = mimeType;
    try {
      this.recorder = new MediaRecorder(this.micStream, opts);
      this.recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) this.recordChunks.push(e.data);
      };
      this.recorder.start(120);
    } catch (err) {
      this.recorder = null;
      if (this.onError) this.onError("record", err);
    }
  }

  _stopRecording() {
    const rec = this.recorder;
    this.recorder = null;
    if (!rec || rec.state === "inactive") {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      rec.onstop = () => {
        const blob = new Blob(this.recordChunks, { type: rec.mimeType || "audio/webm" });
        this.recordChunks = [];
        resolve(blob.size > 0 ? blob : null);
      };
      try {
        rec.stop();
      } catch (_) {
        resolve(null);
      }
    });
  }

  _poll() {
    if (!this.active || this.busy || !this.monitorAnalyser) return;
    if (!this.isIdle()) {
      if (this.speechActive) {
        this.speechActive = false;
        void this._stopRecording();
      }
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
        this._beginRecording();
      }
      this.lastSpeechAt = now;
      this.noiseFloor = this.noiseFloor * 0.92 + rms * 0.08;
      if (now - this.speechStartedAt >= this.maxClipMs) {
        this.speechActive = false;
        void this._finishRecordingAndCheck();
      }
      return;
    }

    if (!this.speechActive) {
      this.noiseFloor = this.noiseFloor * 0.97 + rms * 0.03;
      return;
    }

    const silenceMs = now - this.lastSpeechAt;
    const speechMs = this.lastSpeechAt - this.speechStartedAt;
    if (silenceMs >= 480 && speechMs >= 240) {
      this.speechActive = false;
      void this._finishRecordingAndCheck();
    }
  }

  async _finishRecordingAndCheck() {
    if (this.busy || !this.active || !this.isIdle()) return;
    this.busy = true;
    try {
      const blob = await this._stopRecording();
      if (!blob || blob.size < 600) return;
      const result = await this.checkWake(blob);
      if (result?.wake || transcriptMatchesWakePhrase(result?.transcript)) {
        this.cooldownUntil = Date.now() + this.cooldownMs;
        this.onWake(result?.transcript || "");
      }
    } catch (err) {
      if (this.onError) this.onError("check", err);
    } finally {
      this.busy = false;
    }
  }
}
