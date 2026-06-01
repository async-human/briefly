"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { api, ApiError, type BrainDump } from "@/lib/api";

type Phase = "capture" | "recording" | "processing" | "success";

type BrainDumpOverlayProps = {
  open: boolean;
  onClose: () => void;
};

export function BrainDumpOverlay({ open, onClose }: BrainDumpOverlayProps) {
  const [phase, setPhase] = useState<Phase>("capture");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BrainDump | null>(null);
  const [recordingSec, setRecordingSec] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const reset = useCallback(() => {
    setPhase("capture");
    setText("");
    setError(null);
    setResult(null);
    setRecordingSec(0);
    chunksRef.current = [];
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!open) {
      reset();
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
    }
  }, [open, reset]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase !== "processing") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, phase]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [open]);

  async function submitText() {
    const trimmed = text.trim();
    if (!trimmed) {
      setError("Type something first — messy is fine.");
      return;
    }
    setError(null);
    setPhase("processing");
    try {
      const dump = await api.createBrainDump({ text: trimmed });
      setResult(dump);
      setPhase("success");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to save. Try again.");
      setPhase("capture");
    }
  }

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeCandidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg;codecs=opus",
        "audio/ogg",
      ];
      const mimeType = mimeCandidates.find((t) => MediaRecorder.isTypeSupported(t));
      if (!mimeType) {
        setError("Voice recording is not supported in this browser. Use text instead.");
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      const ext = mimeType.includes("mp4") ? "mp4" : mimeType.includes("ogg") ? "ogg" : "webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        const blob = new Blob(chunksRef.current, { type: mimeType.split(";")[0] });
        if (blob.size < 1000) {
          setError("Recording too short. Speak for at least a second, then stop.");
          setPhase("capture");
          return;
        }
        setPhase("processing");
        try {
          const dump = await api.createBrainDumpAudio(blob, `recording.${ext}`);
          setResult(dump);
          setPhase("success");
        } catch (e) {
          setError(e instanceof ApiError ? e.message : "Voice processing failed. Try typing instead.");
          setPhase("capture");
        }
      };

      mediaRecorderRef.current = recorder;
      // Single complete file on stop — timeslice fragments produce invalid WebM for STT APIs
      recorder.start();
      setPhase("recording");
      setRecordingSec(0);
      timerRef.current = setInterval(() => setRecordingSec((s) => s + 1), 1000);
    } catch {
      setError("Microphone access denied. Use text input instead.");
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }

  function handleClose() {
    if (phase === "processing") return;
    onClose();
  }

  const intentLabel: Record<string, string> = {
    action_item: "Action items",
    project_idea: "Project idea",
    general_context: "Context",
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            className="brain-dump-backdrop"
            aria-label="Close brain dump"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
          />
          <motion.div
            className="brain-dump-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="brain-dump-title"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <header className="brain-dump-header">
              <div>
                <p className="brain-dump-eyebrow">Brain Dump</p>
                <h2 id="brain-dump-title" className="brain-dump-title">
                  {phase === "success" ? "Captured" : "Dump your thoughts"}
                </h2>
              </div>
              <button
                type="button"
                className="brain-dump-close"
                onClick={handleClose}
                disabled={phase === "processing"}
                aria-label="Close"
              >
                ×
              </button>
            </header>

            {phase === "success" && result ? (
              <div className="brain-dump-success">
                <p className="brain-dump-success-summary">{result.clean_summary}</p>
                <div className="brain-dump-meta-row">
                  <span className="brain-dump-badge">{intentLabel[result.intent_type] ?? result.intent_type}</span>
                  {result.should_inject_into_morning_brief && (
                    <span className="brain-dump-badge brain-dump-badge-accent">In tomorrow&apos;s brief</span>
                  )}
                </div>
                {result.action_items.length > 0 && (
                  <div className="brain-dump-actions-block">
                    <p className="brain-dump-actions-label">Action items</p>
                    <ul className="brain-dump-actions-list">
                      {result.action_items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {result.relevance_keywords.length > 0 && (
                  <div className="brain-dump-keywords">
                    {result.relevance_keywords.map((kw) => (
                      <span key={kw} className="brain-dump-kw">{kw}</span>
                    ))}
                  </div>
                )}
                <p className="brain-dump-footnote">
                  Briefly updated your relevance profile. This will shape what surfaces in future briefings.
                </p>
                <button type="button" className="btn-primary brain-dump-done-btn" onClick={onClose}>
                  Done
                </button>
              </div>
            ) : phase === "processing" ? (
              <div className="brain-dump-processing">
                <span className="btn-spinner brain-dump-spinner" aria-hidden />
                <p>Structuring your thoughts…</p>
              </div>
            ) : (
              <>
                <p className="brain-dump-hint">
                  Stream of consciousness is fine. Briefly cleans it up and feeds your second brain.
                </p>

                <textarea
                  className="brain-dump-textarea field-input"
                  placeholder="What's on your mind? Ideas, tasks, half-formed thoughts…"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={6}
                  disabled={phase === "recording"}
                />

                <div className="brain-dump-voice-row">
                  {phase === "recording" ? (
                    <button
                      type="button"
                      className="brain-dump-mic brain-dump-mic-active"
                      onClick={stopRecording}
                    >
                      <span className="brain-dump-mic-pulse" aria-hidden />
                      <span>Stop · {recordingSec}s</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="brain-dump-mic"
                      onClick={startRecording}
                    >
                      <span className="brain-dump-mic-icon" aria-hidden>🎙</span>
                      <span>Hold to speak</span>
                    </button>
                  )}
                  <span className="brain-dump-voice-hint">or type above</span>
                </div>

                {error && <p className="form-error brain-dump-error">{error}</p>}

                <div className="brain-dump-actions">
                  <button type="button" className="btn-ghost" onClick={handleClose}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={submitText}
                    disabled={phase === "recording" || !text.trim()}
                  >
                    Save dump
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
