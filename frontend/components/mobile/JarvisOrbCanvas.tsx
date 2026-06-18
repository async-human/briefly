"use client";

import { useEffect, useRef } from "react";

export type JarvisOrbMode = "idle" | "listening" | "thinking" | "speaking";

const TAU = Math.PI * 2;

const MODE_ENERGY: Record<JarvisOrbMode, number> = {
  idle: 0.12,
  listening: 0.52,
  thinking: 0.34,
  speaking: 0.62,
};

const MODE_HUE: Record<JarvisOrbMode, number> = {
  idle: 278,
  listening: 268,
  thinking: 292,
  speaking: 280,
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
    const px = size === "fab" ? 88 : 280;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = px * dpr;
    canvas.height = px * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cx = px / 2;
    const cy = px / 2;
    const scale = px / 280;
    let raf = 0;

    const draw = (t: number) => {
      const m = modeRef.current;
      const target = MODE_ENERGY[m];
      const hue = MODE_HUE[m];
      energyRef.current += (target - energyRef.current) * 0.08;
      const breathe = 0.5 + 0.5 * Math.sin(t / 1800);
      const e = Math.min(1, energyRef.current + breathe * 0.05);
      const slow = reduced ? 0.15 : 1;

      ctx.clearRect(0, 0, px, px);

      const auraR = (size === "fab" ? 36 : 118) + e * (size === "fab" ? 8 : 22);
      const aura = ctx.createRadialGradient(cx, cy, auraR * 0.1, cx, cy, auraR);
      aura.addColorStop(0, `oklch(72% 0.12 ${hue} / ${0.14 + e * 0.2})`);
      aura.addColorStop(0.65, `oklch(68% 0.1 ${hue} / ${0.04 + e * 0.08})`);
      aura.addColorStop(1, `oklch(68% 0.1 ${hue} / 0)`);
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(cx, cy, auraR, 0, TAU);
      ctx.fill();

      const ringR = (size === "fab" ? 30 : 96) * scale;
      ctx.beginPath();
      ctx.strokeStyle = `oklch(78% 0.08 ${hue} / ${0.12 + e * 0.18})`;
      ctx.lineWidth = 1 * scale;
      ctx.arc(cx, cy, ringR, 0, TAU);
      ctx.stroke();

      if (m !== "idle") {
        const waveR = ringR + (4 + e * 6) * scale;
        const points = size === "fab" ? 36 : 64;
        ctx.beginPath();
        for (let i = 0; i <= points; i++) {
          const ang = (i / points) * TAU;
          const wobble =
            Math.sin(ang * 4 + t * 0.0028 * slow) * 0.35 +
            Math.sin(ang * 7 - t * 0.002 * slow) * 0.2;
          const r = waveR + wobble * (2 + e * 5) * scale;
          const x = cx + Math.cos(ang) * r;
          const y = cy + Math.sin(ang) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = `oklch(58% 0.14 ${hue} / ${0.22 + e * 0.35})`;
        ctx.lineWidth = (1.1 + e * 0.6) * scale;
        ctx.stroke();
      }

      const coreR = (size === "fab" ? 11 : 42) * scale + e * (size === "fab" ? 2 : 8) * scale;
      const core = ctx.createRadialGradient(
        cx - coreR * 0.35,
        cy - coreR * 0.4,
        coreR * 0.05,
        cx,
        cy,
        coreR,
      );
      core.addColorStop(0, `oklch(99% 0.02 ${hue})`);
      core.addColorStop(0.42, `oklch(82% 0.12 ${hue})`);
      core.addColorStop(1, `oklch(54% 0.14 ${hue})`);
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, TAU);
      ctx.fill();

      const highlight = ctx.createRadialGradient(
        cx - coreR * 0.45,
        cy - coreR * 0.5,
        0,
        cx - coreR * 0.2,
        cy - coreR * 0.25,
        coreR * 0.55,
      );
      highlight.addColorStop(0, "oklch(100% 0 0 / 0.55)");
      highlight.addColorStop(1, "oklch(100% 0 0 / 0)");
      ctx.fillStyle = highlight;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, TAU);
      ctx.fill();

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return <canvas ref={canvasRef} className={className} aria-hidden />;
}
