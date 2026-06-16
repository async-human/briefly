"use client";

import { useEffect, useRef } from "react";

export type JarvisOrbMode = "idle" | "listening" | "thinking" | "speaking";

const TAU = Math.PI * 2;

const MODE_ENERGY: Record<JarvisOrbMode, number> = {
  idle: 0.08,
  listening: 0.58,
  thinking: 0.38,
  speaking: 0.72,
};

const MODE_HUE: Record<JarvisOrbMode, number> = {
  idle: 215,
  listening: 185,
  thinking: 78,
  speaking: 205,
};

type JarvisOrbCanvasProps = {
  mode: JarvisOrbMode;
  size?: "fab" | "stage";
  className?: string;
};

export function JarvisOrbCanvas({ mode, size = "stage", className }: JarvisOrbCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef(mode);
  const energyRef = useRef(MODE_ENERGY.idle);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const px = size === "fab" ? 88 : 300;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = px * dpr;
    canvas.height = px * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cx = px / 2;
    const cy = px / 2;
    const scale = px / 300;
    let raf = 0;

    const draw = (t: number) => {
      const m = modeRef.current;
      const target = MODE_ENERGY[m];
      const hue = MODE_HUE[m];
      energyRef.current += (target - energyRef.current) * 0.1;
      const breathe = 0.5 + 0.5 * Math.sin(t / 1400);
      const e = Math.min(1, energyRef.current + breathe * 0.06);
      const slow = reduced ? 0.2 : 1;
      const spin =
        m === "thinking" ? 2.4 : m === "listening" ? 1.35 : m === "speaking" ? 1.1 : 0.65;

      ctx.clearRect(0, 0, px, px);

      const bloomR = (size === "fab" ? 38 : 132) + e * (size === "fab" ? 10 : 36);
      const bloom = ctx.createRadialGradient(cx, cy, 2, cx, cy, bloomR);
      bloom.addColorStop(0, `oklch(72% 0.16 ${hue} / ${0.28 + e * 0.38})`);
      bloom.addColorStop(0.55, `oklch(58% 0.14 ${hue} / ${0.08 + e * 0.14})`);
      bloom.addColorStop(1, `oklch(58% 0.14 ${hue} / 0)`);
      ctx.fillStyle = bloom;
      ctx.beginPath();
      ctx.arc(cx, cy, bloomR, 0, TAU);
      ctx.fill();

      const rings = size === "fab" ? [22, 30] : [78, 104, 132];
      for (const r of rings) {
        ctx.beginPath();
        ctx.strokeStyle = `oklch(88% 0.06 ${hue} / ${0.04 + e * 0.08})`;
        ctx.lineWidth = 1;
        ctx.arc(cx, cy, r * scale, 0, TAU);
        ctx.stroke();
      }

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(t * 0.00008 * slow * spin);
      ctx.setLineDash([2 * scale, 7 * scale]);
      ctx.beginPath();
      ctx.strokeStyle = `oklch(84% 0.1 ${hue} / ${0.18 + e * 0.2})`;
      ctx.lineWidth = 1;
      ctx.arc(0, 0, (size === "fab" ? 34 : 142) * scale, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      const ticks = size === "fab" ? 24 : 56;
      for (let i = 0; i < ticks; i++) {
        const ang = (i / ticks) * TAU + t * 0.00005 * slow * spin;
        const major = i % 4 === 0;
        const inner = (size === "fab" ? 24 : 118) * scale;
        const outer = inner + (major ? 7 : 4) * scale;
        ctx.beginPath();
        ctx.strokeStyle = `oklch(90% 0.08 ${hue} / ${(major ? 0.28 : 0.12) + e * 0.22})`;
        ctx.lineWidth = (major ? 1.2 : 0.7) * scale;
        ctx.moveTo(cx + Math.cos(ang) * inner, cy + Math.sin(ang) * inner);
        ctx.lineTo(cx + Math.cos(ang) * outer, cy + Math.sin(ang) * outer);
        ctx.stroke();
      }

      const arcs =
        size === "fab"
          ? [{ r: 26, span: 1.1, speed: 0.00032, dir: 1, alpha: 0.45, w: 1.6 }]
          : [
              { r: 92, span: 1.5, speed: 0.00028, dir: 1, alpha: 0.5, w: 2.2 },
              { r: 106, span: 0.75, speed: 0.00022, dir: -1, alpha: 0.42, w: 1.6 },
              { r: 120, span: 2.0, speed: 0.00012, dir: 1, alpha: 0.28, w: 1.2 },
            ];
      for (const a of arcs) {
        const start = t * a.speed * a.dir * slow * spin * (1 + e);
        ctx.beginPath();
        ctx.strokeStyle = `oklch(86% 0.14 ${hue} / ${a.alpha + e * 0.35})`;
        ctx.lineWidth = (a.w + e * 0.8) * scale;
        ctx.lineCap = "round";
        ctx.arc(cx, cy, a.r * scale, start, start + a.span);
        ctx.stroke();
      }

      const points = size === "fab" ? 48 : 96;
      const baseR = (size === "fab" ? 14 : 68) * scale + e * (size === "fab" ? 3 : 10);
      const amp = (size === "fab" ? 2 : 5) * scale + e * (size === "fab" ? 5 : 24) * scale;
      ctx.beginPath();
      for (let i = 0; i <= points; i++) {
        const ang = (i / points) * TAU;
        const wave =
          Math.sin(ang * 3 + t * 0.0032 * slow * spin) * 0.5 +
          Math.sin(ang * 5 - t * 0.0024 * slow * spin) * 0.3 +
          Math.sin(ang * 8 + t * 0.0048 * slow) * 0.2;
        const r = baseR + wave * amp;
        const x = cx + Math.cos(ang) * r;
        const y = cy + Math.sin(ang) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = `oklch(92% 0.12 ${hue} / ${0.45 + e * 0.5})`;
      ctx.lineWidth = (1.2 + e * 1.4) * scale;
      ctx.shadowColor = `oklch(70% 0.16 ${hue} / 0.85)`;
      ctx.shadowBlur = (8 + e * 18) * scale;
      ctx.stroke();
      ctx.shadowBlur = 0;

      const coreR = (size === "fab" ? 9 : 36) * scale + e * (size === "fab" ? 4 : 16) * scale;
      const core = ctx.createRadialGradient(
        cx - coreR * 0.3,
        cy - coreR * 0.3,
        1,
        cx,
        cy,
        coreR,
      );
      core.addColorStop(0, `oklch(98% 0.03 ${hue})`);
      core.addColorStop(0.45, `oklch(78% 0.16 ${hue})`);
      core.addColorStop(1, `oklch(52% 0.17 ${hue})`);
      ctx.fillStyle = core;
      ctx.shadowColor = `oklch(68% 0.18 ${hue} / 0.9)`;
      ctx.shadowBlur = (12 + e * 22) * scale;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden
    />
  );
}
