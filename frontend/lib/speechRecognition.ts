/**
 * Browser live speech-to-text via Web Speech API (Chrome, Edge, Safari 14.1+).
 * Used for real-time Brain Dump captions while MediaRecorder captures audio.
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
};

type SpeechRecognitionCtor = new () => BrowserSpeechRecognition;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

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

export function mergeSpeechResults(
  results: SpeechRecognitionResultList,
  fromIndex: number,
): { final: string; interim: string } {
  let final = "";
  let interim = "";
  for (let i = fromIndex; i < results.length; i++) {
    const piece = results[i][0]?.transcript ?? "";
    if (results[i].isFinal) {
      final += piece;
    } else {
      interim += piece;
    }
  }
  return { final, interim };
}
