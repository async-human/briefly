"use client";

import { useEffect, useRef } from "react";

/*
 * Subtle ambient brain illustration for the hero background.
 * — Correct lateral-view brain silhouette (horizontal, wider than tall)
 * — Warm amber nodes + edges at very low opacity to blend with cream bg
 * — No container card — pure canvas overlay behind the hero copy
 */

interface Node {
  x: number;
  y: number;
  activation: number;
  decay: number;
}

interface Pulse {
  a: number;
  b: number;
  t: number;
  speed: number;
}

// ── Brain outline: right lateral view control points ──────────────────────────
// Normalized to [-1, 1] space; scaled at render time.
// Shape: horizontal ellipse, prominent temporal lobe dip, gyri bumps on surface.
const RAW_OUTLINE = [
  // Frontal pole (right / front)
  [0.85,  0.10],
  [0.92, -0.02],
  [0.88, -0.22],
  // Temporal lobe — extends noticeably downward
  [0.70, -0.42],
  [0.45, -0.60],
  [0.15, -0.60],
  [-0.10, -0.52],
  // Occipital pole (left / back)
  [-0.45, -0.30],
  [-0.62, -0.06],
  [-0.58,  0.22],
  // Parietal / top
  [-0.38,  0.50],
  [-0.08,  0.62],
  // Frontal top
  [ 0.28,  0.58],
  [ 0.58,  0.42],
  [ 0.78,  0.28],
];

