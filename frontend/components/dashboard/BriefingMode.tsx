"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type Digest } from "@/lib/api";
import {
  getSharedPlaybackAudio,
  speakWithBrowser,
  stopAllBrieflyAudio,
  stopSpeechSynthesis,
} from "@/lib/audioPlayback";
import { JarvisOrbCanvas } from "@/components/mobile/JarvisOrbCanvas";

type Segment = { kind: "greeting" | "intro" | "item" | "outro"; text: string };
type Status = "loading" | "playing" | "paused" | "blocked" | "done" | "error";

function timeGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function buildSegments(digest: Digest, name: string | null): Segment[] {
  const who = name?.split(" ")[0]?.trim();
  const items = (digest.items ?? []).slice(0, 5);
  const count = digest.total_items_shown || items.length;
  const segs: Segment[] = [
    { kind: "greeting", text: `${timeGreeting()}${who ? `, ${who}` : ""}.` },
    {
      kind: "intro",
      text: count
        ? `Here's your briefing. ${count} ${count === 1 ? "thing" : "things"} worth your time today.`
        : "Here's your briefing for today.",
    },
  ];
  for (const it of items) {
    const lead = (it.headline ?? "").trim();
    const why = (it.why_it_matters ?? it.summary ?? "").trim();
    if (!lead) continue;
    segs.push({ kind: "item", text: why ? `${lead}. ${why}` : lead });
  }
  segs.push({
    kind: "outro",
    text: "That's your brief. Tap the orb to ask me anything about it.",
  });
  return segs.filter((s) => s.text);
}

