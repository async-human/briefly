"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Digest } from "@/lib/api";

const LAST_SPOKEN_KEY = "briefly.voiceLastSpoken";
const todayKey = () => new Date().toISOString().slice(0, 10);

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function buildLines(digest: Digest | null, name: string): string[] {
  const hi = greeting() + (name ? `, ${name}` : "") + ".";
  const items = digest?.items ?? [];

  if (items.length === 0) {
    return [
      hi,
      "Your briefing isn't ready just yet. Open Briefly to finish connecting your sources, and I'll have it for you soon.",
    ];
  }

  const top = items.slice(0, 3);
  const count = digest?.total_items_shown || items.length;
  const lines = [hi, `Here's your briefing. ${count} ${count === 1 ? "thing" : "things"} matter today.`];

  const ordinals = ["First", "Second", "Third"];
  top.forEach((it, i) => {
    lines.push(`${ordinals[i] ?? ""}. ${it.headline}.`.trim());
    const why = it.why_this_summary || it.why_it_matters;
    if (why) lines.push(why);
  });

  lines.push("That's the headline view. Open Briefly for the full briefing.");
  return lines;
}

function pickVoice(): SpeechSynthesisVoice | undefined {
  if (!("speechSynthesis" in window)) return undefined;
  const vs = speechSynthesis.getVoices();
  return (
    vs.find((v) => /en(-|_)?(US|GB)/i.test(v.lang) && /natural|google|samantha|aria|jenny|libby/i.test(v.name)) ||
    vs.find((v) => /^en/i.test(v.lang)) ||
    vs[0]
  );
}

type VoiceOrbProps = {
  digest: Digest | null;
  userName?: string;
  /** Speak automatically the first time it's opened each day. */
  autoSpeak?: boolean;
};

