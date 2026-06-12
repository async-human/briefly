"use client";

import { motion, useInView, useReducedMotion } from "framer-motion";
import { useRef } from "react";
import "@/styles/compare-quadrant.css";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

type QuadrantCategory = "reader" | "digester" | "agent" | "briefly";
type LabelSide = "left" | "right" | "top" | "bottom";

type QuadrantPoint = {
  id: string;
  name: string;
  x: number;
  y: number;
  category: QuadrantCategory;
  label: LabelSide;
};

const POINTS: QuadrantPoint[] = [
  { id: "meco", name: "Meco", x: 20, y: 26, category: "reader", label: "right" },
  { id: "readwise", name: "Readwise Reader", x: 22, y: 74, category: "reader", label: "right" },
  { id: "readless", name: "Readless", x: 72, y: 30, category: "digester", label: "left" },
  { id: "particle", name: "Particle", x: 86, y: 16, category: "digester", label: "left" },
  { id: "vellum", name: "Vellum", x: 52, y: 56, category: "agent", label: "right" },
  { id: "pulse", name: "ChatGPT Pulse", x: 62, y: 70, category: "agent", label: "left" },
  { id: "briefly", name: "Briefly", x: 83, y: 86, category: "briefly", label: "left" },
];

const LEGEND: { category: QuadrantCategory; label: string }[] = [
  { category: "reader", label: "Readers & libraries" },
  { category: "digester", label: "Digesters" },
  { category: "agent", label: "General agents" },
  { category: "briefly", label: "Briefly" },
];

const CHART_SUMMARY =
  "Positioning map of reading tools. Vertical axis runs from topic-level personalization at the bottom to compounding personal memory at the top. Horizontal axis runs from you read content yourself on the left to the product reads for you on the right. Briefly sits in the top-right as the only option that both knows you over time and reads your sources for you.";

function QuadrantPointMark({
  point,
  index,
  animate,
}: {
  point: QuadrantPoint;
  index: number;
  animate: boolean;
}) {
  const isBriefly = point.category === "briefly";

  return (
    <motion.div
      className={`cq-point cq-point--${point.category} cq-point--label-${point.label}`}
      style={{ left: `${point.x}%`, top: `${100 - point.y}%` }}
      initial={animate ? { opacity: 0, scale: 0.4 } : false}
      animate={animate ? { opacity: 1, scale: 1 } : false}
      transition={{
        type: "spring",
        stiffness: 280,
        damping: 20,
        delay: 0.35 + index * 0.09,
      }}
    >
      <span className="cq-point-dot" aria-hidden>
        {isBriefly && <span className="cq-point-halo" aria-hidden />}
      </span>
      <span className="cq-point-label">
        <span className="cq-point-name">{point.name}</span>
        {isBriefly && <span className="cq-point-sub">your sources + memory</span>}
      </span>
    </motion.div>
  );
}

function QuadrantSvg({ animate }: { animate: boolean }) {
  return (
    <svg className="cq-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      {/* Soft tint on the winning quadrant */}
      <motion.rect
        className="cq-quadrant-tint"
        x="50"
        y="0"
        width="50"
        height="50"
        initial={animate ? { opacity: 0 } : false}
        animate={animate ? { opacity: 1 } : false}
        transition={{ duration: 1, delay: 0.5, ease: EASE }}
      />

      {[25, 75].map((n) => (
        <g key={n}>
          <line x1={n} y1="4" x2={n} y2="96" className="cq-gridline" />
          <line x1="4" y1={n} x2="96" y2={n} className="cq-gridline" />
        </g>
      ))}

      <line
        x1="50"
        y1="3"
        x2="50"
        y2="97"
        className={`cq-axis${animate ? " cq-axis--draw" : ""}`}
        pathLength={1}
      />
      <line
        x1="3"
        y1="50"
        x2="97"
        y2="50"
        className={`cq-axis${animate ? " cq-axis--draw cq-axis--draw-h" : ""}`}
        pathLength={1}
      />
    </svg>
  );
}

export function CompareQuadrant() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const reducedMotion = useReducedMotion();
  const animate = inView && !reducedMotion;

  return (
    <div className="cq" ref={ref}>
      <div className="cq-plot" role="img" aria-label={CHART_SUMMARY}>
        <QuadrantSvg animate={animate} />

        <span className="cq-edge-label cq-edge-label--top">Compounding memory ↑</span>
        <span className="cq-edge-label cq-edge-label--bottom">Topic-level only ↓</span>
        <span className="cq-edge-label cq-edge-label--left">← You read it yourself</span>
        <span className="cq-edge-label cq-edge-label--right">It reads for you →</span>

        <div className="cq-points">
          {POINTS.map((point, i) => (
            <QuadrantPointMark key={point.id} point={point} index={i} animate={animate} />
          ))}
        </div>
      </div>

      <footer className="cq-legend">
        {LEGEND.map((item) => (
          <span key={item.category} className={`cq-chip cq-chip--${item.category}`}>
            <span className="cq-chip-swatch" aria-hidden />
            {item.label}
          </span>
        ))}
      </footer>
    </div>
  );
}
