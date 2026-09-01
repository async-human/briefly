"use client";

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

const MAX_VISIBLE_NODES = 6;

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
  const visibleNodes = nodes.slice(0, MAX_VISIBLE_NODES);
  const litCount = visibleNodes.filter((node) => node.active).length;
  const rows = Array.from(
    { length: Math.ceil(visibleNodes.length / 2) },
    (_, index) => ({
      left: visibleNodes[index * 2] ?? null,
      right: visibleNodes[index * 2 + 1] ?? null,
    }),
  );
  const coreState = generating
    ? "Reading your world"
    : connectionLabel
      ? `Context: ${shortLabel(connectionLabel, 24)}`
      : litCount > 0
        ? countPhrase(litCount, "1 entity in focus", `${litCount} entities in focus`)
        : "Monitoring quietly";
  const accessibleSummary = visibleNodes.length > 0
    ? visibleNodes
        .map((node) => `${node.name}, ${node.active ? "in focus" : "watching"}`)
        .join("; ")
    : "No tracked entities yet";

  return (
    <div
      className={`pulse-field${generating ? " is-thinking" : ""}`}
      role="img"
      aria-label={`Your world. ${accessibleSummary}.`}
    >
      <span className="pulse-field-axis" aria-hidden />

      <div className="pulse-field-core">
        <span className="pulse-field-core-name">Briefly</span>
        <span className="pulse-field-core-state">{coreState}</span>
      </div>

      <div className="pulse-field-rows">
        {rows.map(({ left, right }, index) => (
          <div className="pulse-field-row" key={`${left?.id ?? "empty"}-${right?.id ?? index}`}>
            {left ? <PulseEntity node={left} side="left" /> : <span className="pulse-field-entity is-empty" />}
            <span className={`pulse-field-edge is-left${left?.active ? " is-on" : ""}`} aria-hidden />
            <span className="pulse-field-axis-gap" aria-hidden />
            <span className={`pulse-field-edge is-right${right?.active ? " is-on" : ""}`} aria-hidden />
            {right ? <PulseEntity node={right} side="right" /> : <span className="pulse-field-entity is-empty" />}
          </div>
        ))}
      </div>
    </div>
  );
}

function PulseEntity({ node, side }: { node: PulseNode; side: "left" | "right" }) {
  return (
    <div className={`pulse-field-entity is-${side}${node.active ? " is-on" : ""}`}>
      <span className="pulse-field-entity-name">{shortLabel(node.name, 26)}</span>
      <span className="pulse-field-entity-state">{node.active ? "In focus" : "Watching"}</span>
    </div>
  );
}
