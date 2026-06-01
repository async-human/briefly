"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { api, ApiError, type BrainDump } from "@/lib/api";
import {
  createSpeechRecognition,
  isLiveSpeechSupported,
  mergeSpeechResults,
  type BrowserSpeechRecognition,
  type SpeechRecognitionErrorEvent,
  type SpeechRecognitionEvent,
} from "@/lib/speechRecognition";

type Phase = "capture" | "recording" | "processing" | "success";

type BrainDumpOverlayProps = {
  open: boolean;
  onClose: () => void;
};

export function BrainDumpOverlay({ open, onClose }: BrainDumpOverlayProps) {
  const [phase, setPhase] = useState<Phase>("capture");
  const [text, setText] = useState("");
  const [liveInterim, setLiveInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BrainDump | null>(null);
  const [recordingSec, setRecordingSec] = useState(0);
  const [liveCaptions, setLiveCaptions] = useState(isLiveSpeechSupported());

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speechRef = useRef<BrowserSpeechRecognition | null>(null);
  const recordingActiveRef = useRef(false);
  const liveTranscriptRef = useRef("");
  const liveInterimRef = useRef("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recordingMimeRef = useRef("");
  const recordingExtRef = useRef("webm");

  const stopSpeechRecognition = useCallback(() => {
    recordingActiveRef.current = false;
    const recognition = speechRef.current;
    speechRef.current = null;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.stop();
      } catch {
        try {
          recognition.abort();
        } catch {
          /* ignore */
        }
      }
    }
    setLiveInterim("");
    liveInterimRef.current = "";
  }, []);

  const reset = useCallback(() => {
    stopSpeechRecognition();
    setPhase("capture");
    setText("");
    setLiveInterim("");
    setError(null);
    setResult(null);
    setRecordingSec(0);
    liveTranscriptRef.current = "";
    liveInterimRef.current = "";
    chunksRef.current = [];
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
  }, [stopSpeechRecognition]);

  useEffect(() => {
    if (!open) reset();
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

  useEffect(() => {
    const el = textareaRef.current;
    if (phase === "recording" && el) {
      el.scrollTop = el.scrollHeight;
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }
  }, [text, liveInterim, phase]);

  const startSpeechRecognition = useCallback((baseText: string) => {
    const recognition = createSpeechRecognition();
    if (!recognition) {
      setLiveCaptions(false);
      return;
    }

    liveTranscriptRef.current = baseText.trim();
    if (liveTranscriptRef.current) {
      liveTranscriptRef.current += " ";
    }
    setText(liveTranscriptRef.current);
    setLiveCaptions(true);
    speechRef.current = recognition;
    recordingActiveRef.current = true;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const { final, interim } = mergeSpeechResults(event.results, event.resultIndex);
      if (final) {
        liveTranscriptRef.current += final;
        if (!final.endsWith(" ") && !final.endsWith("\n")) {
          liveTranscriptRef.current += " ";
        }
        setText(liveTranscriptRef.current);
        setLiveInterim("");
        liveInterimRef.current = "";
      } else {
        setLiveInterim(interim);
        liveInterimRef.current = interim;
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setLiveCaptions(false);
      }
      // benign: no-speech, aborted — ignore
    };

    recognition.onend = () => {
      if (recordingActiveRef.current && speechRef.current === recognition) {
        try {
          recognition.start();
        } catch {
          /* already starting */
        }
      }
    };

    try {
      recognition.start();
    } catch {
      setLiveCaptions(false);
    }
  }, []);

  async function submitTranscript(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) {
      setError("Nothing captured. Speak clearly or type your thoughts.");
      setPhase("capture");
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

  async function submitText() {
    await submitTranscript(text);
  }

  async function startRecording() {
    setError(null);
    setLiveInterim("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

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
        mediaStreamRef.current = null;
        return;
      }

      const ext = mimeType.includes("mp4") ? "mp4" : mimeType.includes("ogg") ? "ogg" : "webm";
      recordingMimeRef.current = mimeType.split(";")[0];
      recordingExtRef.current = ext;

      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stopSpeechRecognition();
        stream.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }

        const spoken = (liveTranscriptRef.current + liveInterimRef.current).trim();
        setLiveInterim("");
        liveInterimRef.current = "";
        setText(spoken);

        const blob = new Blob(chunksRef.current, { type: recordingMimeRef.current });

        if (spoken.length >= 8) {
          await submitTranscript(spoken);
          return;
        }

        if (blob.size < 1000) {
          setError("Recording too short. Speak for at least a second, then stop.");
          setPhase("capture");
          return;
        }

        setPhase("processing");
        try {
          const dump = await api.createBrainDumpAudio(blob, `recording.${recordingExtRef.current}`);
          setResult(dump);
          setPhase("success");
        } catch (e) {
          setError(e instanceof ApiError ? e.message : "Voice processing failed. Try typing instead.");
          setPhase("capture");
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setPhase("recording");
      setRecordingSec(0);
      timerRef.current = setInterval(() => setRecordingSec((s) => s + 1), 1000);
      startSpeechRecognition(text);
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

  const displayText = phase === "recording" ? text + liveInterim : text;

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

                <div className="brain-dump-input-wrap">
                  {phase === "recording" && (
                    <div className="brain-dump-live-bar" aria-live="polite">
                      <span className="brain-dump-live-dot" aria-hidden />
                      <span>
                        {liveCaptions ? "Listening — transcript updates as you speak" : "Recording audio…"}
                      </span>
                    </div>
                  )}
                  <div className="brain-dump-textarea-shell">
                    <textarea
                      ref={textareaRef}
                      className={`brain-dump-textarea field-input${phase === "recording" ? " brain-dump-textarea-live" : ""}`}
                      placeholder={
                        phase === "recording"
                          ? "Your words will appear here…"
                          : "What's on your mind? Ideas, tasks, half-formed thoughts…"
                      }
                      value={displayText}
                      onChange={(e) => {
                        if (phase !== "recording") setText(e.target.value);
                      }}
                      rows={6}
                      readOnly={phase === "recording"}
                      aria-label="Brain dump text"
                    />
                  </div>
                </div>

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
                      <span>Start voice dump</span>
                    </button>
                  )}
                  <span className="brain-dump-voice-hint">
                    {phase === "recording" ? "Tap stop when done" : "or type above"}
                  </span>
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
