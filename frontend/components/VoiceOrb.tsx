"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Digest } from "@/lib/api";

const LAST_SPOKEN_KEY = "briefly.voiceLastSpoken";
const TAU = Math.PI * 2;
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

type Ripple = { r: number; alpha: number };

type VoiceOrbProps = {
  digest: Digest | null;
  userName?: string;
  autoSpeak?: boolean;
};

export function VoiceOrb({ digest, userName = "", autoSpeak = false }: VoiceOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const energyRef = useRef(0.06);
  const targetRef = useRef(0.06);
  const speakingRef = useRef(false);
  const ripplesRef = useRef<Ripple[]>([]);
  const reducedRef = useRef(false);
  const [speaking, setSpeaking] = useState(false);
  const [caption, setCaption] = useState("");
  const [supported, setSupported] = useState(true);

  // ── Orb animation ─────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    reducedRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const SIZE = 340;
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    ctx.scale(dpr, dpr);
    const cx = SIZE / 2;
    const cy = SIZE / 2;
    let raf = 0;

    const draw = (t: number) => {
      energyRef.current += (targetRef.current - energyRef.current) * 0.09;
      const breathe = 0.5 + 0.5 * Math.sin(t / 1500);
      const e = Math.min(1, energyRef.current + breathe * 0.05);
      const slow = reducedRef.current ? 0.25 : 1;

      ctx.clearRect(0, 0, SIZE, SIZE);

      // 1 ── Ambient bloom
      const bloomR = 150 + e * 40;
      const bloom = ctx.createRadialGradient(cx, cy, 12, cx, cy, bloomR);
      bloom.addColorStop(0, `oklch(62% 0.2 278 / ${0.22 + e * 0.32})`);
      bloom.addColorStop(0.55, `oklch(56% 0.18 270 / ${0.06 + e * 0.12})`);
      bloom.addColorStop(1, "oklch(56% 0.18 270 / 0)");
      ctx.fillStyle = bloom;
      ctx.beginPath();
      ctx.arc(cx, cy, bloomR, 0, TAU);
      ctx.fill();

      // 2 ── Faint HUD circles
      for (const r of [92, 124, 158]) {
        ctx.beginPath();
        ctx.strokeStyle = `oklch(82% 0.05 268 / 0.05)`;
        ctx.lineWidth = 1;
        ctx.arc(cx, cy, r, 0, TAU);
        ctx.stroke();
      }

      // 3 ── Outer dashed ring (slow rotation)
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(t * 0.00006 * slow);
      ctx.setLineDash([2, 9]);
      ctx.beginPath();
      ctx.strokeStyle = `oklch(78% 0.08 262 / ${0.16 + e * 0.14})`;
      ctx.lineWidth = 1;
      ctx.arc(0, 0, 150, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // 4 ── Tick ring (gauge marks)
      const ticks = 64;
      for (let i = 0; i < ticks; i++) {
        const ang = (i / ticks) * TAU + t * 0.00004 * slow;
        const major = i % 4 === 0;
        const inner = 132;
        const outer = inner + (major ? 9 : 5);
        ctx.beginPath();
        ctx.strokeStyle = `oklch(82% 0.07 260 / ${(major ? 0.22 : 0.1) + e * 0.18})`;
        ctx.lineWidth = major ? 1.3 : 0.8;
        ctx.moveTo(cx + Math.cos(ang) * inner, cy + Math.sin(ang) * inner);
        ctx.lineTo(cx + Math.cos(ang) * outer, cy + Math.sin(ang) * outer);
        ctx.stroke();
      }

      // 5 ── Rotating arc segments (the "active" rings)
      const arcs = [
        { r: 104, span: 1.4, speed: 0.00024, dir: 1, alpha: 0.5, w: 2.2 },
        { r: 117, span: 0.7, speed: 0.00018, dir: -1, alpha: 0.42, w: 1.7 },
        { r: 117, span: 0.4, speed: 0.00031, dir: -1, alpha: 0.3, w: 1.4 },
        { r: 131, span: 2.1, speed: 0.00011, dir: 1, alpha: 0.26, w: 1.2 },
      ];
      for (const a of arcs) {
        const start = t * a.speed * a.dir * slow * (1 + e * 1.6);
        ctx.beginPath();
        ctx.strokeStyle = `oklch(83% 0.13 256 / ${a.alpha + e * 0.32})`;
        ctx.lineWidth = a.w + e * 0.9;
        ctx.lineCap = "round";
        ctx.arc(cx, cy, a.r, start, start + a.span);
        ctx.stroke();
      }

      // 6 ── Voice ripples (spawned on word boundaries)
      const ripples = ripplesRef.current;
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i];
        rp.r += 1.8;
        rp.alpha *= 0.95;
        if (rp.alpha < 0.02) {
          ripples.splice(i, 1);
          continue;
        }
        ctx.beginPath();
        ctx.strokeStyle = `oklch(85% 0.12 258 / ${rp.alpha})`;
        ctx.lineWidth = 1.4;
        ctx.arc(cx, cy, rp.r, 0, TAU);
        ctx.stroke();
      }

      // 7 ── Organic audio-reactive waveform ring
      const points = 110;
      const baseR = 76 + e * 8;
      const amp = 5 + e * 28;
      ctx.beginPath();
      for (let i = 0; i <= points; i++) {
        const ang = (i / points) * TAU;
        const wave =
          Math.sin(ang * 3 + t * 0.0030 * slow) * 0.5 +
          Math.sin(ang * 5 - t * 0.0021 * slow) * 0.3 +
          Math.sin(ang * 9 + t * 0.0042 * slow) * 0.2;
        const r = baseR + wave * amp;
        const x = cx + Math.cos(ang) * r;
        const y = cy + Math.sin(ang) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = `oklch(86% 0.14 252 / ${0.4 + e * 0.5})`;
      ctx.lineWidth = 1.5 + e * 1.6;
      ctx.shadowColor = `oklch(76% 0.16 258 / 0.85)`;
      ctx.shadowBlur = 12 + e * 20;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // 8 ── Glowing core
      const coreR = 38 + e * 18;
      ctx.shadowColor = `oklch(66% 0.2 278 / 0.9)`;
      ctx.shadowBlur = 26 + e * 32;
      const core = ctx.createRadialGradient(cx - coreR * 0.32, cy - coreR * 0.32, 2, cx, cy, coreR);
      core.addColorStop(0, `oklch(96% 0.035 280)`);
      core.addColorStop(0.45, `oklch(74% 0.18 280)`);
      core.addColorStop(1, `oklch(50% 0.19 276)`);
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
      // core rim highlight
      ctx.beginPath();
      ctx.strokeStyle = `oklch(94% 0.05 280 / ${0.3 + e * 0.35})`;
      ctx.lineWidth = 1;
      ctx.arc(cx, cy, coreR * 0.9, 0, TAU);
      ctx.stroke();

      // 9 ── Orbiting motes
      const motes = 7;
      for (let i = 0; i < motes; i++) {
        const a = t * 0.0003 * slow * (i % 2 ? -1 : 1) + (i / motes) * TAU;
        const rr = 64 + i * 6 + e * 14 * Math.sin(t / 600 + i);
        const mx = cx + Math.cos(a) * rr;
        const my = cy + Math.sin(a) * rr;
        ctx.beginPath();
        ctx.fillStyle = `oklch(86% 0.12 256 / ${0.32 + e * 0.5})`;
        ctx.arc(mx, my, 1.4 + e * 1.4, 0, TAU);
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
    targetRef.current = 0.55;
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
          energyRef.current = Math.min(1, energyRef.current + 0.24);
          if (!reducedRef.current) {
            const rp = ripplesRef.current;
            rp.push({ r: 50, alpha: 0.5 });
            if (rp.length > 6) rp.shift();
          }
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
        {speaking ? (
          <>
            <span className="vo-btn-bars" aria-hidden>
              <i></i>
              <i></i>
              <i></i>
            </span>
            Stop
          </>
        ) : (
          "Listen to my briefing"
        )}
      </button>

      {!supported && (
        <p className="vo-unsupported">
          Voice isn&apos;t supported in this browser — try Chrome or Edge.
        </p>
      )}
    </div>
  );
}
