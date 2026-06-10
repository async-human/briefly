"use client";

import { useEffect, useRef } from "react";

/** Same palette as KnowledgeGraphView */
const NODE_COLORS = {
  topic: "#8B5CF6",
  source: "#22C55E",
  item: "#3B82F6",
  thought: "#F59E0B",
  thread: "#EC4899",
} as const;

type NodeKind = keyof typeof NODE_COLORS;

type NodeDef = {
  id: string;
  kind: NodeKind;
  tx: number;
  ty: number;
  r: number;
  phase: number;
};

type SimNode = NodeDef & {
  x: number;
  y: number;
  vx: number;
  vy: number;
};

type LinkDef = { a: string; b: string; delay: number };

const SIZE = 280;
const CENTER = SIZE / 2;

/** Asymmetric multi-cluster layout — no single hub */
const NODE_DEFS: NodeDef[] = [
  { id: "t1", kind: "topic", tx: 74, ty: 64, r: 5.5, phase: 0.1 },
  { id: "t2", kind: "topic", tx: 108, ty: 48, r: 4.5, phase: 1.4 },
  { id: "t3", kind: "topic", tx: 46, ty: 118, r: 4, phase: 2.2 },
  { id: "th1", kind: "thread", tx: 142, ty: 86, r: 6, phase: 0.8 },
  { id: "s1", kind: "source", tx: 202, ty: 72, r: 5, phase: 1.9 },
  { id: "s2", kind: "source", tx: 222, ty: 124, r: 4.5, phase: 2.7 },
  { id: "s3", kind: "source", tx: 176, ty: 44, r: 4, phase: 3.5 },
  { id: "i1", kind: "item", tx: 166, ty: 156, r: 4, phase: 0.5 },
  { id: "i2", kind: "item", tx: 122, ty: 176, r: 3.5, phase: 1.1 },
  { id: "i3", kind: "item", tx: 80, ty: 160, r: 4, phase: 1.8 },
  { id: "i4", kind: "item", tx: 198, ty: 168, r: 3.5, phase: 2.4 },
  { id: "o1", kind: "thought", tx: 54, ty: 188, r: 4.5, phase: 3.1 },
];

const LINK_DEFS: LinkDef[] = [
  { a: "t1", b: "th1", delay: 0.05 },
  { a: "t2", b: "th1", delay: 0.1 },
  { a: "t3", b: "t1", delay: 0.14 },
  { a: "th1", b: "s1", delay: 0.18 },
  { a: "th1", b: "i1", delay: 0.22 },
  { a: "s1", b: "s2", delay: 0.26 },
  { a: "s1", b: "s3", delay: 0.3 },
  { a: "s1", b: "i4", delay: 0.34 },
  { a: "s2", b: "i4", delay: 0.38 },
  { a: "i1", b: "i2", delay: 0.42 },
  { a: "i2", b: "o1", delay: 0.46 },
  { a: "i2", b: "i3", delay: 0.5 },
  { a: "i3", b: "t3", delay: 0.54 },
  { a: "i3", b: "o1", delay: 0.58 },
  { a: "i1", b: "i4", delay: 0.62 },
  { a: "t2", b: "i1", delay: 0.66 },
  { a: "s3", b: "th1", delay: 0.7 },
  { a: "o1", b: "t3", delay: 0.74 },
];

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function initNodes(): SimNode[] {
  return NODE_DEFS.map((n) => ({
    ...n,
    x: CENTER + (Math.random() - 0.5) * 12,
    y: CENTER + (Math.random() - 0.5) * 12,
    vx: 0,
    vy: 0,
  }));
}

function nodeMap(nodes: SimNode[]): Map<string, SimNode> {
  return new Map(nodes.map((n) => [n.id, n]));
}

export function GraphLoaderArt() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<SimNode[]>(initNodes());
  const startRef = useRef<number | null>(null);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    canvas.style.width = `${SIZE}px`;
    canvas.style.height = `${SIZE}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let raf = 0;

    const draw = (now: number) => {
      if (startRef.current === null) startRef.current = now;
      const elapsed = now - startRef.current;
      const reduced = reducedMotionRef.current;
      const spawn = reduced ? 1 : Math.min(1, elapsed / 2000);
      const spawnEase = easeOutCubic(spawn);

      const nodes = nodesRef.current;
      const byId = nodeMap(nodes);

      if (!reduced) {
        for (const node of nodes) {
          const breatheX = Math.sin(now * 0.00055 + node.phase) * 2.2;
          const breatheY = Math.cos(now * 0.00048 + node.phase) * 1.8;
          const ax =
            CENTER + (node.tx - CENTER) * spawnEase + breatheX - node.x;
          const ay =
            CENTER + (node.ty - CENTER) * spawnEase + breatheY - node.y;

          node.vx = (node.vx + ax * 0.028) * 0.86;
          node.vy = (node.vy + ay * 0.028) * 0.86;
        }

        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            const a = nodes[i];
            const b = nodes[j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.max(Math.hypot(dx, dy), 0.01);
            const force = 420 / (dist * dist);
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            a.vx -= fx;
            a.vy -= fy;
            b.vx += fx;
            b.vy += fy;
          }
        }

        for (const link of LINK_DEFS) {
          const a = byId.get(link.a);
          const b = byId.get(link.b);
          if (!a || !b) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy) || 0.01;
          const rest = 52;
          const pull = (dist - rest) * 0.0042;
          const fx = (dx / dist) * pull;
          const fy = (dy / dist) * pull;
          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
        }

        for (const node of nodes) {
          node.x += node.vx;
          node.y += node.vy;
        }
      } else {
        for (const node of nodes) {
          node.x = node.tx;
          node.y = node.ty;
        }
      }

      ctx.clearRect(0, 0, SIZE, SIZE);

      for (const link of LINK_DEFS) {
        const a = byId.get(link.a);
        const b = byId.get(link.b);
        if (!a || !b) continue;
        const linkSpawn = reduced
          ? 1
          : Math.max(0, Math.min(1, (spawn - link.delay) / 0.22));
        if (linkSpawn <= 0) continue;

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = `rgba(94, 106, 210, ${0.22 * linkSpawn})`;
        ctx.lineWidth = 0.85 + linkSpawn * 0.35;
        ctx.stroke();
      }

      for (const node of nodes) {
        const nodeSpawn = reduced
          ? 1
          : Math.max(0, Math.min(1, (spawn - node.phase * 0.04) / 0.35));
        if (nodeSpawn <= 0) continue;

        const r = node.r * (0.85 + nodeSpawn * 0.15);
        const color = NODE_COLORS[node.kind];

        ctx.save();
        ctx.globalAlpha = 0.55 + nodeSpawn * 0.45;

        if (node.kind === "thread" || node.kind === "topic") {
          ctx.shadowColor = color;
          ctx.shadowBlur = 6;
        }

        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
        ctx.lineWidth = 1.1;
        ctx.stroke();
        ctx.restore();
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="hm-graph-loader" aria-hidden>
      <span className="hm-graph-loader-ambient" />
      <canvas ref={canvasRef} className="hm-graph-loader-canvas" />
    </div>
  );
}
