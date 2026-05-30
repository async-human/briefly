"use client";

import { useEffect, useRef } from "react";

interface BNode { x: number; y: number; act: number; decay: number }
interface BPulse { a: number; b: number; t: number; speed: number }

const CURSOR_RADIUS = 170;   // px — proximity zone around cursor
const LERP          = 0.075; // how fast the smooth cursor chases the real one

export function BrainCanvas() {
  const wrapRef   = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap   = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    if (!ctx) return;

    let W = 0, H = 0;
    let nodes: BNode[] = [];
    let edges: [number, number][] = [];
    const pulses: BPulse[] = [];
    let raf: number;

    // Raw mouse coords in canvas space; start far off-screen so nothing fires before first move
    let mouseX = -9999, mouseY = -9999;
    // Smoothed coords (lerped toward mouse each frame)
    let smoothX = -9999, smoothY = -9999;

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      // Scale from CSS pixels to canvas pixels
      mouseX = (e.clientX - rect.left) * (W / rect.width);
      mouseY = (e.clientY - rect.top)  * (H / rect.height);
    };
    const onMouseLeave = () => { mouseX = -9999; mouseY = -9999; };

    // Listen on window so events aren't eaten by the pointer-events:none wrapper
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseleave", onMouseLeave);

    function setup() {
      if (!wrap || !canvas) return;
      W = wrap.offsetWidth;
      H = wrap.offsetHeight;
      canvas.width  = W;
      canvas.height = H;

      nodes = [];
      const count = Math.min(220, Math.floor((W * H) / 4500));
      for (let i = 0; i < count; i++) {
        nodes.push({
          x: W * 0.04 + Math.random() * W * 0.92,
          y: H * 0.04 + Math.random() * H * 0.92,
          act: Math.random() * 0.06,
          decay: 0.004 + Math.random() * 0.004,
        });
      }

      edges = [];
      const maxDist = Math.min(W, H) * 0.18;
      for (let i = 0; i < nodes.length; i++) {
        const nbs: { j: number; d: number }[] = [];
        for (let j = 0; j < nodes.length; j++) {
          if (j === i) continue;
          const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < maxDist) nbs.push({ j, d });
        }
        nbs.sort((a, b) => a.d - b.d);
        for (const nb of nbs.slice(0, 3)) if (nb.j > i) edges.push([i, nb.j]);
      }
    }

    const activateTimer = setInterval(() => {
      for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) {
        if (!nodes.length) break;
        nodes[Math.floor(Math.random() * nodes.length)].act = 0.6 + Math.random() * 0.4;
      }
    }, 900);

    const pulseTimer = setInterval(() => {
      if (!nodes.length || !edges.length) return;
      const hot = nodes.map((n, i) => ({ n, i })).filter(x => x.n.act > 0.4);
      if (!hot.length) return;
      const { i: from } = hot[Math.floor(Math.random() * hot.length)];
      const linked = edges
        .filter(([a, b]) => a === from || b === from)
        .map(([a, b]) => (a === from ? b : a));
      if (!linked.length) return;
      pulses.push({ a: from, b: linked[Math.floor(Math.random() * linked.length)], t: 0, speed: 0.010 + Math.random() * 0.010 });
    }, 300);

    function draw() {
      ctx.clearRect(0, 0, W, H);

      // ── Smooth cursor ─────────────────────────────────────────────────────────
      // If mouse is off-screen keep smoothed coords drifting away so activation
      // fades naturally rather than snapping.
      smoothX += (mouseX - smoothX) * LERP;
      smoothY += (mouseY - smoothY) * LERP;
      const cursorOnCanvas = smoothX > 0 && smoothX < W && smoothY > 0 && smoothY < H;

      // ── Cursor halo (drawn first so it sits behind everything) ────────────────
      if (cursorOnCanvas) {
        const g = ctx.createRadialGradient(smoothX, smoothY, 0, smoothX, smoothY, CURSOR_RADIUS);
        g.addColorStop(0, "rgba(200,155,60,0.07)");
        g.addColorStop(0.5, "rgba(200,155,60,0.025)");
        g.addColorStop(1, "rgba(200,155,60,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(smoothX, smoothY, CURSOR_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── Proximity boost: wake up neurons near the cursor ──────────────────────
      if (cursorOnCanvas) {
        for (const n of nodes) {
          const dx = n.x - smoothX, dy = n.y - smoothY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < CURSOR_RADIUS) {
            // Smooth cosine-shaped falloff: full boost at centre, zero at edge
            const t = 1 - dist / CURSOR_RADIUS;
            const boost = Math.pow(t, 1.8) * 0.045; // gentle per-frame increment
            n.act = Math.min(1.0, n.act + boost);
          }
        }
      }

      // ── Edges ─────────────────────────────────────────────────────────────────
      for (const [a, b] of edges) {
        const na = nodes[a], nb = nodes[b];
        const heat = (na.act + nb.act) * 0.5;
        ctx.strokeStyle = `rgba(158,123,63,${0.14 + heat * 0.22})`;
        ctx.lineWidth   = 0.7 + heat * 0.8;
        ctx.beginPath();
        ctx.moveTo(na.x, na.y);
        ctx.lineTo(nb.x, nb.y);
        ctx.stroke();
      }

      // ── Pulses ────────────────────────────────────────────────────────────────
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        p.t += p.speed;
        if (p.t >= 1) { pulses.splice(i, 1); continue; }
        const na = nodes[p.a], nb = nodes[p.b];
        const px = na.x + (nb.x - na.x) * p.t;
        const py = na.y + (nb.y - na.y) * p.t;
        const fade = Math.max(0, 1 - Math.abs(p.t - 0.5) * 2.5);
        const g = ctx.createRadialGradient(px, py, 0, px, py, 6);
        g.addColorStop(0, `rgba(200,155,60,${0.75 * fade})`);
        g.addColorStop(1, "rgba(200,155,60,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── Neuron bodies (decay applied here so boost above is always first) ─────
      for (const n of nodes) {
        n.act = Math.max(0, n.act - n.decay);
        const alpha = 0.22 + n.act * 0.60;
        const r     = 1.5 + n.act * 3.2;
        ctx.fillStyle = `rgba(158,123,63,${alpha})`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    }

    setup();
    draw();

    const ro = new ResizeObserver(setup);
    ro.observe(wrap);

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(activateTimer);
      clearInterval(pulseTimer);
      ro.disconnect();
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseleave", onMouseLeave);
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}
      aria-hidden
    >
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
    </div>
  );
}
