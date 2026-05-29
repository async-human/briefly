"use client";

import { useEffect, useRef } from "react";

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;        // radius
  opacity: number;
}

interface Pulse {
  a: number;        // from node index
  b: number;        // to node index
  t: number;        // progress 0→1
  speed: number;
}

const NODE_COUNT   = 58;
const EDGE_DIST    = 135;
const NODE_COLOR   = "158, 123, 63";   // warm gold
const PULSE_COLOR  = "201, 153, 58";   // brighter gold

function boxMuller(): [number, number] {
  const u1 = Math.random() || 0.0001;
  const u2 = Math.random();
  const mag = Math.sqrt(-2 * Math.log(u1));
  return [mag * Math.cos(2 * Math.PI * u2), mag * Math.sin(2 * Math.PI * u2)];
}

export function BrainCanvas() {
  const wrapRef  = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap  = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let W = 0, H = 0;
    let nodes: Node[]  = [];
    let pulses: Pulse[] = [];
    let raf: number;
    let pulseTimer: ReturnType<typeof setInterval>;

    function resize() {
      W = wrap.offsetWidth;
      H = wrap.offsetHeight;
      canvas.width  = W;
      canvas.height = H;
      initNodes();
    }

    function initNodes() {
      nodes = [];
      for (let i = 0; i < NODE_COUNT; i++) {
        const [z1, z2] = boxMuller();
        nodes.push({
          x:  clamp(W / 2 + z1 * (W / 4.2), 20, W - 20),
          y:  clamp(H / 2 + z2 * (H / 3.8), 20, H - 20),
          vx: (Math.random() - 0.5) * 0.35,
          vy: (Math.random() - 0.5) * 0.35,
          r:  1.4 + Math.random() * 1.8,
          opacity: 0.35 + Math.random() * 0.55,
        });
      }
    }

    function clamp(v: number, lo: number, hi: number) {
      return Math.max(lo, Math.min(hi, v));
    }

    function spawnPulse() {
      for (let tries = 0; tries < 25; tries++) {
        const a = Math.floor(Math.random() * NODE_COUNT);
        const b = Math.floor(Math.random() * NODE_COUNT);
        if (a === b) continue;
        const dx = nodes[a].x - nodes[b].x;
        const dy = nodes[a].y - nodes[b].y;
        if (Math.sqrt(dx * dx + dy * dy) < EDGE_DIST) {
          pulses.push({ a, b, t: 0, speed: 0.007 + Math.random() * 0.007 });
          return;
        }
      }
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);

      // ── Update nodes ──────────────────────────────────────────────────
      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 8  || n.x > W - 8)  n.vx *= -1;
        if (n.y < 8  || n.y > H - 8)  n.vy *= -1;
      }

      // ── Edges ─────────────────────────────────────────────────────────
      ctx.lineWidth = 0.7;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx   = nodes[i].x - nodes[j].x;
          const dy   = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist >= EDGE_DIST) continue;
          const alpha = (1 - dist / EDGE_DIST) * 0.16;
          ctx.strokeStyle = `rgba(${NODE_COLOR}, ${alpha})`;
          ctx.beginPath();
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.stroke();
        }
      }

      // ── Pulses ────────────────────────────────────────────────────────
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        p.t += p.speed;
        if (p.t >= 1) { pulses.splice(i, 1); continue; }

        const from = nodes[p.a];
        const to   = nodes[p.b];
        const px   = from.x + (to.x - from.x) * p.t;
        const py   = from.y + (to.y - from.y) * p.t;

        // Fade in/out over the pulse lifetime
        const fade = 1 - Math.abs(p.t - 0.5) * 2.2;
        const pulseAlpha = Math.max(0, Math.min(1, fade));

        const g = ctx.createRadialGradient(px, py, 0, px, py, 9);
        g.addColorStop(0, `rgba(${PULSE_COLOR}, ${0.95 * pulseAlpha})`);
        g.addColorStop(0.4, `rgba(${PULSE_COLOR}, ${0.4 * pulseAlpha})`);
        g.addColorStop(1, `rgba(${PULSE_COLOR}, 0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, 9, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── Nodes ─────────────────────────────────────────────────────────
      for (const n of nodes) {
        // Soft glow
        const glow = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r * 4);
        glow.addColorStop(0, `rgba(${PULSE_COLOR}, ${n.opacity * 0.18})`);
        glow.addColorStop(1, `rgba(${PULSE_COLOR}, 0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r * 4, 0, Math.PI * 2);
        ctx.fill();

        // Core dot
        ctx.fillStyle = `rgba(${NODE_COLOR}, ${n.opacity})`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    }

    // Boot
    resize();
    draw();
    pulseTimer = setInterval(spawnPulse, 750);

    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(pulseTimer);
      ro.disconnect();
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        overflow: "hidden",
      }}
      aria-hidden
    >
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height: "100%" }}
      />
    </div>
  );
}
