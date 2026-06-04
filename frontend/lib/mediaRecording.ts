/**
 * Cross-browser audio capture for Brain Dump (desktop + mobile Safari/Chrome).
 */

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function isAndroid(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent);
}

export function isMobileDevice(): boolean {
  return isIOS() || isAndroid();
}

export function isMediaRecorderSupported(): boolean {
  return typeof window !== "undefined" && typeof MediaRecorder !== "undefined";
}

/**
 * iOS Safari often emits empty blobs when using timesliced start().
 * Android is generally fine with timeslices but we keep one code path for mobile.
 */
export function shouldUseRecorderTimeslice(): boolean {
  return !isMobileDevice();
}

/**
 * Web Speech API and MediaRecorder compete for the mic on iOS (and some Android builds).
 * Prefer a reliable audio file; live captions stay desktop-only.
 */
export function canUseLiveSpeechWithRecorder(): boolean {
  if (isMobileDevice()) return false;
  return true;
}

export type RecorderFormat = {
  /** Full mime passed to MediaRecorder ctor, or "" for browser default */
  mimeType: string;
  /** Base MIME for Blob / upload */
  blobType: string;
  ext: string;
};

const MIME_CANDIDATES_IOS = [
  "audio/mp4",
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
] as const;

const MIME_CANDIDATES_DEFAULT = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/ogg",
] as const;

function extForMime(mimeType: string): string {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}

function blobTypeForMime(mimeType: string): string {
  return mimeType.split(";")[0].trim() || "audio/webm";
}

export function pickRecorderFormat(): RecorderFormat | null {
  if (!isMediaRecorderSupported()) return null;

  const candidates = isIOS() ? MIME_CANDIDATES_IOS : MIME_CANDIDATES_DEFAULT;
  for (const mimeType of candidates) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return {
        mimeType,
        blobType: blobTypeForMime(mimeType),
        ext: extForMime(mimeType),
      };
    }
  }

  // Safari may record with default codec even when isTypeSupported is false for all candidates
  return {
    mimeType: "",
    blobType: isIOS() ? "audio/mp4" : "audio/webm",
    ext: isIOS() ? "m4a" : "webm",
  };
}

export async function getRecordingStream(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone API not available");
  }

  const attempts: MediaStreamConstraints[] = [
    {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    },
    { audio: true },
  ];

  let lastError: unknown;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error("Microphone access denied");
}

export function createMediaRecorder(
  stream: MediaStream,
  format: RecorderFormat,
): MediaRecorder {
  const options: MediaRecorderOptions = {};
  if (format.mimeType) options.mimeType = format.mimeType;
  if (!isMobileDevice()) options.audioBitsPerSecond = 128_000;

  try {
    return new MediaRecorder(stream, options);
  } catch {
    if (format.mimeType) {
      return new MediaRecorder(stream);
    }
    throw new Error("MediaRecorder failed to start");
  }
}

export function buildRecordingBlob(chunks: Blob[], blobType: string): Blob {
  const fromChunk = chunks.find((c) => c.size > 0 && c.type)?.type;
  const type = blobType || fromChunk || (isIOS() ? "audio/mp4" : "audio/webm");
  return new Blob(chunks, { type });
}

/** Minimum bytes to treat a recording as non-empty (mobile codecs can be smaller per second). */
export function minRecordingBytes(): number {
  return isMobileDevice() ? 400 : 1000;
}
