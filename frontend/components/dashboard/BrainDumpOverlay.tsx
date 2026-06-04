"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { api, ApiError, type BrainDump } from "@/lib/api";
import { BrainDumpHistory } from "./BrainDumpHistory";
import {
  buildTranscriptFromResults,
  createSpeechRecognition,
  formatLiveTranscript,
  isLiveSpeechSupported,
  joinTranscriptParts,
  RECOVERABLE_SPEECH_ERRORS,
  type BrowserSpeechRecognition,
  type SpeechRecognitionErrorEvent,
  type SpeechRecognitionEvent,
} from "@/lib/speechRecognition";

type Phase = "capture" | "starting" | "recording" | "processing" | "success";

type OverlayView = "compose" | "history";

type BrainDumpOverlayProps = {
  open: boolean;
  onClose: () => void;
};

const RECORDER_TIMESLICE_MS = 1_000;

const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
  sampleRate: { ideal: 48_000 },
};

export function BrainDumpOverlay({ open, onClose }: BrainDumpOverlayProps) {
  const [phase, setPhase] = useState<Phase>("capture");
  const [text, setText] = useState("");
  const [interimText, setInterimText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BrainDump | null>(null);
  const [recordingSec, setRecordingSec] = useState(0);
  const [liveSpeechActive, setLiveSpeechActive] = useState(false);
  const [processingLabel, setProcessingLabel] = useState("Saving your dump…");
  const [view, setView] = useState<OverlayView>("compose");
  const [historyRefresh, setHistoryRefresh] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const speechRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingActiveRef = useRef(false);
  const webSpeechCommittedRef = useRef("");
  const webSpeechInterimRef = useRef("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const liveTranscriptElRef = useRef<HTMLDivElement>(null);
  const recordingMimeRef = useRef("");
  const recordingExtRef = useRef("webm");

  const stopLiveSpeech = useCallback(() => {
    const recognition = speechRecognitionRef.current;
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try {
      recognition.stop();
    } catch {
      /* ignore */
    }
    speechRecognitionRef.current = null;
    setLiveSpeechActive(false);
  }, []);

  const refreshLiveTranscript = useCallback(() => {
    setText(formatLiveTranscript(webSpeechCommittedRef.current));
    setInterimText(webSpeechInterimRef.current);
  }, []);

  const stopRecordingSession = useCallback(() => {
    recordingActiveRef.current = false;
    stopLiveSpeech();
  }, [stopLiveSpeech]);

  const startLiveSpeech = useCallback(() => {
    if (!isLiveSpeechSupported()) return;

    const attachHandlers = (recognition: BrowserSpeechRecognition) => {
      recognition.onresult = (event: SpeechRecognitionEvent) => {
        if (!recordingActiveRef.current) return;
        const { committed, interim } = buildTranscriptFromResults(event.results);
        webSpeechCommittedRef.current = committed;
        webSpeechInterimRef.current = interim;
        refreshLiveTranscript();
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (!recordingActiveRef.current) return;
        if (!RECOVERABLE_SPEECH_ERRORS.has(event.error)) {
          setError("Live captions paused — audio is still recording.");
        }
      };

      recognition.onend = () => {
        if (!recordingActiveRef.current || speechRecognitionRef.current !== recognition) return;
        try {
          recognition.start();
        } catch {
          /* session may already be restarting */
        }
      };
    };

    const recognition = createSpeechRecognition();
    if (!recognition) return;
    speechRecognitionRef.current = recognition;
    attachHandlers(recognition);
    try {
      recognition.start();
      setLiveSpeechActive(true);
    } catch {
      speechRecognitionRef.current = null;
      setLiveSpeechActive(false);
    }
  }, [refreshLiveTranscript]);

  const reset = useCallback(() => {
    stopRecordingSession();
    setPhase("capture");
    setText("");
    setInterimText("");
    setError(null);
    setResult(null);
    setRecordingSec(0);
    setProcessingLabel("Saving your dump…");
    setView("compose");
    webSpeechCommittedRef.current = "";
    webSpeechInterimRef.current = "";
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
  }, [stopRecordingSession]);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase !== "processing" && phase !== "starting") onClose();
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
    if (phase === "recording" && liveTranscriptElRef.current) {
      liveTranscriptElRef.current.scrollTop = liveTranscriptElRef.current.scrollHeight;
    }
  }, [text, interimText, phase]);

  function browserTranscriptFallback(): string {
    return joinTranscriptParts(
      webSpeechCommittedRef.current,
      webSpeechInterimRef.current,
    ).trim();
  }

  async function submitTranscript(raw: string, viaAudio = false) {
    const trimmed = raw.trim();
    if (!trimmed) {
      setError("Nothing captured. Speak clearly or type your thoughts.");
      setPhase("capture");
      return;
    }
    setError(null);
    setProcessingLabel(viaAudio ? "Structuring your thoughts…" : "Structuring your thoughts…");
    setPhase("processing");
    try {
      const dump = await api.createBrainDump({ text: trimmed });
      setResult(dump);
      setHistoryRefresh((k) => k + 1);
      setPhase("success");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to save. Try again.");
      setPhase("capture");
    }
  }

  async function submitAudio(blob: Blob, filename: string) {
    setText("");
    setInterimText("");
    setProcessingLabel("Transcribing your recording…");
    setPhase("processing");
    try {
      setProcessingLabel("Structuring your thoughts…");
      const dump = await api.createBrainDumpAudio(blob, filename);
      setResult(dump);
      setHistoryRefresh((k) => k + 1);
      setPhase("success");
    } catch (e) {
      const fallback = browserTranscriptFallback();
      if (fallback.length >= 3) {
        await submitTranscript(fallback, true);
        return;
      }
      setError(e instanceof ApiError ? e.message : "Voice processing failed. Try typing instead.");
      setPhase("capture");
    }
  }

  async function submitText() {
    if (phase === "recording") {
      stopRecording();
      return;
    }
    await submitTranscript(text);
  }

  async function startRecording() {
    setError(null);
    setPhase("starting");
    webSpeechCommittedRef.current = "";
    webSpeechInterimRef.current = "";

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
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
        setPhase("capture");
        return;
      }

      const ext = mimeType.includes("mp4") ? "mp4" : mimeType.includes("ogg") ? "ogg" : "webm";
      recordingMimeRef.current = mimeType.split(";")[0];
      recordingExtRef.current = ext;

      const recorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 128_000,
      });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stopRecordingSession();
        stream.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }

        const blob = new Blob(chunksRef.current, { type: recordingMimeRef.current });
        const fallback = browserTranscriptFallback();

        if (blob.size < 1000) {
          if (fallback.length >= 3) {
            await submitTranscript(fallback, false);
          } else {
            setError("Recording too short. Speak for at least a second, then stop.");
            setPhase("capture");
          }
          return;
        }

        await submitAudio(blob, `recording.${recordingExtRef.current}`);
      };

      mediaRecorderRef.current = recorder;
      recordingActiveRef.current = true;
      setPhase("recording");
      setRecordingSec(0);
      setText("");
      setInterimText("");
      setError(null);
      timerRef.current = setInterval(() => setRecordingSec((s) => s + 1), 1000);
      recorder.start(RECORDER_TIMESLICE_MS);
      startLiveSpeech();
    } catch {
      setError("Microphone access denied. Use text input instead.");
      setPhase("capture");
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current?.state === "recording") {
      setProcessingLabel("Finishing up…");
      setPhase("processing");
      try {
        mediaRecorderRef.current.requestData();
      } catch {
        /* ignore */
      }
      mediaRecorderRef.current.stop();
    }
  }

  function handleClose() {
    if (phase === "processing" || phase === "starting") return;
    onClose();
  }

  const intentLabel: Record<string, string> = {
    action_item: "Action items",
    project_idea: "Project idea",
    general_context: "Context",
  };

  const isBusy = phase === "processing" || phase === "starting";
  const isRecording = phase === "recording";
  const hasLiveContent = Boolean(text.trim() || interimText.trim());
  const showLiveTranscript = isRecording && (hasLiveContent || liveSpeechActive);
  const showListeningEmpty = isRecording && !hasLiveContent;

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
                  {phase === "success"
                    ? "Captured"
                    : view === "history"
                      ? "Past dumps"
                      : isRecording
                        ? "Speak freely"
                        : "Dump your thoughts"}
                </h2>
              </div>
              <button
                type="button"
                className="brain-dump-close"
                onClick={handleClose}
                disabled={isBusy}
                aria-label="Close"
              >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M18 6L6 18M6 6l12 12"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </header>

            {phase !== "success" && (
              <div className="brain-dump-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === "compose"}
                  className={`brain-dump-tab${view === "compose" ? " active" : ""}`}
                  onClick={() => setView("compose")}
                  disabled={isBusy || isRecording}
                >
                  New dump
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === "history"}
                  className={`brain-dump-tab${view === "history" ? " active" : ""}`}
                  onClick={() => setView("history")}
                  disabled={isBusy || isRecording}
                >
                  Past dumps
                </button>
              </div>
            )}

            <div className="brain-dump-panel-body">
            {view === "history" && phase !== "success" ? (
              <div className="brain-dump-history-panel">
                <BrainDumpHistory
                  refreshKey={historyRefresh}
                  onNewDump={() => setView("compose")}
                />
              </div>
            ) : phase === "success" && result ? (
              <div className="brain-dump-success">
                <p className="brain-dump-success-summary">{result.clean_summary}</p>
                <div className="brain-dump-meta-row">
                  <span className="brain-dump-badge">{intentLabel[result.intent_type] ?? result.intent_type}</span>
                  {result.should_inject_into_morning_brief && (
                    <span className="brain-dump-badge brain-dump-badge-accent">Queued for your next briefing</span>
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
                {result.raw_transcript && (
                  <details className="brain-dump-raw-details">
                    <summary>Original transcript</summary>
                    <p className="brain-dump-raw-text">{result.raw_transcript}</p>
                  </details>
                )}
                {(result.tomorrow_brief_preview || result.should_inject_into_morning_brief) && (
                  <div className="brain-dump-tomorrow-preview">
                    <p className="brain-dump-tomorrow-label">What happens next</p>
                    <p className="brain-dump-tomorrow-text">
                      {result.tomorrow_brief_preview ||
                        "Tomorrow's brief will reflect what you shared and prioritize related stories."}
                    </p>
                  </div>
                )}
                <p className="brain-dump-footnote">
                  Briefly updated your relevance profile from this dump.
                </p>
                <div className="brain-dump-success-actions">
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => {
                      setPhase("capture");
                      setResult(null);
                      setView("history");
                    }}
                  >
                    View all dumps
                  </button>
                  <button type="button" className="btn-primary brain-dump-done-btn" onClick={onClose}>
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <div className="brain-dump-compose">
                <p className="brain-dump-hint">
                  {isRecording
                    ? liveSpeechActive
                      ? "Words appear as you speak. Briefly polishes the full recording when you stop."
                      : isLiveSpeechSupported()
                        ? "Recording audio — live captions will appear when your browser allows them."
                        : "Recording audio — a polished transcript appears when you stop."
                    : isBusy
                      ? "Hang tight while Briefly processes your recording."
                      : "Stream of consciousness is fine. Briefly cleans it up and feeds your second brain."}
                </p>

                <div className={`brain-dump-input-wrap${isBusy ? " brain-dump-input-busy" : ""}`}>
                  {phase === "starting" && (
                    <div className="brain-dump-live-bar">
                      <span className="btn-spinner brain-dump-live-spinner" aria-hidden />
                      <span>Starting microphone…</span>
                    </div>
                  )}
                  {isRecording && (
                    <div className="brain-dump-live-bar">
                      <span className="brain-dump-live-dot" aria-hidden />
                      <span>
                        {liveSpeechActive ? "Listening · live captions" : "Recording"}
                      </span>
                      <span className="brain-dump-live-timer">{recordingSec}s</span>
                    </div>
                  )}
                  {isBusy && phase !== "starting" && (
                    <div className="brain-dump-live-bar brain-dump-live-bar-processing">
                      <span className="btn-spinner brain-dump-live-spinner" aria-hidden />
                      <span>{processingLabel}</span>
                    </div>
                  )}

                  <div className="brain-dump-textarea-shell">
                    {showListeningEmpty && (
                      <div className="brain-dump-listening-placeholder" aria-hidden>
                        <span className="brain-dump-listening-wave" />
                        <span className="brain-dump-listening-wave" />
                        <span className="brain-dump-listening-wave" />
                        <p>Listening… start speaking</p>
                      </div>
                    )}
                    {showLiveTranscript ? (
                      <div
                        ref={liveTranscriptElRef}
                        className="brain-dump-textarea brain-dump-textarea-live brain-dump-live-transcript"
                        aria-label="Live transcript"
                      >
                        {text ? (
                          <span className="brain-dump-live-committed">{text}</span>
                        ) : null}
                        {interimText ? (
                          <span className="brain-dump-live-interim">{interimText}</span>
                        ) : null}
                      </div>
                    ) : isRecording ? (
                      <div className="brain-dump-recording-stage brain-dump-recording-stage-fallback" aria-hidden>
                        <div className="brain-dump-recording-ring">
                          <span className="brain-dump-listening-wave" />
                          <span className="brain-dump-listening-wave" />
                          <span className="brain-dump-listening-wave" />
                        </div>
                        <p className="brain-dump-recording-sublabel">Waiting for speech…</p>
                      </div>
                    ) : isBusy ? (
                      <div className="brain-dump-processing-stage" aria-live="polite">
                        <span className="btn-spinner brain-dump-live-spinner" aria-hidden />
                        <p className="brain-dump-processing-label">{processingLabel}</p>
                      </div>
                    ) : (
                      <textarea
                        ref={textareaRef}
                        className="brain-dump-textarea"
                        placeholder="What's on your mind? Ideas, tasks, half-formed thoughts…"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        rows={6}
                        disabled={isBusy}
                        aria-label="Brain dump text"
                      />
                    )}
                  </div>
                </div>

                <div className="brain-dump-voice-row">
                  {isRecording ? (
                    <button
                      type="button"
                      className="brain-dump-mic brain-dump-mic-active"
                      onClick={stopRecording}
                    >
                      <span className="brain-dump-mic-pulse" aria-hidden />
                      <svg className="brain-dump-mic-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <rect x="6" y="6" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.75" />
                      </svg>
                      <span>Stop recording</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="brain-dump-mic"
                      onClick={startRecording}
                      disabled={isBusy}
                    >
                      <svg className="brain-dump-mic-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                          d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Z"
                          stroke="currentColor"
                          strokeWidth="1.75"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M19 11v1a7 7 0 0 1-14 0v-1M12 18v3M8 21h8"
                          stroke="currentColor"
                          strokeWidth="1.75"
                          strokeLinecap="round"
                        />
                      </svg>
                      <span>Start voice dump</span>
                    </button>
                  )}
                  <span className="brain-dump-voice-divider" aria-hidden />
                  <span className="brain-dump-voice-hint">
                    {isRecording
                      ? "Tap stop when done, or use Stop & save"
                      : "or type above"}
                  </span>
                </div>

                {error && <p className="form-error brain-dump-error">{error}</p>}

                <div className="brain-dump-actions">
                  <button type="button" className="brain-dump-cancel" onClick={handleClose} disabled={isBusy}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="brain-dump-save-btn"
                    onClick={submitText}
                    disabled={isBusy || (phase === "capture" && !text.trim())}
                  >
                    {isBusy ? (
                      <>
                        <span className="btn-spinner brain-dump-btn-spinner" aria-hidden />
                        Saving…
                      </>
                    ) : isRecording ? (
                      "Stop & save"
                    ) : (
                      "Save dump"
                    )}
                  </button>
                </div>
              </div>
            )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
