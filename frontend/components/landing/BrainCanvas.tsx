"use client";

import { useEffect, useRef } from "react";

/* ── Types ─────────────────────────────────────────────────────────────────── */
interface BNode {
  x: number;
  y: number;
  activation: number;   // 0 = cool blue, 1 = hot orange
  activationDecay: number;
}

interface BPulse {
  a: number;
  b: number;
  t: number;
  speed: number;
}

/* ── Brain shape: polar radius function ────────────────────────────────────── */
// Returns normalised radius at angle θ — creates a brain-like silhouette
function brainR(theta: number): number {
  // Primary lobes
  const primary = 1
    + 0.14 * Math.cos(3 * theta + 0.4)    // frontal / occipital bulge
    + 0.09 * Math.cos(7 * theta + 0.8)    // major gyri
    + 0.05 * Math.cos(11 * theta - 0.6)   // minor folds
    + 0.03 * Math.cos(5 * theta + 2.2);   // asymmetry

  // Brain is taller at front, compressed at bottom
  const aspect = Math.sqrt(
    Math.pow(Math.cos(theta) * 1.18, 2) +
    Math.pow(Math.sin(theta) * 0.82, 2),
  );

  return primary / aspect;
}

function insideBrain(
  px: number, py: number,
  cx: number, cy: number,
  scale: number,
): boolean {
  const dx = (px - cx) / scale;
  const dy = (py - cy) / scale;
  return Math.sqrt(dx * dx + dy * dy) < brainR(Math.atan2(dy, dx));
}

/* ── Nearest-neighbour edges (creates mesh-like appearance) ────────────────── */
function buildEdges(nodes: BNode[], maxDist: number): [number, number][] {
  const edges: [number, number][] = [];
  for (let i = 0; i < nodes.length; i++) {
    const neighbours: { idx: number; d: number }[] = [];
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const dx = nodes[i].x - nodes[j].x;
      const dy = nodes[i].y - nodes[j].y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < maxDist) neighbours.push({ idx: j, d });
    }
    // Keep closest 4 to mimic triangulation
    neighbours.sort((a, b) => a.d - b.d);
    for (const nb of neighbours.slice(0, 4)) {
      if (nb.idx > i) edges.push([i, nb.idx]);
    }
  }
  return edges;
}

