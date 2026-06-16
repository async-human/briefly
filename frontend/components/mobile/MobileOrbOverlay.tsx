"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { api, type ProactiveEvent } from "@/lib/api";
import { askUrl } from "@/lib/askLinks";
import {
  buildRecordingBlob,
  createMediaRecorder,
  getRecordingStream,
  minRecordingBytes,
  pickRecorderFormat,
  shouldUseRecorderTimeslice,
} from "@/lib/mediaRecording";
import { JarvisOrbCanvas, type JarvisOrbMode } from "./JarvisOrbCanvas";
import "@/styles/mobile-orb.css";

type Mode = JarvisOrbMode;

const RECORDER_TIMESLICE_MS = 1000;

const STATUS_LABEL: Record<Mode, string> = {
  idle: "Standby",
  listening: "Acquiring audio",
  thinking: "Processing",
  speaking: "Transmitting",
};

function isEmphasisWord(word: string): boolean {
  const clean = word.replace(/[^\w]/g, "");
  if (!clean) return false;
  if (clean.length >= 10) return true;
  if (/^[A-Z0-9]{3,}$/.test(clean)) return true;
  return /[:!?]$/.test(word);
}

function buildWordTimeline(words: string[]): number[] {
  if (!words.length) return [];
  const weights = words.map((word) => {
    const clean = word.replace(/[^\w]/g, "");
    const len = clean.length;
    let w = 1 + Math.min(len, 12) * 0.06;
    if (len <= 3) w *= 0.8;
    if (/[,:;]/.test(word)) w += 0.45;
    if (/[.!?]$/.test(word)) w += 0.95; // sentence-end pause
    if (/[()[\]{}]/.test(word)) w += 0.26;
    if (/["'`]/.test(word)) w += 0.18;
    if (/[—–-]/.test(word)) w += 0.42; // clause breaks
    if (/[\\/|]/.test(word)) w += 0.3;
    if (/\.\.\.$/.test(word)) w += 0.62; // dramatic pause
    if (/:$/.test(word)) w += 0.28;
    return w;
  });
  const total = weights.reduce((sum, w) => sum + w, 0) || 1;
  let acc = 0;
  return weights.map((w) => {
    acc += w / total;
    return Math.min(acc, 1);
  });
}

/** Split an answer into sentence-ish chunks for pipelined TTS, merging tiny tails. */
function splitSentences(text: string): string[] {
  const raw = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [text];
  const out: string[] = [];
  for (const piece of raw) {
    const t = piece.trim();
    if (!t) continue;
    if (out.length && t.length < 18) out[out.length - 1] = `${out[out.length - 1]} ${t}`;
    else out.push(t);
  }
  return out.length ? out : [text.trim()];
}

export function MobileOrbOverlay() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<Mode>("idle");
  const [caption, setCaption] = useState("How can I help you today?");
  const [enabled, setEnabled] = useState(true);
  const [toolMode, setToolMode] = useState("");
  const [heardText, setHeardText] = useState("");
  const [query, setQuery] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [spokenWordIndex, setSpokenWordIndex] = useState(-1);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const threadIdRef = useRef<string | null>(null);
  const router = useRouter();
  const [hasConversation, setHasConversation] = useState(false);
  const [pending, setPending] = useState<ProactiveEvent[]>([]);

  const orbHint = useMemo(() => {
    if (!enabled) return "Microphone disabled";
    if (mode === "idle") return "Tap core to speak";
    if (mode === "listening") return "Tap core when finished";
    if (mode === "thinking") return "Analyzing your request";
    return "Tap core to interrupt";
  }, [enabled, mode]);

  const captionWords = useMemo(() => {
    return caption.trim().split(/\s+/).filter(Boolean);
  }, [caption]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Poll for high-priority items the orb can surface proactively. Best-effort,
  // background only — it never opens, speaks, or interrupts on its own.
  const refreshProactive = useCallback(async () => {
    try {
      const events = await api.orbProactive();
      setPending(Array.isArray(events) ? events : []);
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    void refreshProactive();
    const id = window.setInterval(() => void refreshProactive(), 4 * 60 * 1000);
    const onFocus = () => void refreshProactive();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshProactive]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  function stopStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }

  function stopPlayback() {
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      } catch {
        // no-op
      }
      audioRef.current = null;
    }
    setSpokenWordIndex(-1);
  }

  function closeOverlay() {
    if (mode !== "idle") interrupt();
    setOpen(false);
    setComposeOpen(false);
  }

  // Opening is always user-initiated. If something proactive is waiting, lead
  // with it as a heads-up and mark it seen so it doesn't resurface.
  function openOrb() {
    setOpen(true);
    if (pending.length > 0) {
      const top = pending[0];
      const ids = pending.map((e) => e.id);
      setCaption(`Heads up — ${top.title}${top.body ? `. ${top.body}` : ""}`);
      setHeardText("");
      setPending([]);
      void api.orbProactiveSeen(ids).catch(() => {});
    }
  }

  // Hand off to the full conversation view, continuing the same thread so the
  // orb and /ask are two views of one assistant — not two separate ones.
  function openFullConversation() {
    const id = threadIdRef.current;
    if (mode !== "idle") interrupt();
    setOpen(false);
    setComposeOpen(false);
    router.push(askUrl(id ? { threadId: id } : undefined));
  }

  async function beginListening() {
    if (!enabled) return;
    const fmt = pickRecorderFormat();
    if (!fmt) {
      setCaption("Voice capture is not supported in this browser.");
      return;
    }
    try {
      const stream = await getRecordingStream();
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = createMediaRecorder(stream, fmt);
      recorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start(shouldUseRecorderTimeslice() ? RECORDER_TIMESLICE_MS : undefined);
      setMode("listening");
      setCaption("I'm listening.");
    } catch {
      setCaption("Microphone permission was denied.");
    }
  }

  async function stopListeningAndSend() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    setMode("thinking");
    setCaption("One moment.");
    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        const fmt = pickRecorderFormat();
        resolve(buildRecordingBlob(chunksRef.current, fmt?.blobType || "audio/webm"));
      };
      try {
        recorder.requestData();
      } catch {
        // no-op
      }
      recorder.stop();
    });
    recorderRef.current = null;
    stopStream();
    if (blob.size < minRecordingBytes()) {
      setMode("idle");
      setCaption("I didn't catch that. Try again.");
      return;
    }
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      const turn = await api.orbTurn(
        blob,
        "mobile-orb.webm",
        threadIdRef.current ? { thread_id: threadIdRef.current } : undefined,
        ctl.signal,
      );
      setHeardText((turn.transcript || "").trim());
      if (!turn.answer?.trim()) {
        setMode("idle");
        setCaption("I couldn't form a response. Try again.");
        return;
      }
      await handleTurnResponse(turn, ctl.signal);
      setMode("idle");
    } catch {
      setMode("idle");
      setCaption("Connection interrupted.");
      setToolMode("");
    } finally {
      abortRef.current = null;
    }
  }

  async function playSentence(
    blob: Blob,
    words: string[],
    wordOffset: number,
    signal?: AbortSignal,
  ) {
    const url = URL.createObjectURL(blob);
    const timeline = buildWordTimeline(words);
    try {
      await new Promise<void>((resolve) => {
        const audio = new Audio(url);
        audioRef.current = audio;
        let ticker = 0;
        const updateWordSync = () => {
          if (!words.length) return;
          const duration =
            Number.isFinite(audio.duration) && audio.duration > 0
              ? audio.duration
              : Math.max(words.length * 0.42, 1.2);
          const progress = Math.max(0, Math.min(1, audio.currentTime / duration));
          let next = words.length - 1;
          for (let i = 0; i < timeline.length; i += 1) {
            if (progress <= timeline[i]) {
              next = i;
              break;
            }
          }
          setSpokenWordIndex(wordOffset + next);
        };
        const finish = () => {
          if (ticker) window.clearInterval(ticker);
          resolve();
        };
        audio.onloadedmetadata = updateWordSync;
        audio.ontimeupdate = updateWordSync;
        audio.onended = finish;
        audio.onerror = finish;
        if (signal?.aborted) {
          finish();
          return;
        }
        ticker = window.setInterval(updateWordSync, 90);
        void audio.play().catch(() => resolve());
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function handleTurnResponse(turn: Awaited<ReturnType<typeof api.orbTurn>>, signal?: AbortSignal) {
    if (!turn.answer?.trim()) {
      setMode("idle");
      setCaption("I couldn't form a response. Try again.");
      return;
    }
    if (turn.thread_id) {
      threadIdRef.current = turn.thread_id;
      setHasConversation(true);
    }
    const trace = Array.isArray(turn.tool_trace) ? turn.tool_trace : [];
    const tools = trace.map((t) => String(t.tool || "")).filter(Boolean);
    setToolMode(tools.length ? tools.join(" · ") : "");

    const fullAnswer = turn.answer.trim();
    setCaption(fullAnswer);
    const allWords = fullAnswer.split(/\s+/).filter(Boolean);
    setSpokenWordIndex(allWords.length ? 0 : -1);
    setMode("speaking");

    // Pipeline TTS: synthesize sentence-by-sentence, start playing the first as
    // soon as it's ready, and prefetch the next couple so playback never waits.
    // Time-to-first-audio drops from "whole clip" to "first sentence."
    const sentences = splitSentences(fullAnswer);
    const sentenceWords = sentences.map((s) => s.split(/\s+/).filter(Boolean));
    const jobs: (Promise<Blob | null> | null)[] = new Array(sentences.length).fill(null);
    const ensure = (i: number) => {
      if (i >= 0 && i < sentences.length && jobs[i] === null) {
        jobs[i] = api.orbSpeak(sentences[i], undefined, signal).catch(() => null);
      }
    };
    const PREFETCH = 2;
    for (let i = 0; i < Math.min(PREFETCH, sentences.length); i += 1) ensure(i);

    let wordOffset = 0;
    for (let i = 0; i < sentences.length; i += 1) {
      if (signal?.aborted) break;
      ensure(i);
      const job = jobs[i];
      const blob = job ? await job : null;
      ensure(i + 1); // keep the pipeline full while this clip plays
      if (blob && !signal?.aborted) {
        await playSentence(blob, sentenceWords[i], wordOffset, signal);
      }
      wordOffset += sentenceWords[i].length;
    }
    audioRef.current = null;
    setSpokenWordIndex(-1);
  }

  async function sendTextQuery() {
    const text = query.trim();
    if (!text) return;
    setHeardText(text);
    setQuery("");
    setMode("thinking");
    setCaption("One moment.");
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      const turn = await api.orbTurnText(
        text,
        threadIdRef.current ? { thread_id: threadIdRef.current } : undefined,
        ctl.signal,
      );
      setHeardText((turn.transcript || text).trim());
      if (!turn.answer?.trim()) {
        setMode("idle");
        setCaption("I couldn't form a response. Try again.");
        return;
      }
      await handleTurnResponse(turn, ctl.signal);
      setMode("idle");
    } catch {
      setMode("idle");
      setCaption("Connection interrupted.");
      setToolMode("");
    } finally {
      abortRef.current = null;
    }
  }

  const interrupt = useCallback(() => {
    abortRef.current?.abort();
    stopPlayback();
    if (recorderRef.current && recorderRef.current.state === "recording") {
      try {
        recorderRef.current.stop();
      } catch {
        // no-op
      }
    }
    recorderRef.current = null;
    stopStream();
    setMode("idle");
    setCaption("Standing by.");
    setToolMode("");
    setSpokenWordIndex(-1);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (mode !== "idle") interrupt();
        else setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, mode, interrupt]);

  function onCoreAction() {
    if (!enabled && mode === "idle") return;
    if (mode === "idle") {
      void beginListening();
      return;
    }
    if (mode === "listening") {
      void stopListeningAndSend();
      return;
    }
    interrupt();
  }

  const overlay = open && mounted ? (
    <div className="jarvis-overlay" role="dialog" aria-modal aria-label="Briefly intelligence core">
      <button type="button" className="jarvis-backdrop" onClick={closeOverlay} aria-label="Close assistant" />
      <div className="jarvis-shell">
        <div className="jarvis-hud-corner jarvis-hud-tl" aria-hidden />
        <div className="jarvis-hud-corner jarvis-hud-tr" aria-hidden />
        <div className="jarvis-hud-corner jarvis-hud-bl" aria-hidden />
        <div className="jarvis-hud-corner jarvis-hud-br" aria-hidden />
        <div className="jarvis-scanline" aria-hidden />

        <header className="jarvis-header">
          <div>
            <p className="jarvis-eyebrow">Briefly Intelligence</p>
            <p className="jarvis-system">Core interface · online</p>
          </div>
          <div className="jarvis-header-actions">
            <button
              type="button"
              className="jarvis-icon-btn"
              onClick={() => setEnabled((v) => !v)}
              aria-label={enabled ? "Mute microphone" : "Enable microphone"}
              title={enabled ? "Mute microphone" : "Enable microphone"}
            >
              {enabled ? (
                <svg viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M12 15a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                  <path d="M5 11v1a7 7 0 0 0 14 0v-1M12 19v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M5 5l14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <path
                    d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V7a3 3 0 0 0-5.94-.68"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                  <path d="M12 19v3M5 11v1a7 7 0 0 0 6.5 6.97" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              )}
            </button>
            <button type="button" className="jarvis-icon-btn" onClick={closeOverlay} aria-label="Close">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </header>

        <div className="jarvis-stage">
          <p className="jarvis-status" aria-live="polite">
            <span className={`jarvis-status-dot mode-${mode}`} aria-hidden />
            {STATUS_LABEL[mode]}
          </p>
          {heardText ? <p className="jarvis-heard">Heard: {heardText}</p> : null}

          <button
            type="button"
            className={`jarvis-core mode-${mode}`}
            onClick={onCoreAction}
            disabled={mode === "thinking" || (!enabled && mode === "idle")}
            aria-label={orbHint}
          >
            <JarvisOrbCanvas mode={mode} size="stage" className="jarvis-core-canvas" />
          </button>

          <p className="jarvis-hint">{orbHint}</p>
          <div className={`jarvis-response-shell${mode === "speaking" ? " is-speaking" : ""}`}>
            <p
              className={`jarvis-response${mode === "speaking" ? " is-karaoke" : ""}`}
              aria-live="polite"
            >
              {mode === "speaking" && captionWords.length
                ? captionWords.map((word, i) => (
                    <span
                      key={`${word}-${i}`}
                      className={[
                        "jarvis-response-word",
                        i <= spokenWordIndex ? "is-spoken" : "",
                        i === spokenWordIndex ? "is-active" : "",
                        isEmphasisWord(word) ? "is-emphasis" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {word}
                    </span>
                  ))
                : caption}
            </p>
            {mode === "speaking" ? (
              <div className="jarvis-waveform" aria-hidden>
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
            ) : null}
          </div>
          {toolMode ? <p className="jarvis-tools">{toolMode}</p> : null}
        </div>

        <footer className="jarvis-footer">
          {composeOpen ? (
            <form
              className="jarvis-compose"
              onSubmit={(e) => {
                e.preventDefault();
                void sendTextQuery();
              }}
            >
              <input
                className="jarvis-compose-input"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type a command…"
                disabled={mode === "listening" || mode === "thinking"}
                autoFocus
              />
              <button
                type="submit"
                className="jarvis-compose-send"
                disabled={!query.trim() || mode === "listening" || mode === "thinking"}
              >
                Send
              </button>
            </form>
          ) : (
            <div className="jarvis-footer-actions">
              <button type="button" className="jarvis-compose-toggle" onClick={() => setComposeOpen(true)}>
                Type instead
              </button>
              {hasConversation && (
                <button type="button" className="jarvis-expand-link" onClick={openFullConversation}>
                  Open full conversation →
                </button>
              )}
            </div>
          )}
        </footer>
      </div>
    </div>
  ) : null;

  return (
    <div className="mob-orb-wrap">
      <button
        type="button"
        className={`jarvis-fab${open ? " is-active" : ""}${!open && pending.length > 0 ? " has-pending" : ""}`}
        onClick={() => (open ? closeOverlay() : openOrb())}
        aria-expanded={open}
        aria-label={
          !open && pending.length > 0
            ? `Briefly assistant — ${pending.length} new update${pending.length > 1 ? "s" : ""}`
            : "Open Briefly intelligence core"
        }
        title="Briefly assistant"
      >
        <JarvisOrbCanvas mode={open ? mode : "idle"} size="fab" className="jarvis-fab-canvas" />
        <span className="jarvis-fab-glow" aria-hidden />
        {!open && pending.length > 0 && <span className="jarvis-fab-badge" aria-hidden />}
      </button>
      {mounted && overlay ? createPortal(overlay, document.body) : null}
    </div>
  );
}
