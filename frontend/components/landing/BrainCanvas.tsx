"use client";

import { useEffect, useRef } from "react";

interface BNode { x: number; y: number; act: number; decay: number }
interface BPulse { a: number; b: number; t: number; speed: number }

// Right-lateral view. x: 0=occipital(back), 1=frontal(front). y: 0=top, 1=bottom.
// Traced clockwise from frontal-superior pole.
const BRAIN_OUTLINE: [number, number][] = [
  [0.79, 0.06],  // frontal superior pole
  [0.87, 0.12],  // frontal upper-anterior
  [0.94, 0.22],  // frontal anterior convexity
  [0.97, 0.34],  // frontal maximal width
  [0.95, 0.46],  // frontal lower
  [0.91, 0.55],  // fronto-temporal (above Sylvian fissure)
  [0.87, 0.63],  // temporal pole top
  [0.82, 0.73],  // temporal anterior
  [0.74, 0.83],  // temporal mid
  [0.59, 0.91],  // temporal posterior
  [0.43, 0.94],  // temporal-occipital junction
  [0.27, 0.89],  // occipital inferior
  [0.13, 0.77],  // occipital pole lower
  [0.05, 0.61],  // occipital pole
  [0.04, 0.45],  // occipital posterior
  [0.07, 0.31],  // parieto-occipital
  [0.15, 0.17],  // occipital-parietal superior
  [0.27, 0.07],  // parietal superior
  [0.44, 0.02],  // vertex
  [0.63, 0.03],  // frontal-parietal superior
  [0.79, 0.06],
];

// Major sulci — characteristic grooves of the lateral surface
const SULCI: [number, number][][] = [
  // Central sulcus (Rolandic) — divides frontal from parietal, nearly vertical
  [[0.61, 0.03], [0.61, 0.13], [0.62, 0.26], [0.63, 0.39], [0.62, 0.50], [0.61, 0.56]],
  // Precentral sulcus — just anterior to central
  [[0.71, 0.04], [0.72, 0.14], [0.73, 0.28], [0.73, 0.41], [0.71, 0.52]],
  // Postcentral sulcus — just posterior to central
  [[0.50, 0.03], [0.51, 0.13], [0.51, 0.26], [0.52, 0.38], [0.51, 0.47]],
  // Sylvian / Lateral fissure — the major horizontal groove
  [[0.91, 0.56], [0.76, 0.60], [0.60, 0.62], [0.44, 0.59], [0.28, 0.55], [0.17, 0.51]],
  // Superior frontal sulcus
  [[0.82, 0.08], [0.84, 0.19], [0.85, 0.33], [0.84, 0.45]],
  // Inferior frontal sulcus
  [[0.87, 0.24], [0.87, 0.35], [0.85, 0.47]],
  // Intraparietal sulcus — horizontal, parietal lobe
  [[0.40, 0.06], [0.38, 0.17], [0.36, 0.29], [0.31, 0.40], [0.24, 0.47]],
  // Superior temporal sulcus
  [[0.82, 0.71], [0.67, 0.74], [0.50, 0.75], [0.33, 0.72], [0.20, 0.67]],
  // Middle temporal sulcus
  [[0.77, 0.80], [0.62, 0.84], [0.46, 0.85], [0.30, 0.80]],
  // Parieto-occipital sulcus
  [[0.22, 0.08], [0.16, 0.20], [0.12, 0.34]],
  // Lunate sulcus (occipital)
  [[0.10, 0.43], [0.08, 0.55], [0.11, 0.65]],
  // Calcarine sulcus (lower occipital)
  [[0.08, 0.68], [0.16, 0.73], [0.24, 0.75]],
];

// Catmull-Rom spline
function crPt(
  p0: [number, number], p1: [number, number],
  p2: [number, number], p3: [number, number], t: number,
): [number, number] {
  const t2 = t * t, t3 = t2 * t;
  return [
    0.5 * (2*p1[0] + (-p0[0]+p2[0])*t + (2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*t2 + (-p0[0]+3*p1[0]-3*p2[0]+p3[0])*t3),
    0.5 * (2*p1[1] + (-p0[1]+p2[1])*t + (2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*t2 + (-p0[1]+3*p1[1]-3*p2[1]+p3[1])*t3),
  ];
}

function smoothLoop(pts: [number, number][], steps = 12): [number, number][] {
  const n = pts.length, out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i-1+n)%n], p1 = pts[i], p2 = pts[(i+1)%n], p3 = pts[(i+2)%n];
    for (let s = 0; s < steps; s++) out.push(crPt(p0, p1, p2, p3, s/steps));
  }
  return out;
}

