/** Shared element unlocked inside a user-gesture handler (e.g. "Brief me" click). */
let sharedAudio: HTMLAudioElement | null = null;

function ensureSharedAudio(): HTMLAudioElement {
  if (typeof window === "undefined") {
    throw new Error("audio unavailable");
  }
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.preload = "auto";
    sharedAudio.setAttribute("playsinline", "");
  }
  return sharedAudio;
}

/** Unlock browser audio output inside a user-gesture handler (e.g. button click). */
export function unlockAudioPlayback(): HTMLAudioElement {
  const audio = ensureSharedAudio();
  try {
    const ctx = new AudioContext();
    void ctx.resume().finally(() => void ctx.close());
  } catch {
    // no-op
  }
  try {
    audio.pause();
    audio.src =
      "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
    audio.volume = 0.01;
    void audio.play().catch(() => undefined);
  } catch {
    // no-op
  }
  return audio;
}

/** Reuse the gesture-unlocked element for TTS playback (avoids autoplay blocks). */
export function getSharedPlaybackAudio(): HTMLAudioElement {
  return ensureSharedAudio();
}

export function stopSharedPlaybackAudio(): void {
  if (!sharedAudio) return;
  try {
    sharedAudio.pause();
    sharedAudio.removeAttribute("src");
    sharedAudio.load();
  } catch {
    // no-op
  }
}

export function stopSpeechSynthesis(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // no-op
  }
}

export function stopAllBrieflyAudio(): void {
  stopSharedPlaybackAudio();
  stopSpeechSynthesis();
}

export function speakWithBrowser(text: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      resolve();
      return;
    }
    stopSharedPlaybackAudio();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.98;
    utterance.pitch = 1;
    const finish = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = () => {
      window.speechSynthesis.cancel();
      finish();
    };
    signal?.addEventListener("abort", onAbort);
    utterance.onend = finish;
    utterance.onerror = finish;
    window.speechSynthesis.speak(utterance);
  });
}