// Catmull-Rom spline — smooth the outline
function catmullRom(
  p0: number[], p1: number[], p2: number[], p3: number[], t: number,
): [number, number] {
  const t2 = t * t, t3 = t2 * t;
  return [
    0.5 * (2*p1[0] + (-p0[0]+p2[0])*t + (2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*t2 + (-p0[0]+3*p1[0]-3*p2[0]+p3[0])*t3),
    0.5 * (2*p1[1] + (-p0[1]+p2[1])*t + (2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*t2 + (-p0[1]+3*p1[1]-3*p2[1]+p3[1])*t3),
  ];
}

function buildSmoothOutline(pts: number[][], steps = 8): [number, number][] {
  const n = pts.length;
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    for (let s = 0; s < steps; s++) {
      out.push(catmullRom(p0, p1, p2, p3, s / steps));
    }
  }
  return out;
}

// Ray-casting point-in-polygon
function inside(px: number, py: number, poly: [number, number][]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

export function BrainCanvas() {
  const wrapRef  = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap   = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
    if (!ctx) return;

    let W = 0, H = 0;
    let nodes: Node[]  = [];
    let edges: [number, number][] = [];
    const pulses: Pulse[] = [];
    let outline: [number, number][] = [];
    let raf: number;

    function setup() {
      if (!wrap || !canvas) return;
      W = wrap.offsetWidth;
      H = wrap.offsetHeight;
      canvas.width  = W;
      canvas.height = H;

      // Brain center and scale — horizontally centred, slightly above mid
      const cx    = W * 0.5;
      const cy    = H * 0.48;
      const scale = Math.min(W * 0.34, H * 0.46);

      // Build smooth outline in canvas coords
      outline = buildSmoothOutline(RAW_OUTLINE).map(([nx, ny]) => [
        cx + nx * scale,
        cy - ny * scale,   // flip Y (canvas Y goes down)
      ] as [number, number]);

      // Scatter nodes inside the outline
      nodes = [];
      const STEP = Math.max(18, Math.min(W, H) / 24);
      const cols = Math.ceil(W / STEP) + 2;
      const rows = Math.ceil(H / STEP) + 2;

      for (let r = 0; r < rows && nodes.length < 220; r++) {
        for (let c = 0; c < cols && nodes.length < 220; c++) {
          const px = c * STEP + (Math.random() - 0.5) * STEP * 0.55;
          const py = r * STEP + (Math.random() - 0.5) * STEP * 0.55;
          if (!inside(px, py, outline)) continue;
          nodes.push({ x: px, y: py, activation: Math.random() * 0.1, decay: 0.006 + Math.random() * 0.005 });
        }
      }

      // Nearest-neighbour edges (keep 3-4 closest per node)
      edges = [];
      const EDGE_D = STEP * 2.4;
      for (let i = 0; i < nodes.length; i++) {
        const nbrs: { j: number; d: number }[] = [];
        for (let j = 0; j < nodes.length; j++) {
          if (j === i) continue;
          const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
          const d  = Math.sqrt(dx * dx + dy * dy);
          if (d < EDGE_D) nbrs.push({ j, d });
        }
        nbrs.sort((a, b) => a.d - b.d);
        for (const nb of nbrs.slice(0, 4)) {
          if (nb.j > i) edges.push([i, nb.j]);
        }
      }
    }

    // Periodic activation
    const activateTimer = setInterval(() => {
      const count = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i++) {
        if (nodes.length === 0) break;
        nodes[Math.floor(Math.random() * nodes.length)].activation = 0.75 + Math.random() * 0.25;
      }
    }, 700);

    // Periodic pulses
    const pulseTimer = setInterval(() => {
      if (nodes.length === 0 || edges.length === 0) return;
      const hot = nodes.map((n, i) => ({ n, i })).filter(x => x.n.activation > 0.45);
      if (!hot.length) return;
      const { i: from } = hot[Math.floor(Math.random() * hot.length)];
      const linked = edges.filter(([a, b]) => a === from || b === from).map(([a, b]) => (a === from ? b : a));
      if (!linked.length) return;
      pulses.push({ a: from, b: linked[Math.floor(Math.random() * linked.length)], t: 0, speed: 0.014 + Math.random() * 0.01 });
    }, 220);

    function draw() {
      ctx.clearRect(0, 0, W, H);

      // ── Brain outline — very faint warm stroke ──────────────────────────
      if (outline.length > 1) {
        ctx.beginPath();
        ctx.moveTo(outline[0][0], outline[0][1]);
        for (const [ox, oy] of outline) ctx.lineTo(ox, oy);
        ctx.closePath();
        ctx.strokeStyle = "rgba(158, 123, 63, 0.10)";
        ctx.lineWidth   = 1.5;
        ctx.stroke();
      }

      // ── Edges ────────────────────────────────────────────────────────────
      for (const [a, b] of edges) {
        const na = nodes[a], nb = nodes[b];
        const heat   = (na.activation + nb.activation) * 0.5;
        const alpha  = 0.04 + heat * 0.10;
        ctx.strokeStyle = `rgba(158, 123, 63, ${alpha})`;
        ctx.lineWidth   = 0.5 + heat * 0.6;
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
        const na = nodes[p.a], nb = nodes[p.b];
        const px = na.x + (nb.x - na.x) * p.t;
        const py = na.y + (nb.y - na.y) * p.t;
        const fade = Math.max(0, 1 - Math.abs(p.t - 0.5) * 2.5);
        const g = ctx.createRadialGradient(px, py, 0, px, py, 6);
        g.addColorStop(0, `rgba(200, 155, 60, ${0.55 * fade})`);
        g.addColorStop(1, "rgba(200, 155, 60, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── Nodes ─────────────────────────────────────────────────────────────
      for (const n of nodes) {
        n.activation = Math.max(0, n.activation - n.decay);
        const heat = n.activation;
        const a    = 0.18 + heat * 0.45;
        const r    = 1.5 + heat * 2.5;
        ctx.fillStyle = `rgba(158, 123, 63, ${a})`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    }

    setup();
    draw();

    const ro = new ResizeObserver(() => { setup(); });
    ro.observe(wrap);

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(activateTimer);
      clearInterval(pulseTimer);
      ro.disconnect();
    };
  }, []);

  return (
    <div ref={wrapRef} style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }} aria-hidden>
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
    </div>
  );
}
