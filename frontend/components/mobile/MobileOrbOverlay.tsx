"use client";

import { useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  buildRecordingBlob,
  createMediaRecorder,
  getRecordingStream,
  minRecordingBytes,
  pickRecorderFormat,
  shouldUseRecorderTimeslice,
} from "@/lib/mediaRecording";
import "@/styles/mobile-orb.css";

type Mode = "idle" | "listening" | "thinking" | "speaking";

const RECORDER_TIMESLICE_MS = 1000;

export function MobileOrbOverlay() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("idle");
  const [caption, setCaption] = useState("Tap orb to start talking");
  const [enabled, setEnabled] = useState(true);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const buttonLabel = useMemo(() => {
    if (mode === "listening") return "Stop";
    if (mode === "thinking") return "Thinking…";
    if (mode === "speaking") return "Interrupt";
    return "Talk";
  }, [mode]);

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

  async function beginListening() {
    if (!enabled) return;
    const fmt = pickRecorderFormat();
    if (!fmt) {
      setCaption("Voice recording not supported in this browser.");
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
      setCaption("Listening… tap stop when done");
    } catch {
      setCaption("Microphone permission denied.");
    }
  }

  async function stopListeningAndSend() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    setMode("thinking");
    setCaption("Thinking…");
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
      setCaption("Recording too short. Try again.");
      return;
    }
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      const turn = await api.orbTurn(blob, "mobile-orb.webm", undefined, ctl.signal);
      if (!turn.answer?.trim()) {
        setMode("idle");
        setCaption("No answer returned. Try again.");
        return;
      }
      setCaption(turn.answer);
      setMode("speaking");
      const tts = await api.orbSpeak(turn.answer, undefined, ctl.signal);
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
      setMode("idle");
    } catch {
      setMode("idle");
      setCaption("Could not complete voice turn.");
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
    setCaption("Interrupted.");
  }

  function onMainAction() {
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

  return (
    <>
      <button className="mob-orb-fab" onClick={() => setOpen((v) => !v)} aria-label="Open Briefly orb">
        ◉
      </button>
      {open ? (
        <div className="mob-orb-panel" role="dialog" aria-label="Briefly mobile orb">
          <div className={`mob-orb-core mode-${mode}`} />
          <p className="mob-orb-caption">{caption}</p>
          <button className="mob-orb-action" onClick={onMainAction} disabled={mode === "thinking"}>
            {buttonLabel}
          </button>
          <button className="mob-orb-sub" onClick={() => setEnabled((v) => !v)}>
            {enabled ? "Disable orb mic" : "Enable orb mic"}
          </button>
        </div>
      ) : null}
    </>
  );
}

