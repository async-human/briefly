"use client";

import type { CSSProperties } from "react";
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

/** Balanced seats around the monitoring core. Mobile CSS turns these into a list. */
const SEATS: Array<{ x: number; y: number }> = [
  { x: 22, y: 25 },
  { x: 78, y: 25 },
  { x: 18, y: 72 },
  { x: 82, y: 72 },
  { x: 50, y: 12 },
  { x: 50, y: 86 },
];

function connectionPath(x: number, y: number): string {
  const targetX = x * 10;
  const targetY = y * 3.2;
  const controlX = 500 + (targetX - 500) * 0.52;
  const controlY = 160 + (targetY - 160) * 0.32;
  return `M 500 160 Q ${controlX.toFixed(1)} ${controlY.toFixed(1)} ${targetX.toFixed(1)} ${targetY.toFixed(1)}`;
}

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
  const worldStatus = changeCount > 0
    ? overnight
    : urgentCount > 0
      ? countPhrase(urgentCount, "1 urgent signal", `${urgentCount} urgent signals`)
      : decisionCount > 0
        ? countPhrase(decisionCount, "1 decision in focus", `${decisionCount} decisions in focus`)
        : "Quiet so far";

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
          <p className="pulse-world-meta">{worldStatus}</p>
        </header>
        <PulseField
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

function PulseField({
  nodes,
  connectionLabel,
  generating,
}: {
  nodes: PulseNode[];
  connectionLabel: string | null;
  generating: boolean;
}) {
  const litCount = nodes.filter((n) => n.active).length;
  const placed = nodes.slice(0, SEATS.length).map((node, i) => ({
    ...node,
    ...SEATS[i],
  }));
  const focusNode = placed.find((node) => node.active);

  return (
    <div
      className={`pulse-field${generating ? " is-thinking" : ""}`}
      role="img"
      aria-label={
        litCount > 0
          ? `Your world. ${litCount} of ${placed.length} tracked ${placed.length === 1 ? "entity is" : "entities are"} in focus.`
          : `Your world. Monitoring ${placed.length} tracked ${placed.length === 1 ? "entity" : "entities"}.`
      }
    >
      <svg className="pulse-field-map" viewBox="0 0 1000 320" preserveAspectRatio="none" aria-hidden>
        <ellipse className="pulse-field-orbit pulse-field-orbit-outer" cx="500" cy="160" rx="390" ry="118" />
        <ellipse className="pulse-field-orbit pulse-field-orbit-inner" cx="500" cy="160" rx="250" ry="72" />
        {focusNode ? (
          <path
            className="pulse-field-connection"
            d={connectionPath(focusNode.x, focusNode.y)}
          />
        ) : null}
      </svg>

      <div className="pulse-field-core">
        <span className="pulse-field-core-mark" aria-hidden />
        <span className="pulse-field-core-name">Briefly</span>
        <span className="pulse-field-core-state">
          {generating
            ? "Reading your world"
            : connectionLabel
              ? `Connected to ${shortLabel(connectionLabel, 24)}`
              : "Monitoring quietly"}
        </span>
      </div>

      {placed.map((n) => (
        <div
          key={n.id}
          className={`pulse-field-entity${n.active ? " is-on" : ""}`}
          style={{ left: `${n.x}%`, top: `${n.y}%` } as CSSProperties}
        >
          <span className="pulse-field-entity-dot" aria-hidden />
          <span className="pulse-field-entity-copy">
            <span className="pulse-field-entity-name">{shortLabel(n.name, 22)}</span>
            <span className="pulse-field-entity-state">{n.active ? "In focus" : "Watching"}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
