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
  const overnight = countPhrase(
    changeCount,
    "1 change today",
    `${changeCount} changes today`,
  );

  return (
    <header className="pulse">
      <p className="pulse-date">{dateLabel}</p>
      <h2 className="pulse-hello">{greeting}.</h2>
      <p className="pulse-line">{line}</p>

      <ul className="pulse-pills" aria-label="Today at a glance">
        <li className={changeCount > 0 ? "is-on" : undefined}>
          {changeCount} important
        </li>
        <li>
          {decisionCount === 1 ? "1 decision affected" : `${decisionCount} decisions affected`}
        </li>
        <li className={urgentCount > 0 ? "is-urgent" : undefined}>
          {urgentCount > 0
            ? countPhrase(urgentCount, "1 urgent", `${urgentCount} urgent`)
            : "Nothing urgent"}
        </li>
      </ul>

      <article className="pulse-world">
        <header className="pulse-world-head">
          <h3 className="pulse-world-title">Your world</h3>
          <p className="pulse-world-meta">{changeCount > 0 ? overnight : "Quiet so far"}</p>
        </header>
        <PulseConstellation
          nodes={nodes}
          connectionLabel={connectionLabel}
          generating={Boolean(generating)}
        />
        <p className="pulse-world-note">
          Only changed or decision-relevant areas are emphasized.
        </p>
      </article>
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

  const cx = 180;
  const cy = 108;
  const radius = 78;
  const positions = nodes.map((node, i) => {
    const angle = (-Math.PI / 2) + (i * (2 * Math.PI)) / Math.max(nodes.length, 1);
    return {
      ...node,
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * 58,
    };
  });
  const active = positions.find((n) => n.active);
  const litCount = positions.filter((n) => n.active).length;

  return (
    <svg
      className={`pulse-map${ready ? " is-ready" : ""}${generating ? " is-thinking" : ""}`}
      viewBox="0 0 360 220"
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
      <circle className="pulse-core" cx={cx} cy={cy} r="28" />
      <text className="pulse-core-label" x={cx} y={cy + 4} textAnchor="middle">
        Briefly
      </text>
      {positions.map((n) => (
        <g key={n.id} className={n.active ? "pulse-node is-on" : "pulse-node"}>
          <circle cx={n.x} cy={n.y} r={n.active ? 16 : 9} />
          <text x={n.x} y={n.y + (n.y < cy ? -22 : 28)} textAnchor="middle">
            {shortLabel(n.name, 14)}
          </text>
        </g>
      ))}
      {active && connectionLabel ? (
        <text
          className="pulse-link-label"
          x={(active.x + cx) / 2}
          y={(active.y + cy) / 2 - 10}
          textAnchor="middle"
        >
          {connectionLabel}
        </text>
      ) : null}
    </svg>
  );
}
