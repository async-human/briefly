"use client";

import { motion, useInView, useReducedMotion } from "framer-motion";
import { useRef } from "react";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

type QuadrantCategory = "reader" | "digester" | "agent" | "briefly";

type QuadrantPoint = {
  id: string;
  name: string;
  sub: string;
  x: number;
  y: number;
  category: QuadrantCategory;
};

const POINTS: QuadrantPoint[] = [
  { id: "readwise", name: "Readwise Reader", sub: "$9.99/mo · PKM library", x: 24, y: 74, category: "reader" },
  { id: "meco", name: "Meco", sub: "$3.99/mo · reader", x: 20, y: 30, category: "reader" },
  { id: "readless", name: "Readless", sub: "$4.90/mo · digest", x: 76, y: 34, category: "digester" },
  { id: "particle", name: "Particle", sub: "$2.99/mo · world news", x: 84, y: 18, category: "digester" },
  { id: "vellum", name: "Vellum", sub: "DIY agent · 60+ skills", x: 60, y: 58, category: "agent" },
  { id: "pulse", name: "ChatGPT Pulse", sub: "bundled · open web", x: 70, y: 66, category: "agent" },
  { id: "briefly", name: "Briefly", sub: "your sources + fingerprint", x: 90, y: 88, category: "briefly" },
];

const LEGEND: { category: QuadrantCategory; label: string }[] = [
  { category: "reader", label: "Readers / libraries" },
  { category: "digester", label: "Digesters" },
  { category: "agent", label: "General agents" },
  { category: "briefly", label: "Briefly" },
];

const CHART_SUMMARY =
  "Positioning map of reading tools. Vertical axis runs from topic-level personalization at the bottom to compounding personal memory at the top. Horizontal axis runs from you read content yourself on the left to the product reads for you on the right. Briefly sits in the top-right as the only option that both knows you over time and reads your sources for you.";

function QuadrantDot({
  point,
  index,
  animate,
}: {
  point: QuadrantPoint;
  index: number;
  animate: boolean;
}) {
  const isBriefly = point.category === "briefly";
  const labelAbove = point.y > 52;

  return (
    <motion.div
      className={`compare-quadrant-point compare-quadrant-point--${point.category}`}
      style={{ left: `${point.x}%`, top: `${100 - point.y}%` }}
      initial={animate ? { opacity: 0, scale: 0.6 } : false}
      animate={animate ? { opacity: 1, scale: 1 } : false}
      transition={{ duration: 0.45, delay: 0.15 + index * 0.06, ease: EASE }}
    >
      <span
        className={`compare-quadrant-dot${isBriefly ? " compare-quadrant-dot--hero" : ""}`}
        aria-hidden
      />
      <div
        className={`compare-quadrant-label${labelAbove ? " compare-quadrant-label--above" : ""}`}
      >
        <span className="compare-quadrant-name">{point.name}</span>
        <span className="compare-quadrant-sub">{point.sub}</span>
      </div>
    </motion.div>
  );
}

export function CompareQuadrant() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const reducedMotion = useReducedMotion();
  const animate = inView && !reducedMotion;

  return (
    <div className="compare-quadrant" ref={ref}>
      <p className="compare-quadrant-eyebrow">Positioning</p>
      <h3 className="compare-quadrant-title">Here&apos;s how the field lays out</h3>

      <div
        className="compare-quadrant-chart"
        role="img"
        aria-label={CHART_SUMMARY}
      >
        <div className="compare-quadrant-plot">
          <svg className="compare-quadrant-grid" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
            <line x1="50" y1="4" x2="50" y2="96" className="compare-quadrant-axis-line" />
            <line x1="4" y1="50" x2="96" y2="50" className="compare-quadrant-axis-line" />
          </svg>

          <span className="compare-quadrant-axis compare-quadrant-axis--top">
            Knows you — compounding memory
          </span>
          <span className="compare-quadrant-axis compare-quadrant-axis--bottom">
            Topic-level personalization
          </span>
          <span className="compare-quadrant-axis compare-quadrant-axis--left">
            You read it yourself
          </span>
          <span className="compare-quadrant-axis compare-quadrant-axis--right">
            It reads for you
          </span>

          {POINTS.map((point, i) => (
            <QuadrantDot key={point.id} point={point} index={i} animate={animate} />
          ))}
        </div>
      </div>

      <ul className="compare-quadrant-legend" aria-hidden>
        {LEGEND.map((item) => (
          <li key={item.category} className={`compare-quadrant-legend-item compare-quadrant-legend-item--${item.category}`}>
            <span className="compare-quadrant-legend-swatch" />
            {item.label}
          </li>
        ))}
      </ul>

      <p className="compare-quadrant-note">
        Placements reflect each product&apos;s core job — not a feature scorecard.
        Open the full comparison below for specifics.
      </p>
    </div>
  );
}
