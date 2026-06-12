"use client";

import { motion, useInView, useReducedMotion } from "framer-motion";
import { useRef } from "react";
import "@/styles/compare-quadrant.css";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

type QuadrantCategory = "reader" | "digester" | "agent" | "briefly";
type LabelPlacement = "inline" | "above" | "below";

type QuadrantPoint = {
  id: string;
  name: string;
  sub: string;
  x: number;
  y: number;
  category: QuadrantCategory;
  placement: LabelPlacement;
};

const POINTS: QuadrantPoint[] = [
  { id: "readwise", name: "Readwise Reader", sub: "$9.99/mo · PKM library", x: 21, y: 76, category: "reader", placement: "above" },
  { id: "meco", name: "Meco", sub: "$3.99/mo · reader", x: 19, y: 24, category: "reader", placement: "below" },
  { id: "readless", name: "Readless", sub: "$4.90/mo · digest", x: 74, y: 28, category: "digester", placement: "below" },
  { id: "particle", name: "Particle", sub: "$2.99/mo · world news", x: 88, y: 12, category: "digester", placement: "below" },
  { id: "vellum", name: "Vellum", sub: "DIY agent · 60+ skills", x: 54, y: 54, category: "agent", placement: "above" },
  { id: "pulse", name: "ChatGPT Pulse", sub: "bundled · open web", x: 64, y: 68, category: "agent", placement: "above" },
  { id: "briefly", name: "Briefly", sub: "your sources + fingerprint", x: 84, y: 84, category: "briefly", placement: "above" },
];

const LEGEND: { category: QuadrantCategory; label: string }[] = [
  { category: "reader", label: "Readers / libraries" },
  { category: "digester", label: "Digesters" },
  { category: "agent", label: "General agents" },
  { category: "briefly", label: "Briefly" },
];

const CHART_SUMMARY =
  "Positioning map of reading tools. Vertical axis runs from topic-level personalization at the bottom to compounding personal memory at the top. Horizontal axis runs from you read content yourself on the left to the product reads for you on the right. Briefly sits in the top-right as the only option that both knows you over time and reads your sources for you.";

function CompareMarker({
  point,
  index,
  animate,
}: {
  point: QuadrantPoint;
  index: number;
  animate: boolean;
}) {
  const isBriefly = point.category === "briefly";
  const placementClass =
    point.placement === "above"
      ? " compare-marker--above"
      : point.placement === "below"
        ? " compare-marker--below"
        : "";

  return (
    <motion.div
      className={`compare-marker compare-marker--${point.category}${placementClass}`}
      style={{ left: `${point.x}%`, top: `${100 - point.y}%` }}
      initial={animate ? { opacity: 0, y: 6, scale: 0.94 } : false}
      animate={animate ? { opacity: 1, y: 0, scale: 1 } : false}
      transition={{
        duration: 0.48,
        delay: 0.22 + index * 0.07,
        ease: EASE,
      }}
    >
      <span className="compare-marker-pin" aria-hidden />
      <div className="compare-marker-copy">
        <span className="compare-marker-name">{point.name}</span>
        <span className="compare-marker-sub">{point.sub}</span>
      </div>
      {isBriefly ? <span className="sr-only"> — highlighted position</span> : null}
    </motion.div>
  );
}

function QuadrantSvg({ animate }: { animate: boolean }) {
  return (
    <svg className="compare-quadrant-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="cq-axis-v" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="color-mix(in oklch, var(--cq-ink) 16%, transparent)" />
          <stop offset="50%" stopColor="color-mix(in oklch, var(--cq-ink) 10%, transparent)" />
          <stop offset="100%" stopColor="color-mix(in oklch, var(--cq-ink) 16%, transparent)" />
        </linearGradient>
        <linearGradient id="cq-axis-h" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="color-mix(in oklch, var(--cq-ink) 16%, transparent)" />
          <stop offset="50%" stopColor="color-mix(in oklch, var(--cq-ink) 10%, transparent)" />
          <stop offset="100%" stopColor="color-mix(in oklch, var(--cq-ink) 16%, transparent)" />
        </linearGradient>
      </defs>

      <rect className="compare-quadrant-svg-bg" x="0" y="0" width="100" height="100" rx="2" />

      {[20, 40, 60, 80].map((n) => (
        <g key={n}>
          <line x1={n} y1="6" x2={n} y2="94" className="compare-quadrant-axis" strokeOpacity="0.35" />
          <line x1="6" y1={n} x2="94" y2={n} className="compare-quadrant-axis" strokeOpacity="0.35" />
        </g>
      ))}

      <line
        x1="50" y1="5" x2="50" y2="95"
        className={`compare-quadrant-axis${animate ? " compare-quadrant-axis--draw" : ""}`}
        stroke="url(#cq-axis-v)"
        pathLength={1}
      />
      <line
        x1="5" y1="50" x2="95" y2="50"
        className={`compare-quadrant-axis${animate ? " compare-quadrant-axis--draw compare-quadrant-axis--draw-h" : ""}`}
        stroke="url(#cq-axis-h)"
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
    <div className="compare-quadrant" ref={ref}>
      <header className="compare-quadrant-head">
        <p className="compare-quadrant-eyebrow">Positioning</p>
        <h3 className="compare-quadrant-title">Here&apos;s how the field lays out</h3>
        <p className="compare-quadrant-lede">
          Two axes separate readers, digesters, and agents — and show who compounds with you over time.
        </p>
      </header>

      <div className="compare-quadrant-frame">
        <p className="compare-quadrant-y-label">Knows you — compounding memory</p>

        <div className="compare-quadrant-stage">
          <p className="compare-quadrant-x-label">You read it yourself</p>

          <div className="compare-quadrant-chart" role="img" aria-label={CHART_SUMMARY}>
            <div className="compare-quadrant-plot">
              <QuadrantSvg animate={animate} />
              <div className="compare-quadrant-markers">
                {POINTS.map((point, i) => (
                  <CompareMarker key={point.id} point={point} index={i} animate={animate} />
                ))}
              </div>
            </div>
          </div>

          <p className="compare-quadrant-x-label">It reads for you</p>
        </div>

        <p className="compare-quadrant-y-label">Topic-level personalization</p>
      </div>

      <footer className="compare-quadrant-foot">
        {LEGEND.map((item) => (
          <span
            key={item.category}
            className={`compare-quadrant-chip compare-quadrant-chip--${item.category}`}
          >
            <span className="compare-quadrant-chip-swatch" aria-hidden />
            {item.label}
          </span>
        ))}
        <p className="compare-quadrant-note">
          Placements reflect each product&apos;s core job — not a feature scorecard.
          Open the full comparison below for specifics.
        </p>
      </footer>
    </div>
  );
}
