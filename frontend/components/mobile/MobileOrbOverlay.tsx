"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
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

export function MobileOrbOverlay() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<Mode>("idle");
  const [caption, setCaption] = useState("How can I help you today?");
  const [enabled, setEnabled] = useState(true);
  const [toolMode, setToolMode] = useState("");
  const [query, setQuery] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const orbHint = useMemo(() => {
    if (!enabled) return "Microphone disabled";
    if (mode === "idle") return "Tap core to speak";
    if (mode === "listening") return "Tap core when finished";
    if (mode === "thinking") return "Analyzing your request";
    return "Tap core to interrupt";
  }, [enabled, mode]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

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
  }, [open, mode]);

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
  }

  function closeOverlay() {
    if (mode !== "idle") interrupt();
    setOpen(false);
    setComposeOpen(false);
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
      const turn = await api.orbTurn(blob, "mobile-orb.webm", undefined, ctl.signal);
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

  async function handleTurnResponse(turn: Awaited<ReturnType<typeof api.orbTurn>>, signal?: AbortSignal) {
    if (!turn.answer?.trim()) {
      setMode("idle");
      setCaption("I couldn't form a response. Try again.");
      return;
    }
    const trace = Array.isArray(turn.tool_trace) ? turn.tool_trace : [];
    const tools = trace.map((t) => String(t.tool || "")).filter(Boolean);
    setToolMode(tools.length ? tools.join(" · ") : "");
    setCaption(turn.answer);
    setMode("speaking");
    const tts = await api.orbSpeak(turn.answer, undefined, signal);
    const url = URL.createObjectURL(tts);
    await new Promise<void>((resolve) => {
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
      void audio.play().catch(() => resolve());
    });
    URL.revokeObjectURL(url);
    audioRef.current = null;
  }

  async function sendTextQuery() {
    const text = query.trim();
    if (!text) return;
    setQuery("");
    setMode("thinking");
    setCaption("One moment.");
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      const turn = await api.orbTurnText(text, undefined, ctl.signal);
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

  function interrupt() {
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
  }

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
          <p className="jarvis-response" aria-live="polite">
            {caption}
          </p>
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
            <button type="button" className="jarvis-compose-toggle" onClick={() => setComposeOpen(true)}>
              Type instead
            </button>
          )}
        </footer>
      </div>
    </div>
  ) : null;

  return (
    <div className="mob-orb-wrap">
      <button
        type="button"
        className={`jarvis-fab${open ? " is-active" : ""}`}
        onClick={() => (open ? closeOverlay() : setOpen(true))}
        aria-expanded={open}
        aria-label="Open Briefly intelligence core"
        title="Briefly assistant"
      >
        <JarvisOrbCanvas mode={open ? mode : "idle"} size="fab" className="jarvis-fab-canvas" />
        <span className="jarvis-fab-glow" aria-hidden />
      </button>
      {mounted && overlay ? createPortal(overlay, document.body) : null}
    </div>
  );
}