function smoothLine(pts: [number, number][], steps = 10): [number, number][] {
  const n = pts.length, out: [number, number][] = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0,i-1)], p1 = pts[i], p2 = pts[i+1], p3 = pts[Math.min(n-1,i+2)];
    for (let s = 0; s < steps; s++) out.push(crPt(p0, p1, p2, p3, s/steps));
  }
  out.push(pts[n-1]);
  return out;
}

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
    let brainPoly: [number, number][]   = [];
    let sulciPoly: [number, number][][] = [];
    let raf: number;

    function toC(nx: number, ny: number, bx: number, by: number, bw: number, bh: number): [number, number] {
      return [bx + nx * bw, by + ny * bh];
    }

    function inPoly(px: number, py: number, poly: [number, number][]): boolean {
      let hit = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > py) !== (yj > py) && px < (xj-xi)*(py-yi)/(yj-yi)+xi) hit = !hit;
      }
      return hit;
    }

    function setup() {
      if (!wrap || !canvas) return;
      W = wrap.offsetWidth;
      H = wrap.offsetHeight;
      canvas.width  = W;
      canvas.height = H;

      // Brain fills the entire hero — 96% width, 94% height, centered
      const bw = W * 0.96, bh = H * 0.94;
      const bx = (W - bw) / 2, by = (H - bh) / 2;

      brainPoly = smoothLoop(BRAIN_OUTLINE, 14).map(([nx, ny]) => toC(nx, ny, bx, by, bw, bh));
      sulciPoly = SULCI.map(pts => smoothLine(pts as [number,number][], 12).map(([nx, ny]) => toC(nx, ny, bx, by, bw, bh)));

      nodes = [];
      const step = Math.max(16, Math.min(W, H) / 28);
      for (let r = 0; r * step < H + step && nodes.length < 320; r++) {
        for (let c = 0; c * step < W + step && nodes.length < 320; c++) {
          const px = c * step + (Math.random() - 0.5) * step * 0.6;
          const py = r * step + (Math.random() - 0.5) * step * 0.6;
          if (!inPoly(px, py, brainPoly)) continue;
          nodes.push({ x: px, y: py, act: Math.random() * 0.08, decay: 0.005 + Math.random() * 0.004 });
        }
      }

      edges = [];
      const ed = step * 2.6;
      for (let i = 0; i < nodes.length; i++) {
        const nbs: { j: number; d: number }[] = [];
        for (let j = 0; j < nodes.length; j++) {
          if (j === i) continue;
          const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
          const d = Math.sqrt(dx*dx + dy*dy);
          if (d < ed) nbs.push({ j, d });
        }
        nbs.sort((a, b) => a.d - b.d);
        for (const nb of nbs.slice(0, 4)) if (nb.j > i) edges.push([i, nb.j]);
      }
    }

    const activateTimer = setInterval(() => {
      for (let i = 0; i < 3 + Math.floor(Math.random()*3); i++) {
        if (!nodes.length) break;
        nodes[Math.floor(Math.random()*nodes.length)].act = 0.7 + Math.random()*0.3;
      }
    }, 800);

    const pulseTimer = setInterval(() => {
      if (!nodes.length || !edges.length) return;
      const hot = nodes.map((n,i)=>({n,i})).filter(x=>x.n.act>0.4);
      if (!hot.length) return;
      const {i:from} = hot[Math.floor(Math.random()*hot.length)];
      const linked = edges.filter(([a,b])=>a===from||b===from).map(([a,b])=>a===from?b:a);
      if (!linked.length) return;
      pulses.push({ a: from, b: linked[Math.floor(Math.random()*linked.length)], t: 0, speed: 0.012+Math.random()*0.01 });
    }, 250);

    function draw() {
      ctx.clearRect(0, 0, W, H);

      if (brainPoly.length > 2) {
        ctx.beginPath();
        ctx.moveTo(brainPoly[0][0], brainPoly[0][1]);
        for (const [x, y] of brainPoly) ctx.lineTo(x, y);
        ctx.closePath();

        // Subtle warm fill
        ctx.fillStyle = "rgba(201,170,100,0.032)";
        ctx.fill();

        // Brain outline — visible enough to read as a brain
        ctx.strokeStyle = "rgba(158,123,63,0.20)";
        ctx.lineWidth = 2.0;
        ctx.stroke();
      }

      // Sulci
      for (const sulcus of sulciPoly) {
        if (sulcus.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(sulcus[0][0], sulcus[0][1]);
        for (const [x, y] of sulcus) ctx.lineTo(x, y);
        ctx.strokeStyle = "rgba(140,108,52,0.11)";
        ctx.lineWidth = 1.3;
        ctx.stroke();
      }

      // Edges
      for (const [a, b] of edges) {
        const na = nodes[a], nb = nodes[b];
        const heat = (na.act + nb.act) * 0.5;
        ctx.strokeStyle = `rgba(158,123,63,${0.04 + heat * 0.10})`;
        ctx.lineWidth   = 0.5 + heat * 0.6;
        ctx.beginPath();
        ctx.moveTo(na.x, na.y);
        ctx.lineTo(nb.x, nb.y);
        ctx.stroke();
      }

      // Pulses
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        p.t += p.speed;
        if (p.t >= 1) { pulses.splice(i, 1); continue; }
        const na = nodes[p.a], nb = nodes[p.b];
        const px = na.x + (nb.x-na.x)*p.t, py = na.y + (nb.y-na.y)*p.t;
        const fade = Math.max(0, 1 - Math.abs(p.t-0.5)*2.5);
        const g = ctx.createRadialGradient(px, py, 0, px, py, 7);
        g.addColorStop(0, `rgba(200,155,60,${0.55*fade})`);
        g.addColorStop(1, "rgba(200,155,60,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, 7, 0, Math.PI*2);
        ctx.fill();
      }

      // Nodes
      for (const n of nodes) {
        n.act = Math.max(0, n.act - n.decay);
        const a = 0.12 + n.act * 0.50;
        const r = 1.4 + n.act * 3.0;
        ctx.fillStyle = `rgba(158,123,63,${a})`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI*2);
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
