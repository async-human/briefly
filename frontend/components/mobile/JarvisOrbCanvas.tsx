"use client";

import { useEffect, useRef } from "react";

export type JarvisOrbMode = "idle" | "listening" | "thinking" | "speaking";

const TAU = Math.PI * 2;

const MODE_ENERGY: Record<JarvisOrbMode, number> = {
  idle: 0.18,
  listening: 0.58,
  thinking: 0.4,
  speaking: 0.68,
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
      energyRef.current += (target - energyRef.current) * 0.09;
      const breathe = 0.5 + 0.5 * Math.sin(t / 1600);
      const e = Math.min(1, energyRef.current + breathe * 0.07);
      const slow = reduced ? 0.12 : 1;
      const spin = m === "thinking" ? 1.8 : m === "listening" ? 1.2 : m === "speaking" ? 0.95 : 0.45;

      ctx.clearRect(0, 0, px, px);

      const auraR = (size === "fab" ? 38 : 128) + e * (size === "fab" ? 10 : 28);
      const aura = ctx.createRadialGradient(cx, cy, auraR * 0.08, cx, cy, auraR);
      aura.addColorStop(0, `oklch(74% 0.13 ${hue} / ${0.2 + e * 0.28})`);
      aura.addColorStop(0.5, `oklch(68% 0.11 ${hue} / ${0.06 + e * 0.12})`);
      aura.addColorStop(1, `oklch(68% 0.11 ${hue} / 0)`);
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(cx, cy, auraR, 0, TAU);
      ctx.fill();

      const ringRadii = size === "fab" ? [28, 34] : [88, 102, 118];
      for (let ri = 0; ri < ringRadii.length; ri++) {
        const r = ringRadii[ri] * scale;
        const pulse = Math.sin(t / 1400 + ri * 0.8) * 0.5 + 0.5;
        ctx.beginPath();
        ctx.strokeStyle = `oklch(72% 0.1 ${hue} / ${0.08 + pulse * 0.14 + e * 0.1})`;
        ctx.lineWidth = (0.8 + ri * 0.15) * scale;
        ctx.arc(cx, cy, r + pulse * 2 * scale, 0, TAU);
        ctx.stroke();
      }

      const arcR = (size === "fab" ? 32 : 108) * scale;
      const arcStart = t * 0.00018 * slow * spin;
      ctx.beginPath();
      ctx.strokeStyle = `oklch(58% 0.14 ${hue} / ${0.18 + e * 0.32})`;
      ctx.lineWidth = (1.4 + e * 0.8) * scale;
      ctx.lineCap = "round";
      ctx.arc(cx, cy, arcR, arcStart, arcStart + (m === "idle" ? 0.9 : 1.6));
      ctx.stroke();

      if (m !== "idle") {
        const waveR = arcR + (6 + e * 8) * scale;
        const points = size === "fab" ? 40 : 72;
        ctx.beginPath();
        for (let i = 0; i <= points; i++) {
          const ang = (i / points) * TAU;
          const wobble =
            Math.sin(ang * 4 + t * 0.003 * slow) * 0.38 +
            Math.sin(ang * 7 - t * 0.0022 * slow) * 0.22;
          const r = waveR + wobble * (2.5 + e * 6) * scale;
          const x = cx + Math.cos(ang) * r;
          const y = cy + Math.sin(ang) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = `oklch(56% 0.15 ${hue} / ${0.28 + e * 0.4})`;
        ctx.lineWidth = (1.2 + e * 0.7) * scale;
        ctx.stroke();
      }

      const coreR = (size === "fab" ? 11 : 44) * scale + e * (size === "fab" ? 2.5 : 9) * scale;
      const core = ctx.createRadialGradient(
        cx - coreR * 0.32,
        cy - coreR * 0.38,
        coreR * 0.05,
        cx,
        cy,
        coreR,
      );
      core.addColorStop(0, `oklch(99% 0.02 ${hue})`);
      core.addColorStop(0.38, `oklch(80% 0.13 ${hue})`);
      core.addColorStop(0.78, `oklch(58% 0.15 ${hue})`);
      core.addColorStop(1, `oklch(48% 0.14 ${hue})`);
      ctx.fillStyle = core;
      ctx.shadowColor = `oklch(58% 0.15 ${hue} / ${0.35 + e * 0.35})`;
      ctx.shadowBlur = (10 + e * 16) * scale;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;

      const highlight = ctx.createRadialGradient(
        cx - coreR * 0.42,
        cy - coreR * 0.48,
        0,
        cx - coreR * 0.15,
        cy - coreR * 0.2,
        coreR * 0.6,
      );
      highlight.addColorStop(0, "oklch(100% 0 0 / 0.65)");
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
