"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type Digest } from "@/lib/api";
import { JarvisOrbCanvas } from "@/components/mobile/JarvisOrbCanvas";

type Segment = { kind: "greeting" | "intro" | "item" | "outro"; text: string };
type Status = "loading" | "playing" | "paused" | "done" | "error";

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

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cacheRef = useRef<Map<number, string>>(new Map());
  const abortRef = useRef<AbortController | null>(null);
  const activeRef = useRef(false);
  const resolveRef = useRef<(() => void) | null>(null);

  const cleanup = useCallback(() => {
    activeRef.current = false;
    resolveRef.current?.();
    resolveRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    Array.from(cacheRef.current.values()).forEach((url) => URL.revokeObjectURL(url));
    cacheRef.current.clear();
  }, []);

  const synth = useCallback(async (segs: Segment[], i: number): Promise<string | null> => {
    if (i < 0 || i >= segs.length) return null;
    const cached = cacheRef.current.get(i);
    if (cached) return cached;
    try {
      abortRef.current = new AbortController();
      const blob = await api.orbSpeak(segs[i].text, undefined, abortRef.current.signal);
      const url = URL.createObjectURL(blob);
      cacheRef.current.set(i, url);
      return url;
    } catch {
      return null;
    }
  }, []);

  const playUrl = useCallback((url: string) => {
    return new Promise<void>((resolve) => {
      const audio = new Audio(url);
      audioRef.current = audio;
      resolveRef.current = resolve;
      const done = () => {
        audio.removeEventListener("ended", done);
        resolve();
      };
      audio.addEventListener("ended", done);
      audio.addEventListener("timeupdate", () => {
        if (audio.duration > 0) setProgress(audio.currentTime / audio.duration);
      });
      audio.play().catch(() => resolve());
    });
  }, []);

  // Main runner — starts when the overlay opens.
  useEffect(() => {
    if (!open) return;
    if (!digest) {
      setStatus("error");
      return;
    }
    const segs = buildSegments(digest, userName);
    setSegments(segs);
    setStatus("playing");
    activeRef.current = true;

    (async () => {
      for (let i = 0; i < segs.length; i++) {
        if (!activeRef.current) return;
        setIndex(i);
        setProgress(0);
        const url = await synth(segs, i);
        if (!activeRef.current) return;
        // Prefetch the next segment while this one plays.
        if (i + 1 < segs.length) void synth(segs, i + 1);
        if (url) await playUrl(url);
        if (!activeRef.current) return;
      }
      if (activeRef.current) setStatus("done");
    })();

    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, digest, userName]);

  const pause = () => {
    audioRef.current?.pause();
    setStatus("paused");
  };
  const resume = () => {
    audioRef.current?.play().catch(() => undefined);
    setStatus("playing");
  };
  const skip = () => {
    if (audioRef.current) audioRef.current.pause();
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
  const words = current ? current.text.split(/\s+/) : [];
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
        ) : status === "done" ? (
          <p className="briefmode-caption">That&apos;s your brief. Tap the orb to ask anything.</p>
        ) : (
          <p className="briefmode-caption" aria-live="polite">
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
