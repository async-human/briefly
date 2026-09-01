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

const MAP_W = 1000;
const MAP_H = 300;
const CORE = { x: 500, y: 152 };
const ORBIT = { rx: 372, ry: 96 };

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

function spokePath(x: number, y: number, bend: number): string {
  const mx = (CORE.x + x) / 2;
  const my = (CORE.y + y) / 2;
  const dx = x - CORE.x;
  const dy = y - CORE.y;
  const len = Math.hypot(dx, dy) || 1;
  const cpx = mx - (dy / len) * bend;
  const cpy = my + (dx / len) * bend;
  return `M ${CORE.x} ${CORE.y} Q ${cpx.toFixed(1)} ${cpy.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
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

  const count = Math.max(nodes.length, 1);
  const positions = nodes.map((node, i) => {
    const angle = -Math.PI / 2 + (i * (2 * Math.PI)) / count;
    const x = CORE.x + Math.cos(angle) * ORBIT.rx;
    const y = CORE.y + Math.sin(angle) * ORBIT.ry;
    const dx = x - CORE.x;
    const dy = y - CORE.y;
    const len = Math.hypot(dx, dy) || 1;
    const side = Math.abs(dx) > Math.abs(dy);
    const labelPad = side ? 36 : 26;
    const anchor: "start" | "middle" | "end" = dx < -12 ? "end" : dx > 12 ? "start" : "middle";
    return {
      ...node,
      x,
      y,
      lx: x + (dx / len) * labelPad,
      ly: y + (dy / len) * labelPad + (dy >= 0 ? 5 : -2),
      anchor,
      bend: (i % 2 === 0 ? 10 : -8),
    };
  });
  const active = positions.find((n) => n.active);
  const litCount = positions.filter((n) => n.active).length;

  return (
    <svg
      className={`pulse-map${ready ? " is-ready" : ""}${generating ? " is-thinking" : ""}`}
      viewBox={`0 0 ${MAP_W} ${MAP_H}`}
      role="img"
      aria-label={
        litCount > 0
          ? `Your world, with ${litCount} tracked ${litCount === 1 ? "name" : "names"} lit`
          : "Your tracked world"
      }
    >
      <title>Your world</title>
      <ellipse
        className="pulse-orbit"
        cx={CORE.x}
        cy={CORE.y}
        rx={ORBIT.rx}
        ry={ORBIT.ry}
      />
      {positions.map((n) => (
        <path
          key={`spoke-${n.id}`}
          className={`pulse-spoke${n.active ? " is-on" : ""}`}
          d={spokePath(n.x, n.y, n.bend)}
        />
      ))}
      {active && connectionLabel ? (
        <path className="pulse-link-path" d={spokePath(active.x, active.y, active.bend)} />
      ) : null}

      <circle className="pulse-core-ring" cx={CORE.x} cy={CORE.y} r="34" />
      <text className="pulse-core-label" x={CORE.x} y={CORE.y + 6} textAnchor="middle">
        Briefly
      </text>

      {positions.map((n) => (
        <g key={n.id} className={n.active ? "pulse-node is-on" : "pulse-node"}>
          {n.active ? <circle className="pulse-node-ring" cx={n.x} cy={n.y} r="9" /> : null}
          <circle className="pulse-node-dot" cx={n.x} cy={n.y} r={n.active ? 2.8 : 2.2} />
          <text x={n.lx} y={n.ly} textAnchor={n.anchor}>
            {shortLabel(n.name, 18)}
          </text>
        </g>
      ))}
    </svg>
  );
}
