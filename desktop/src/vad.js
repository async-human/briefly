"use strict";

/**
 * Robust speech endpointer — hysteresis, hangover, adaptive silence, and
 * consecutive-frame gating. Modeled after realtime API turn detection (wait
 * for a real pause, not a brief dip between words).
 */
class SpeechEndpointer {
  constructor(options = {}) {
    this.pollMs = options.pollMs ?? 48;
    this.baseSilenceMs = options.baseSilenceMs ?? 2200;
    this.maxAdaptiveSilenceMs = options.maxAdaptiveSilenceMs ?? 900;
    this.minSpeechMs = options.minSpeechMs ?? 700;
    this.hangoverMs = options.hangoverMs ?? 520;
    this.calibrateMs = options.calibrateMs ?? 650;
    this.minListenMs = options.minListenMs ?? 900;
    this.startMultiplier = options.startMultiplier ?? 3.6;
    this.continueMultiplier = options.continueMultiplier ?? 2.15;
    this.minSpeechRms = options.minSpeechRms ?? 0.011;

    this.noiseFloor = 0.004;
    this.calibratingUntil = 0;
    this.listeningStartedAt = 0;
    this.hasSpeech = false;
    this.inSpeech = false;
    this.speechStartedAt = 0;
    this.lastSpeechAt = 0;
    this.peakRms = 0;
    this.consecutiveSilentFrames = 0;
    this.consecutiveSpeechFrames = 0;
    this.minSpeechFrames = Math.ceil(this.minSpeechMs / this.pollMs);
    this.framesRequiredForEnd = Math.ceil(this.baseSilenceMs / this.pollMs);
  }

  begin(now) {
    this.listeningStartedAt = now;
    this.calibratingUntil = now + this.calibrateMs;
    this.hasSpeech = false;
    this.inSpeech = false;
    this.speechStartedAt = 0;
    this.lastSpeechAt = 0;
    this.peakRms = 0;
    this.consecutiveSilentFrames = 0;
    this.consecutiveSpeechFrames = 0;
    this.noiseFloor = 0.004;
  }

  _startThreshold() {
    return Math.max(this.minSpeechRms, this.noiseFloor * this.startMultiplier);
  }

  _continueThreshold() {
    return Math.max(this.minSpeechRms * 0.72, this.noiseFloor * this.continueMultiplier);
  }

  _adaptiveSilenceMs() {
    if (!this.hasSpeech) return this.baseSilenceMs;
    const speechMs = Math.max(0, this.lastSpeechAt - this.speechStartedAt);
    // Longer utterances tolerate longer mid-sentence pauses (realtime-style).
    const extra = Math.min(this.maxAdaptiveSilenceMs, speechMs * 0.18);
    return this.baseSilenceMs + extra;
  }

  /**
   * @returns {"continue"|"end"|"calibrating"}
   */
  feed(rms, now) {
    if (now < this.calibratingUntil) {
      this.noiseFloor = this.noiseFloor * 0.82 + rms * 0.18;
      return "calibrating";
    }

    const startThreshold = this._startThreshold();
    const continueThreshold = this._continueThreshold();
    const threshold = this.inSpeech ? continueThreshold : startThreshold;
    const speaking = rms > threshold;

    if (speaking) {
      this.consecutiveSilentFrames = 0;
      this.consecutiveSpeechFrames += 1;
      this.peakRms = Math.max(this.peakRms, rms);
      this.noiseFloor = this.noiseFloor * 0.94 + rms * 0.06;

      if (!this.inSpeech && this.consecutiveSpeechFrames >= 2) {
        this.inSpeech = true;
        this.hasSpeech = true;
        this.speechStartedAt = now;
      }
      if (this.inSpeech) {
        this.lastSpeechAt = now;
      }
      return "continue";
    }

    this.consecutiveSpeechFrames = 0;

    if (!this.inSpeech) {
      this.noiseFloor = this.noiseFloor * 0.97 + rms * 0.03;
      return "continue";
    }

    // Hangover: brief dips between words still count as speech.
    if (now - this.lastSpeechAt < this.hangoverMs) {
      return "continue";
    }

    this.consecutiveSilentFrames += 1;

    const listenMs = now - this.listeningStartedAt;
    if (listenMs < this.minListenMs) {
      return "continue";
    }

    const speechMs = this.lastSpeechAt - this.speechStartedAt;
    if (speechMs < this.minSpeechMs) {
      return "continue";
    }

    const silenceMs = now - this.lastSpeechAt;
    const requiredSilence = this._adaptiveSilenceMs();
    const framesRequired = Math.ceil(requiredSilence / this.pollMs);

    if (
      this.consecutiveSilentFrames >= framesRequired &&
      silenceMs >= requiredSilence
    ) {
      return "end";
    }

    return "continue";
  }

  get speechDetected() {
    return this.hasSpeech;
  }

  get speechActive() {
    return this.inSpeech;
  }
}

/** Float32 [-1,1] → Int16 PCM for Deepgram linear16 streaming. */
function float32ToInt16PCM(float32Array) {
  const out = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out.buffer;
}
