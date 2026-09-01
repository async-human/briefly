"use client";

import { useEffect, useId, useState } from "react";
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

const MAP_W = 640;
const MAP_H = 268;
const CORE = { x: 320, y: 134 };
const ORBIT = { rx: 208, ry: 82 };

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
        <div className="pulse-world-body">
          <PulseConstellation
            nodes={nodes}
            connectionLabel={connectionLabel}
            generating={Boolean(generating)}
          />
          <ul className="pulse-world-legend" aria-label="Tracked names">
            {nodes.length === 0 ? (
              <li className="pulse-world-legend-empty">Nothing tracked yet.</li>
            ) : (
              nodes.map((node) => (
                <li key={node.id} className={node.active ? "is-on" : undefined}>
                  <span className="pulse-world-pip" aria-hidden />
                  <span className="pulse-world-legend-name">{node.name}</span>
                  <span className="pulse-world-legend-state">
                    {node.active ? "Moving" : "Quiet"}
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>
        <p className="pulse-world-note">
          Only changed or decision-relevant areas are emphasized.
        </p>
      </article>
    </header>
  );
}

function spokePath(
  x: number,
  y: number,
  bend: number,
): string {
  const mx = (CORE.x + x) / 2;
  const my = (CORE.y + y) / 2;
  const dx = x - CORE.x;
  const dy = y - CORE.y;
  const len = Math.hypot(dx, dy) || 1;
  const cpx = mx - (dy / len) * bend;
  const cpy = my + (dx / len) * bend;
  return `M ${CORE.x} ${CORE.y} Q ${cpx.toFixed(1)} ${cpy.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
}

function diamondPoints(x: number, y: number, size: number): string {
  return `${x},${y - size} ${x + size},${y} ${x},${y + size} ${x - size},${y}`;
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
  const uid = useId().replace(/:/g, "");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), 40);
    return () => window.clearTimeout(t);
  }, []);

  const count = Math.max(nodes.length, 1);
  const positions = nodes.map((node, i) => {
    const wobble = i % 2 === 0 ? -0.14 : 0.11;
    const angle = -Math.PI / 2 + 0.2 + (i * (2 * Math.PI)) / count + wobble;
    const x = CORE.x + Math.cos(angle) * ORBIT.rx;
    const y = CORE.y + Math.sin(angle) * ORBIT.ry;
    const dx = x - CORE.x;
    const dy = y - CORE.y;
    const len = Math.hypot(dx, dy) || 1;
    const labelPad = 28;
    return {
      ...node,
      x,
      y,
      lx: x + (dx / len) * labelPad,
      ly: y + (dy / len) * labelPad + 3,
      bend: (i % 2 === 0 ? 22 : -18),
    };
  });
  const active = positions.find((n) => n.active);
  const litCount = positions.filter((n) => n.active).length;
  const ticks = [0, 1, 2, 3].map((i) => {
    const angle = Math.PI / 4 + (i * Math.PI) / 2;
    return {
      x: CORE.x + Math.cos(angle) * ORBIT.rx,
      y: CORE.y + Math.sin(angle) * ORBIT.ry,
    };
  });

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
      <defs>
        <radialGradient id={`${uid}-halo`} cx="50%" cy="42%" r="50%">
          <stop offset="0%" className="pulse-halo-in" />
          <stop offset="100%" className="pulse-halo-out" />
        </radialGradient>
        <radialGradient id={`${uid}-core`} cx="38%" cy="32%" r="68%">
          <stop offset="0%" className="pulse-core-in" />
          <stop offset="100%" className="pulse-core-out" />
        </radialGradient>
      </defs>

      <ellipse
        className="pulse-orbit pulse-orbit-outer"
        cx={CORE.x}
        cy={CORE.y}
        rx={ORBIT.rx}
        ry={ORBIT.ry}
      />
      <ellipse
        className="pulse-orbit pulse-orbit-inner"
        cx={CORE.x}
        cy={CORE.y}
        rx={ORBIT.rx * 0.58}
        ry={ORBIT.ry * 0.58}
      />
      {ticks.map((tick, i) => (
        <polygon
          key={`tick-${i}`}
          className="pulse-tick"
          points={diamondPoints(tick.x, tick.y, 3.2)}
        />
      ))}

      {positions.map((n) => (
        <path
          key={`spoke-${n.id}`}
          className={`pulse-spoke${n.active ? " is-on" : ""}`}
          d={spokePath(n.x, n.y, n.bend)}
        />
      ))}
      {active && connectionLabel ? (
        <path
          className="pulse-link-path"
          d={spokePath(active.x, active.y, active.bend)}
        />
      ) : null}

      <circle className="pulse-core-ring" cx={CORE.x} cy={CORE.y} r="42" />
      <circle className="pulse-core" cx={CORE.x} cy={CORE.y} r="29" fill={`url(#${uid}-core)`} />
      <polygon className="pulse-tick pulse-tick-core" points={diamondPoints(CORE.x, CORE.y - 42, 2.6)} />
      <text className="pulse-core-label" x={CORE.x} y={CORE.y + 5} textAnchor="middle">
        Briefly
      </text>

      {positions.map((n) => (
        <g key={n.id} className={n.active ? "pulse-node is-on" : "pulse-node"}>
          {n.active ? (
            <circle className="pulse-node-halo" cx={n.x} cy={n.y} r="22" fill={`url(#${uid}-halo)`} />
          ) : null}
          <circle className="pulse-node-disc" cx={n.x} cy={n.y} r={n.active ? 11 : 7.5} />
          <circle className="pulse-node-glint" cx={n.x - 3} cy={n.y - 3} r={n.active ? 2.2 : 1.4} />
          <text x={n.lx} y={n.ly} textAnchor="middle">
            {shortLabel(n.name, 14)}
          </text>
        </g>
      ))}
      {active && connectionLabel ? (
        <text
          className="pulse-link-label"
          x={(active.x + CORE.x) / 2}
          y={(active.y + CORE.y) / 2 - 12}
          textAnchor="middle"
        >
          {connectionLabel}
        </text>
      ) : null}
    </svg>
  );
}
