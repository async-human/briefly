"use client";

import { useEffect, useState } from "react";
import { countPhrase, shortLabel, type PulseNode } from "@/lib/intelligenceHome";

type MorningPulseProps = {
  greeting: string;
  dateLabel: string;
  line: string;
  changeCount: number;
  decisionCount: number;
  urgentCount: number;
  nodes: PulseNode[];
  connectionLabel: string | null;
  generating?: boolean;
};

export function MorningPulse({
  greeting,
  dateLabel,
  line,
  changeCount,
  decisionCount,
  urgentCount,
  nodes,
  connectionLabel,
  generating,
}: MorningPulseProps) {
  const lit = nodes.filter((n) => n.active);

  return (
    <header className="pulse">
      <p className="pulse-date">{dateLabel}</p>
      <h2 className="pulse-hello">{greeting}.</h2>
      <p className="pulse-line">{line}</p>

      <ul className="pulse-counts" aria-label="Today at a glance">
        <li>
          <span className="pulse-count-value">{changeCount}</span>
          <span className="pulse-count-label">
            {countPhrase(changeCount, "important change", "important changes")}
          </span>
        </li>
        <li>
          <span className="pulse-count-value">{decisionCount}</span>
          <span className="pulse-count-label">
            {countPhrase(decisionCount, "decision affected", "decisions affected")}
          </span>
        </li>
        <li>
          <span className="pulse-count-value">{urgentCount}</span>
          <span className="pulse-count-label">
            {countPhrase(urgentCount, "urgent action", "urgent actions")}
          </span>
        </li>
      </ul>

      <PulseConstellation
        nodes={nodes}
        connectionLabel={connectionLabel}
        generating={Boolean(generating)}
      />

      {lit.length > 0 ? (
        <p className="pulse-lit">
          Lit today: {lit.map((n) => n.name).join(", ")}
        </p>
      ) : null}
    </header>
  );
}

function PulseConstellation({
  nodes,
  connectionLabel,
  generating,
}: {
  nodes: PulseNode[];
  connectionLabel: string | null;
  generating: boolean;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), 40);
    return () => window.clearTimeout(t);
  }, []);

  const cx = 160;
  const cy = 92;
  const radius = 64;
  const positions = nodes.map((node, i) => {
    const angle = (-Math.PI / 2) + (i * (2 * Math.PI)) / Math.max(nodes.length, 1);
    return {
      ...node,
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * 50,
    };
  });
  const active = positions.find((n) => n.active);
  const litCount = positions.filter((n) => n.active).length;

  return (
    <svg
      className={`pulse-map${ready ? " is-ready" : ""}${generating ? " is-thinking" : ""}`}
      viewBox="0 0 320 188"
      role="img"
      aria-label={
        litCount > 0
          ? `Your world, with ${litCount} tracked ${litCount === 1 ? "name" : "names"} lit`
          : "Your tracked world"
      }
    >
      <title>Your world</title>
      {positions.map((n) => (
        <line
          key={`spoke-${n.id}`}
          className={`pulse-spoke${n.active ? " is-on" : ""}`}
          x1={cx}
          y1={cy}
          x2={n.x}
          y2={n.y}
        />
      ))}
      {active && connectionLabel ? (
        <g className="pulse-link">
          <line x1={active.x} y1={active.y} x2={cx} y2={cy} />
        </g>
      ) : null}
      <circle className="pulse-core" cx={cx} cy={cy} r="22" />
      <text className="pulse-core-label" x={cx} y={cy - 3} textAnchor="middle">
        <tspan x={cx} dy="0">Your</tspan>
        <tspan x={cx} dy="11">world</tspan>
      </text>
      {positions.map((n) => (
        <g key={n.id} className={n.active ? "pulse-node is-on" : "pulse-node"}>
          <circle cx={n.x} cy={n.y} r={n.active ? 7 : 4} />
          <text x={n.x} y={n.y + (n.y < cy ? -14 : 20)} textAnchor="middle">
            {shortLabel(n.name, 16)}
          </text>
        </g>
      ))}
      {active && connectionLabel ? (
        <text
          className="pulse-link-label"
          x={(active.x + cx) / 2}
          y={(active.y + cy) / 2 - 8}
          textAnchor="middle"
        >
          {connectionLabel}
        </text>
      ) : null}
    </svg>
  );
}