export function VoiceOrb({ digest, userName = "", autoSpeak = false }: VoiceOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const energyRef = useRef(0.06);
  const targetRef = useRef(0.06);
  const speakingRef = useRef(false);
  const [speaking, setSpeaking] = useState(false);
  const [caption, setCaption] = useState("");
  const [supported, setSupported] = useState(true);

  // ── Orb animation ─────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const SIZE = 220;
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    ctx.scale(dpr, dpr);
    const cx = SIZE / 2;
    const cy = SIZE / 2;
    const hue = 275;
    let raf = 0;

    const draw = (t: number) => {
      energyRef.current += (targetRef.current - energyRef.current) * 0.08;
      const breathe = 0.5 + 0.5 * Math.sin(t / 1400);
      const e = Math.min(1, energyRef.current + breathe * 0.04);

      ctx.clearRect(0, 0, SIZE, SIZE);

      const glowR = 56 + e * 40;
      const glow = ctx.createRadialGradient(cx, cy, 10, cx, cy, glowR);
      glow.addColorStop(0, `oklch(62% 0.19 ${hue} / ${0.32 + e * 0.4})`);
      glow.addColorStop(0.6, `oklch(58% 0.18 ${hue} / ${0.1 + e * 0.16})`);
      glow.addColorStop(1, `oklch(58% 0.18 ${hue} / 0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
      ctx.fill();

      const rings = [
        { r: 50, w: 1.5, speed: 0.00018, span: 1.7, alpha: 0.55 },
        { r: 62, w: 1.2, speed: -0.00012, span: 1.2, alpha: 0.4 },
        { r: 74, w: 1.0, speed: 0.00009, span: 2.3, alpha: 0.28 },
      ];
      for (const ring of rings) {
        const wobble = 1 + e * 0.12 * Math.sin(t / 500 + ring.r);
        const start = t * ring.speed * (1 + e * 2);
        ctx.beginPath();
        ctx.strokeStyle = `oklch(72% 0.16 ${hue} / ${ring.alpha + e * 0.3})`;
        ctx.lineWidth = ring.w + e * 0.8;
        ctx.lineCap = "round";
        ctx.arc(cx, cy, ring.r * wobble, start, start + ring.span);
        ctx.stroke();
      }

      const coreR = 28 + e * 14;
      const core = ctx.createRadialGradient(cx - coreR * 0.3, cy - coreR * 0.3, 3, cx, cy, coreR);
      core.addColorStop(0, `oklch(86% 0.1 ${hue})`);
      core.addColorStop(0.5, `oklch(64% 0.2 ${hue})`);
      core.addColorStop(1, `oklch(48% 0.18 ${hue})`);
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fill();

      const motes = 5;
      for (let i = 0; i < motes; i++) {
        const a = t * 0.0004 * (i % 2 ? -1 : 1) + (i / motes) * Math.PI * 2;
        const rr = 42 + i * 5 + e * 12 * Math.sin(t / 600 + i);
        const mx = cx + Math.cos(a) * rr;
        const my = cy + Math.sin(a) * rr;
        ctx.beginPath();
        ctx.fillStyle = `oklch(82% 0.14 ${hue} / ${0.35 + e * 0.5})`;
        ctx.arc(mx, my, 1.5 + e * 1.3, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Warm up voices (load asynchronously).
  useEffect(() => {
    if (!("speechSynthesis" in window)) {
      setSupported(false);
      return;
    }
    speechSynthesis.getVoices();
    const handler = () => speechSynthesis.getVoices();
    speechSynthesis.addEventListener("voiceschanged", handler);
    return () => speechSynthesis.removeEventListener("voiceschanged", handler);
  }, []);

  const stop = useCallback(() => {
    speakingRef.current = false;
    try {
      speechSynthesis.cancel();
    } catch {
      /* no-op */
    }
    targetRef.current = 0.06;
    setSpeaking(false);
    setCaption("");
  }, []);

  const speak = useCallback(async () => {
    if (!("speechSynthesis" in window)) {
      setSupported(false);
      return;
    }
    if (speakingRef.current) {
      stop();
      return;
    }
    speechSynthesis.cancel();
    speakingRef.current = true;
    targetRef.current = 0.5;
    setSpeaking(true);

    const lines = buildLines(digest, userName);
    for (const line of lines) {
      if (!speakingRef.current) break;
      await new Promise<void>((resolve) => {
        const u = new SpeechSynthesisUtterance(line);
        const v = pickVoice();
        if (v) u.voice = v;
        u.rate = 1.0;
        u.pitch = 1.0;
        u.onstart = () => setCaption(line);
        u.onboundary = () => {
          energyRef.current = Math.min(1, energyRef.current + 0.22);
        };
        u.onend = () => resolve();
        u.onerror = () => resolve();
        speechSynthesis.speak(u);
      });
    }

    speakingRef.current = false;
    targetRef.current = 0.06;
    setSpeaking(false);
    setCaption("");
    try {
      localStorage.setItem(LAST_SPOKEN_KEY, todayKey());
    } catch {
      /* no-op */
    }
  }, [digest, userName, stop]);

  // First open of the day → speak automatically.
  useEffect(() => {
    if (!autoSpeak) return;
    let already = "";
    try {
      already = localStorage.getItem(LAST_SPOKEN_KEY) || "";
    } catch {
      /* no-op */
    }
    if (already === todayKey()) return;
    const t = setTimeout(() => void speak(), 900);
    return () => clearTimeout(t);
  }, [autoSpeak, speak]);

  // Stop speech if the component unmounts.
  useEffect(() => stop, [stop]);

  return (
    <div className="vo">
      <button
        type="button"
        className={`vo-orb${speaking ? " is-speaking" : ""}`}
        onClick={() => void speak()}
        aria-label={speaking ? "Stop" : "Speak my briefing"}
      >
        <canvas ref={canvasRef} className="vo-canvas" />
      </button>

      <p className="vo-caption" aria-live="polite">
        {caption}
      </p>

      <button type="button" className="vo-btn" onClick={() => void speak()}>
        {speaking ? "Stop" : "Listen to my briefing"}
      </button>

      {!supported && (
        <p className="vo-unsupported">
          Voice isn&apos;t supported in this browser — try Chrome or Edge.
        </p>
      )}
    </div>
  );
}
