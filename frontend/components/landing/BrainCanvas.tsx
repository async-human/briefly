"use client";

import { useEffect, useRef } from "react";

interface BNode { x: number; y: number; act: number; decay: number }
interface BPulse { a: number; b: number; t: number; speed: number }

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

    function setup() {
      if (!wrap || !canvas) return;
      W = wrap.offsetWidth;
      H = wrap.offsetHeight;
      canvas.width  = W;
      canvas.height = H;

      // Scatter neurons across the full hero with slight margin
      nodes = [];
      const count = Math.min(180, Math.floor((W * H) / 6000));
      for (let i = 0; i < count; i++) {
        nodes.push({
          x: W * 0.04 + Math.random() * W * 0.92,
          y: H * 0.04 + Math.random() * H * 0.92,
          act: Math.random() * 0.06,
          decay: 0.004 + Math.random() * 0.004,
        });
      }

      // Connect each node to its closest neighbours
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

    // Randomly fire neurons
    const activateTimer = setInterval(() => {
      for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) {
        if (!nodes.length) break;
        nodes[Math.floor(Math.random() * nodes.length)].act = 0.6 + Math.random() * 0.4;
      }
    }, 900);

    // Propagate pulses along edges from active nodes
    const pulseTimer = setInterval(() => {
      if (!nodes.length || !edges.length) return;
      const hot = nodes.map((n, i) => ({ n, i })).filter(x => x.n.act > 0.4);
      if (!hot.length) return;
      const { i: from } = hot[Math.floor(Math.random() * hot.length)];
      const linked = edges
        .filter(([a, b]) => a === from || b === from)
        .map(([a, b]) => (a === from ? b : a));
      if (!linked.length) return;
      pulses.push({
        a: from,
        b: linked[Math.floor(Math.random() * linked.length)],
        t: 0,
        speed: 0.010 + Math.random() * 0.010,
      });
    }, 300);

    function draw() {
      ctx.clearRect(0, 0, W, H);

      // Connections between neurons
      for (const [a, b] of edges) {
        const na = nodes[a], nb = nodes[b];
        const heat = (na.act + nb.act) * 0.5;
        // base opacity very low; rises slightly when nodes are active
        const alpha = 0.05 + heat * 0.10;
        ctx.strokeStyle = `rgba(158,123,63,${alpha})`;
        ctx.lineWidth   = 0.6 + heat * 0.5;
        ctx.beginPath();
        ctx.moveTo(na.x, na.y);
        ctx.lineTo(nb.x, nb.y);
        ctx.stroke();
      }

      // Signal pulses travelling along edges
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        p.t += p.speed;
        if (p.t >= 1) { pulses.splice(i, 1); continue; }
        const na = nodes[p.a], nb = nodes[p.b];
        const px = na.x + (nb.x - na.x) * p.t;
        const py = na.y + (nb.y - na.y) * p.t;
        const fade = Math.max(0, 1 - Math.abs(p.t - 0.5) * 2.5);
        const g = ctx.createRadialGradient(px, py, 0, px, py, 6);
        g.addColorStop(0, `rgba(200,155,60,${0.45 * fade})`);
        g.addColorStop(1, "rgba(200,155,60,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, Math.PI * 2);
        ctx.fill();
      }

      // Neuron bodies
      for (const n of nodes) {
        n.act = Math.max(0, n.act - n.decay);
        const alpha = 0.10 + n.act * 0.45;
        const r     = 1.2 + n.act * 2.6;
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