export function BriefingMode({
  open,
  digest,
  userName,
  onClose,
}: {
  open: boolean;
  digest: Digest | null;
  userName: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState(0);

  const cacheRef = useRef<Map<number, string>>(new Map());
  const synthControllersRef = useRef<Map<number, AbortController>>(new Map());
  const sessionRef = useRef(0);
  const resolveRef = useRef<(() => void) | null>(null);
  const pendingUrlRef = useRef<string | null>(null);
  const pendingTextRef = useRef<string>("");
  const runNarrationRef = useRef<((from: number) => Promise<void>) | null>(null);
  const userNameRef = useRef(userName);
  const useBrowserVoiceRef = useRef(false);

  userNameRef.current = userName;

  const stopAudio = useCallback(() => {
    resolveRef.current?.();
    resolveRef.current = null;
    stopAllBrieflyAudio();
  }, []);

  const revokeCache = useCallback(() => {
    Array.from(cacheRef.current.values()).forEach((url) => URL.revokeObjectURL(url));
    cacheRef.current.clear();
  }, []);

  const cleanup = useCallback(() => {
    sessionRef.current += 1;
    synthControllersRef.current.forEach((c) => c.abort());
    synthControllersRef.current.clear();
    stopAudio();
    revokeCache();
    pendingUrlRef.current = null;
    pendingTextRef.current = "";
    useBrowserVoiceRef.current = false;
  }, [revokeCache, stopAudio]);

  const synth = useCallback(async (segs: Segment[], i: number, session: number): Promise<string | null> => {
    if (session !== sessionRef.current || useBrowserVoiceRef.current) return null;
    if (i < 0 || i >= segs.length) return null;
    const cached = cacheRef.current.get(i);
    if (cached) return cached;
    const ctl = new AbortController();
    synthControllersRef.current.set(i, ctl);
    try {
      const blob = await api.orbSpeak(segs[i].text, undefined, ctl.signal);
      if (session !== sessionRef.current) return null;
      const url = URL.createObjectURL(blob);
      cacheRef.current.set(i, url);
      return url;
    } catch {
      return null;
    } finally {
      synthControllersRef.current.delete(i);
    }
  }, []);

  const playUrl = useCallback(
    async (url: string, text: string, session: number): Promise<"played" | "blocked" | "skipped"> => {
      if (session !== sessionRef.current) return "skipped";
      stopAudio();

      return new Promise((resolve) => {
        const audio = getSharedPlaybackAudio();
        pendingUrlRef.current = url;
        pendingTextRef.current = text;

        const finish = (result: "played" | "blocked" | "skipped") => {
          audio.removeEventListener("ended", onEnded);
          audio.removeEventListener("timeupdate", onTime);
          audio.removeEventListener("error", onError);
          resolveRef.current = null;
          resolve(result);
        };

        const onEnded = () => finish("played");
        const onError = () => finish("blocked");
        const onTime = () => {
          if (audio.duration > 0) setProgress(audio.currentTime / audio.duration);
        };

        resolveRef.current = () => finish("skipped");

        audio.addEventListener("ended", onEnded);
        audio.addEventListener("timeupdate", onTime);
        audio.addEventListener("error", onError);
        audio.src = url;

        void audio.play().then(() => {
          if (session !== sessionRef.current) {
            audio.pause();
            finish("skipped");
            return;
          }
          setStatus("playing");
        }).catch(() => {
          if (session !== sessionRef.current) {
            finish("skipped");
            return;
          }
          setStatus("blocked");
          finish("blocked");
        });
      });
    },
    [stopAudio],
  );

  const playSegment = useCallback(
    async (segs: Segment[], i: number, session: number): Promise<"continue" | "stop"> => {
      if (useBrowserVoiceRef.current) {
        await speakWithBrowser(segs[i].text);
        if (session !== sessionRef.current) return "stop";
        return "continue";
      }

      const url = await synth(segs, i, session);
      if (session !== sessionRef.current) return "stop";
      if (i + 1 < segs.length) void synth(segs, i + 1, session);

      if (url) {
        const result = await playUrl(url, segs[i].text, session);
        if (result === "blocked") return "stop";
        return "continue";
      }

      // Server TTS unavailable — use browser voice for the whole briefing (never both).
      useBrowserVoiceRef.current = true;
      synthControllersRef.current.forEach((c) => c.abort());
      synthControllersRef.current.clear();
      revokeCache();
      await speakWithBrowser(segs[i].text);
      if (session !== sessionRef.current) return "stop";
      setStatus("playing");
      return "continue";
    },
    [playUrl, revokeCache, synth],
  );

  useEffect(() => {
    if (!open) return;
    if (!digest) {
      setStatus("error");
      return;
    }

    const session = sessionRef.current + 1;
    sessionRef.current = session;
    stopAllBrieflyAudio();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("briefly:pause-orb-audio"));
    }

    const segs = buildSegments(digest, userNameRef.current);
    setSegments(segs);
    setIndex(0);
    setProgress(0);
    setStatus("loading");
    useBrowserVoiceRef.current = false;

    const runNarration = async (from: number) => {
      for (let i = from; i < segs.length; i++) {
        if (session !== sessionRef.current) return;
        setIndex(i);
        setProgress(0);
        const next = await playSegment(segs, i, session);
        if (next === "stop" || session !== sessionRef.current) return;
      }
      if (session === sessionRef.current) setStatus("done");
    };

    runNarrationRef.current = runNarration;
    void runNarration(0);

    return cleanup;
  }, [open, digest?.id, cleanup, playSegment]);

  const pause = () => {
    getSharedPlaybackAudio().pause();
    stopSpeechSynthesis();
    setStatus("paused");
  };

  const resume = () => {
    const audio = getSharedPlaybackAudio();
    if (audio.src) {
      void audio.play().then(() => setStatus("playing")).catch(() => setStatus("blocked"));
      return;
    }
    setStatus("playing");
  };

  const resumeBlocked = () => {
    const url = pendingUrlRef.current;
    const text = pendingTextRef.current;
    const session = sessionRef.current;
    const fromIndex = index;
    if (url) {
      void playUrl(url, text, session).then((result) => {
        if (result !== "played" || session !== sessionRef.current) return;
        void runNarrationRef.current?.(fromIndex + 1);
      });
      return;
    }
    if (text) {
      void speakWithBrowser(text).then(() => {
        if (session !== sessionRef.current) return;
        void runNarrationRef.current?.(fromIndex + 1);
      });
    }
  };

  const skip = () => {
    stopAudio();
    resolveRef.current?.();
  };

  const handleClose = () => {
    cleanup();
    onClose();
  };

  const handleAsk = () => {
    cleanup();
    onClose();
    router.push("/ask");
  };

  if (!open) return null;

  const current = segments[index];
  const words = current ? current.text.split(/\s+/).filter(Boolean) : [];
  const revealed = Math.round(progress * words.length);
  const orbMode = status === "playing" ? "speaking" : "idle";

  return (
    <div className="briefmode" role="dialog" aria-modal="true" aria-label="Voice briefing">
      <div className="briefmode-veil" aria-hidden />
      <button type="button" className="briefmode-close" onClick={handleClose} aria-label="Close briefing">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

      <div className="briefmode-stage">
        <button
          type="button"
          className={`briefmode-orb mode-${orbMode}`}
          onClick={handleAsk}
          aria-label="Ask Briefly about your brief"
        >
          <JarvisOrbCanvas mode={orbMode} size="stage" className="briefmode-orb-canvas" />
        </button>

        {status === "error" ? (
          <p className="briefmode-caption">No brief is ready yet. Generate today&apos;s brief first.</p>
        ) : status === "blocked" ? (
          <p className="briefmode-caption">Tap play to start narration.</p>
        ) : status === "done" ? (
          <p className="briefmode-caption">That&apos;s your brief. Tap the orb to ask anything.</p>
        ) : (
          <p className="briefmode-caption" aria-hidden>
            {words.map((w, i) => (
              <span key={`${w}-${i}`} className={`briefmode-word${i < revealed ? " is-spoken" : ""}`}>
                {w}{" "}
              </span>
            ))}
          </p>
        )}

        {segments.length > 0 && status !== "error" && (
          <div className="briefmode-progress" aria-hidden>
            {segments.map((_, i) => (
              <span key={i} className={`briefmode-dot${i === index ? " is-active" : ""}${i < index ? " is-done" : ""}`} />
            ))}
          </div>
        )}
      </div>

      <div className="briefmode-controls">
        {status === "blocked" && (
          <button type="button" className="briefmode-btn briefmode-btn-primary" onClick={resumeBlocked}>
            Play narration
          </button>
        )}
        {status === "loading" && (
          <button type="button" className="briefmode-btn" disabled>
            Preparing audio…
          </button>
        )}
        {status === "playing" && (
          <button type="button" className="briefmode-btn" onClick={pause}>
            Pause
          </button>
        )}
        {status === "paused" && (
          <button type="button" className="briefmode-btn" onClick={resume}>
            Resume
          </button>
        )}
        {(status === "playing" || status === "paused") && (
          <button type="button" className="briefmode-btn" onClick={skip}>
            Skip
          </button>
        )}
        <button type="button" className="briefmode-btn briefmode-btn-primary" onClick={handleAsk}>
          Ask Briefly
        </button>
      </div>
    </div>
  );
}