/* ── Main component ────────────────────────────────────────────────────────── */
export function BrainCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    if (!ctx) return;

    let W = canvas.offsetWidth;
    let H = canvas.offsetHeight;
    canvas.width  = W;
    canvas.height = H;

    const cx     = W * 0.5;
    const cy     = H * 0.48;
    const scale  = Math.min(W, H) * 0.43;
    const GRID   = 28;       // grid spacing for node placement
    const EDGE_D = GRID * 2.2;
    const NODE_COUNT_TARGET = 180;

    // ── Generate nodes inside brain shape ──────────────────────────────────
    const nodes: BNode[] = [];
    const cols = Math.ceil(W / GRID) + 2;
    const rows = Math.ceil(H / GRID) + 2;

    for (let row = 0; row < rows && nodes.length < NODE_COUNT_TARGET * 1.3; row++) {
      for (let col = 0; col < cols && nodes.length < NODE_COUNT_TARGET * 1.3; col++) {
        const px = col * GRID + (Math.random() - 0.5) * GRID * 0.6;
        const py = row * GRID + (Math.random() - 0.5) * GRID * 0.6;
        if (!insideBrain(px, py, cx, cy, scale)) continue;
        nodes.push({ x: px, y: py, activation: Math.random() * 0.15, activationDecay: 0.008 + Math.random() * 0.006 });
      }
    }

    const edges = buildEdges(nodes, EDGE_D);
    const pulses: BPulse[] = [];

    // ── Periodic activation ────────────────────────────────────────────────
    const activateInterval = setInterval(() => {
      // Activate 3-5 random nodes
      const count = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i++) {
        const n = nodes[Math.floor(Math.random() * nodes.length)];
        n.activation = 0.85 + Math.random() * 0.15;
      }
    }, 600);

    // ── Periodic pulses ────────────────────────────────────────────────────
    const pulseInterval = setInterval(() => {
      // Find an active node and pulse along a random edge from it
      const activeNodes = nodes
        .map((n, i) => ({ n, i }))
        .filter(({ n }) => n.activation > 0.5);
      if (activeNodes.length === 0) return;

      const { i: fromIdx } = activeNodes[Math.floor(Math.random() * activeNodes.length)];
      const connected = edges
        .filter(([a, b]) => a === fromIdx || b === fromIdx)
        .map(([a, b]) => (a === fromIdx ? b : a));
      if (connected.length === 0) return;

      const toIdx = connected[Math.floor(Math.random() * connected.length)];
      pulses.push({ a: fromIdx, b: toIdx, t: 0, speed: 0.018 + Math.random() * 0.012 });
    }, 180);

    // ── Brain outline path ─────────────────────────────────────────────────
    function drawBrainOutline(glow: number) {
      const steps = 180;
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const theta = (i / steps) * Math.PI * 2;
        const r = brainR(theta) * scale;
        const x = cx + r * Math.cos(theta) / Math.sqrt(
          Math.pow(Math.cos(theta) * 1.18, 2) + Math.pow(Math.sin(theta) * 0.82, 2)
        );
        const y = cy + r * Math.sin(theta) / Math.sqrt(
          Math.pow(Math.cos(theta) * 1.18, 2) + Math.pow(Math.sin(theta) * 0.82, 2)
        );
        if (i === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
      }
      ctx.closePath();

      // Outer glow
      ctx.shadowColor = `rgba(0, 220, 255, ${glow})`;
      ctx.shadowBlur = 20;
      ctx.strokeStyle = `rgba(0, 210, 255, ${0.55 + glow * 0.2})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // ── Render loop ────────────────────────────────────────────────────────
    let raf: number;
    let frame = 0;

    function draw() {
      frame++;
      ctx.clearRect(0, 0, W, H);

      // Dark background
      ctx.fillStyle = "#06091a";
      ctx.fillRect(0, 0, W, H);

      // Subtle background glow inside brain region
      const bgGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, scale * 1.1);
      bgGlow.addColorStop(0,   "rgba(20, 60, 120, 0.35)");
      bgGlow.addColorStop(0.6, "rgba(10, 30, 80, 0.15)");
      bgGlow.addColorStop(1,   "rgba(6, 9, 26, 0)");
      ctx.fillStyle = bgGlow;
      ctx.beginPath();
      ctx.arc(cx, cy, scale * 1.1, 0, Math.PI * 2);
      ctx.fill();

      // ── Edges ────────────────────────────────────────────────────────────
      for (const [a, b] of edges) {
        const na = nodes[a];
        const nb = nodes[b];
        const heat = (na.activation + nb.activation) / 2;
        const r = Math.round(30 + heat * 200);
        const g = Math.round(150 - heat * 90);
        const bv = Math.round(220 - heat * 180);
        const alpha = 0.12 + heat * 0.25;
        ctx.strokeStyle = `rgba(${r},${g},${bv},${alpha})`;
        ctx.lineWidth = 0.6 + heat * 0.8;
        ctx.beginPath();
        ctx.moveTo(na.x, na.y);
        ctx.lineTo(nb.x, nb.y);
        ctx.stroke();
      }

      // ── Pulses ────────────────────────────────────────────────────────────
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        p.t += p.speed;
        if (p.t >= 1) { pulses.splice(i, 1); continue; }

        const na  = nodes[p.a];
        const nb  = nodes[p.b];
        const px  = na.x + (nb.x - na.x) * p.t;
        const py  = na.y + (nb.y - na.y) * p.t;
        const fade = 1 - Math.abs(p.t - 0.5) * 2;

        ctx.shadowColor = "rgba(255, 200, 50, 0.9)";
        ctx.shadowBlur = 12;
        const pg = ctx.createRadialGradient(px, py, 0, px, py, 7);
        pg.addColorStop(0, `rgba(255, 220, 80, ${fade})`);
        pg.addColorStop(1, "rgba(255, 150, 30, 0)");
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.arc(px, py, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // ── Nodes ─────────────────────────────────────────────────────────────
      for (const n of nodes) {
        n.activation = Math.max(0, n.activation - n.activationDecay);

        const heat  = n.activation;
        const r     = Math.round(50 + heat * 220);
        const g     = Math.round(160 - heat * 100);
        const bv    = Math.round(230 - heat * 200);
        const size  = 2.2 + heat * 3.5;

        // Node glow
        if (heat > 0.1) {
          ctx.shadowColor = `rgba(${r},${g},${bv}, ${heat * 0.8})`;
          ctx.shadowBlur  = 8 + heat * 16;
        }

        ctx.fillStyle = `rgba(${r},${g},${bv}, ${0.5 + heat * 0.5})`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // ── Brain silhouette glow ─────────────────────────────────────────────
      const glowPulse = 0.4 + 0.15 * Math.sin(frame * 0.025);
      drawBrainOutline(glowPulse);

      raf = requestAnimationFrame(draw);
    }

    draw();

    const ro = new ResizeObserver(() => {
      if (!canvas) return;
      W = canvas.offsetWidth;
      H = canvas.offsetHeight;
      canvas.width  = W;
      canvas.height = H;
    });
    ro.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(activateInterval);
      clearInterval(pulseInterval);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ display: "block", width: "100%", height: "100%", borderRadius: "inherit" }}
    />
  );
}
