"use strict";

/**
 * Speech endpointer — hysteresis, hangover, peak-relative trailing silence, and
 * hard timeouts so listening never hangs after the user stops talking.
 */
class SpeechEndpointer {
  constructor(options = {}) {
    this.pollMs = options.pollMs ?? 48;
    this.baseSilenceMs = options.baseSilenceMs ?? 850;
    this.maxAdaptiveSilenceMs = options.maxAdaptiveSilenceMs ?? 450;
    this.minSpeechMs = options.minSpeechMs ?? 380;
    this.hangoverMs = options.hangoverMs ?? 280;
    this.calibrateMs = options.calibrateMs ?? 380;
    this.minListenMs = options.minListenMs ?? 550;
    this.maxListenMs = options.maxListenMs ?? 45000;
    this.maxListenNoSpeechMs = options.maxListenNoSpeechMs ?? 12000;
    this.startMultiplier = options.startMultiplier ?? 3.2;
    this.continueMultiplier = options.continueMultiplier ?? 2.0;
    this.minSpeechRms = options.minSpeechRms ?? 0.009;
    this.trailingRatio = options.trailingRatio ?? 0.16;
    this.trailingSilenceMs = options.trailingSilenceMs ?? 520;

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
    this.trailingSilentSince = 0;
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
    this.trailingSilentSince = 0;
    this.noiseFloor = 0.004;
  }

  _startThreshold() {
    return Math.max(this.minSpeechRms, this.noiseFloor * this.startMultiplier);
  }

  _continueThreshold() {
    return Math.max(this.minSpeechRms * 0.68, this.noiseFloor * this.continueMultiplier);
  }

  _adaptiveSilenceMs() {
    if (!this.hasSpeech) return this.baseSilenceMs;
    const speechMs = Math.max(0, this.lastSpeechAt - this.speechStartedAt);
    const extra = Math.min(this.maxAdaptiveSilenceMs, speechMs * 0.12);
    return this.baseSilenceMs + extra;
  }

  _trailingThreshold() {
    if (this.peakRms <= this.minSpeechRms) return this._continueThreshold();
    return Math.max(this._continueThreshold(), this.peakRms * this.trailingRatio);
  }

  _shouldEndUtterance(now) {
    const listenMs = now - this.listeningStartedAt;
    if (listenMs >= this.maxListenMs && this.hasSpeech) return "timeout";

    if (!this.hasSpeech && listenMs >= this.maxListenNoSpeechMs) {
      return "no_speech";
    }

    if (!this.inSpeech || listenMs < this.minListenMs) return null;

    const speechMs = this.lastSpeechAt - this.speechStartedAt;
    if (speechMs < this.minSpeechMs) return null;

    const silenceMs = now - this.lastSpeechAt;
    if (silenceMs < this.hangoverMs) return null;

    const requiredSilence = this._adaptiveSilenceMs();
    const framesRequired = Math.ceil(requiredSilence / this.pollMs);
    if (this.consecutiveSilentFrames >= framesRequired && silenceMs >= requiredSilence) {
      return "silence";
    }

    const trailThreshold = this._trailingThreshold();
    if (this.trailingSilentSince > 0) {
      const trailMs = now - this.trailingSilentSince;
      if (trailMs >= this.trailingSilenceMs) return "trailing";
    }

    return null;
  }

  /**
   * @returns {"continue"|"end"|"cancel"|"calibrating"}
   */
  feed(rms, now) {
    if (now < this.calibratingUntil) {
      this.noiseFloor = this.noiseFloor * 0.8 + rms * 0.2;
      return "calibrating";
    }

    const startThreshold = this._startThreshold();
    const continueThreshold = this._continueThreshold();
    const threshold = this.inSpeech ? continueThreshold : startThreshold;
    const speaking = rms > threshold;

    if (speaking) {
      this.consecutiveSilentFrames = 0;
      this.consecutiveSpeechFrames += 1;
      this.trailingSilentSince = 0;
      this.peakRms = Math.max(this.peakRms, rms);
      this.noiseFloor = this.noiseFloor * 0.93 + rms * 0.07;

      if (!this.inSpeech && this.consecutiveSpeechFrames >= 2) {
        this.inSpeech = true;
        this.hasSpeech = true;
        this.speechStartedAt = now;
      }
      if (this.inSpeech) {
        this.lastSpeechAt = now;
      }
    } else {
      this.consecutiveSpeechFrames = 0;

      if (!this.inSpeech) {
        this.noiseFloor = this.noiseFloor * 0.96 + rms * 0.04;
      } else {
        this.consecutiveSilentFrames += 1;
        const trailThreshold = this._trailingThreshold();
        if (rms <= trailThreshold) {
          if (!this.trailingSilentSince) this.trailingSilentSince = now;
        } else {
          this.trailingSilentSince = 0;
        }
      }
    }

    const endReason = this._shouldEndUtterance(now);
    if (endReason === "no_speech") return "cancel";
    if (endReason) return "end";
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
