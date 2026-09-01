"use client";

import { countPhrase, type PulseNode } from "@/lib/intelligenceHome";

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

/** Composed seats around the core — not a regular orbit, so 4 names don't become a plus. */
const SEATS: Array<{ x: number; y: number }> = [
  { x: 18, y: 18 },
  { x: 82, y: 20 },
  { x: 14, y: 78 },
  { x: 86, y: 76 },
  { x: 8, y: 48 },
  { x: 92, y: 50 },
];

export function MorningPulse({
  greeting,
  dateLabel,
  line,
  changeCount,
  decisionCount,
  urgentCount,
  nodes,
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
        <PulsePlate nodes={nodes} generating={Boolean(generating)} />
        <p className="pulse-world-note">
          Only changed or decision-relevant areas are emphasized.
        </p>
      </article>
    </header>
  );
}

function PulsePlate({
  nodes,
  generating,
}: {
  nodes: PulseNode[];
  generating: boolean;
}) {
  const litCount = nodes.filter((n) => n.active).length;
  const placed = nodes.slice(0, SEATS.length).map((node, i) => ({
    ...node,
    ...SEATS[i],
  }));

  return (
    <div
      className={`pulse-plate${generating ? " is-thinking" : ""}`}
      role="img"
      aria-label={
        litCount > 0
          ? `Your world, with ${litCount} tracked ${litCount === 1 ? "name" : "names"} emphasized`
          : "Your tracked world"
      }
    >
      <svg className="pulse-plate-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        {placed.map((n) => (
          <line
            key={n.id}
            className={n.active ? "is-on" : undefined}
            x1="50"
            y1="50"
            x2={n.x}
            y2={n.y}
          />
        ))}
      </svg>
      <span className="pulse-plate-core">Briefly</span>
      {placed.map((n) => (
        <span
          key={n.id}
          className={`pulse-plate-name${n.active ? " is-on" : ""}`}
          style={{ left: `${n.x}%`, top: `${n.y}%` }}
        >
          {n.name}
        </span>
      ))}
    </div>
  );
}
