/**
 * Browser live speech-to-text via Web Speech API (Chrome, Edge, Safari 14.1+).
 * Used for real-time Brain Dump captions while MediaRecorder captures audio.
 * Final save always uses backend STT — live captions are preview only.
 */

export type SpeechRecognitionAlternative = { transcript: string; confidence: number };

export type SpeechRecognitionResult = {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternative;
};

export type SpeechRecognitionResultList = {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
};

export type SpeechRecognitionEvent = Event & {
  resultIndex: number;
  results: SpeechRecognitionResultList;
};

export type SpeechRecognitionErrorEvent = Event & {
  error: string;
  message?: string;
};

export type BrowserSpeechRecognition = EventTarget & {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};

type SpeechRecognitionCtor = new () => BrowserSpeechRecognition;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

/** Errors where restarting the recognition session usually recovers. */
export const RECOVERABLE_SPEECH_ERRORS = new Set([
  "network",
  "no-speech",
  "aborted",
  "audio-capture",
]);

export function isLiveSpeechSupported(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function createSpeechRecognition(): BrowserSpeechRecognition | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Ctor) return null;
  const recognition = new Ctor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.lang = typeof navigator !== "undefined"
    ? (navigator.language || "en-US")
    : "en-US";
  return recognition;
}

/**
 * Rebuild committed + interim text from the full results list for this session.
 * Web Speech API results are cumulative within a session — always read the full list.
 */
export function buildTranscriptFromResults(
  results: SpeechRecognitionResultList,
): { committed: string; interim: string } {
  let committed = "";
  let interim = "";
  for (let i = 0; i < results.length; i++) {
    const chunk = results[i][0]?.transcript ?? "";
    if (!chunk) continue;
    if (results[i].isFinal) {
      committed += chunk;
    } else {
      interim += chunk;
    }
  }
  return { committed, interim };
}

/** @deprecated use buildTranscriptFromResults */
export function mergeSpeechResults(
  results: SpeechRecognitionResultList,
  fromIndex: number,
): { final: string; interim: string } {
  void fromIndex;
  const { committed, interim } = buildTranscriptFromResults(results);
  return { final: committed, interim };
}

/**
 * Light formatting for live preview — full punctuation comes from backend STT on save.
 */
export function formatLiveTranscript(text: string): string {
  if (!text) return "";
  let t = text.replace(/\s+/g, " ").trim();
  if (!t) return "";

  t = t.charAt(0).toUpperCase() + t.slice(1);
  t = t.replace(/([.!?])\s+([a-z])/g, (_, punct, letter) => `${punct} ${letter.toUpperCase()}`);

  const enumerators = /\b(first|second|third|next|also|then|finally|one|two|three)\b[,:]?\s/gi;
  if (enumerators.test(t) && !t.includes("\n")) {
    t = t.replace(/\s+(?=(?:first|second|third|next|also|then|finally)\b)/gi, "\n• ");
  }

  return t;
}

export function joinTranscriptParts(committed: string, interim: string): string {
  const base = formatLiveTranscript(committed);
  if (!interim) return base;
  if (!base) return interim;
  const needsSpace = !base.endsWith(" ") && !base.endsWith("\n");
  return `${base}${needsSpace ? " " : ""}${interim}`;
}

export function countWords(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

/** Pick the richest transcript from multiple STT sources (word count, then length). */
export function pickBestTranscript(...candidates: string[]): string {
  const cleaned = candidates
    .map((c) => formatLiveTranscript(c.trim()))
    .filter((c) => c.length >= 2);
  if (!cleaned.length) return "";

  return cleaned.reduce((best, cur) => {
    const bestWords = countWords(best);
    const curWords = countWords(cur);
    if (curWords > bestWords) return cur;
    if (curWords === bestWords && cur.length > best.length) return cur;
    return best;
  });
}

/**
 * Merge browser live captions with backend Whisper output.
 * Prefer Whisper when it has comparable word count (more accurate punctuation).
 */
export function mergeTranscriptsForDisplay(live: string, backend: string): string {
  const a = live.trim();
  const b = backend.trim();
  if (!a) return formatLiveTranscript(b);
  if (!b) return formatLiveTranscript(a);

  const aWords = countWords(a);
  const bWords = countWords(b);

  if (bWords >= Math.max(3, Math.floor(aWords * 0.8))) {
    return formatLiveTranscript(b);
  }
  return formatLiveTranscript(a);
}
