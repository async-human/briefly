"use client";

import Link from "next/link";
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
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onClearSelection: () => void;
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
  selectedNodeId,
  onSelectNode,
  onClearSelection,
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
          selectedNodeId={selectedNodeId}
          onSelectNode={onSelectNode}
          onClearSelection={onClearSelection}
        />
        <p className="pulse-world-note">
          Select an entity to inspect its signal and filter the intelligence below. Every watched
          relationship stays visible.
        </p>
      </article>
    </header>
  );
}

function PulseField({
  nodes,
  connectionLabel,
  generating,
  selectedNodeId,
  onSelectNode,
  onClearSelection,
}: {
  nodes: PulseNode[];
  connectionLabel: string | null;
  generating: boolean;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onClearSelection: () => void;
}) {
  const visibleNodes = nodes.slice(0, MAX_VISIBLE_NODES);
  const litCount = visibleNodes.filter((node) => node.active).length;
  const selectedNode = visibleNodes.find((node) => node.id === selectedNodeId) || null;
  const rows = Array.from(
    { length: Math.ceil(visibleNodes.length / 2) },
    (_, index) => ({
      left: visibleNodes[index * 2] ?? null,
      right: visibleNodes[index * 2 + 1] ?? null,
    }),
  );
  const coreState = selectedNode
    ? entityStatus(selectedNode, true)
    : generating
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
    <div className="pulse-field-wrap">
      <div
        className={`pulse-field${generating ? " is-thinking" : ""}${selectedNode ? " has-selection" : ""}`}
        role="group"
        aria-label={`Your world connections. ${accessibleSummary}. Select an entity to inspect its signals.`}
        aria-busy={generating}
      >
        <span className="pulse-field-axis" aria-hidden />

        <div className="pulse-field-core" aria-live="polite">
          <span className="pulse-field-core-name">
            {selectedNode ? shortLabel(selectedNode.name, 18) : "Briefly"}
          </span>
          <span className="pulse-field-core-state">{coreState}</span>
        </div>

        <div className="pulse-field-rows">
          {rows.map(({ left, right }, index) => (
            <div className="pulse-field-row" key={`${left?.id ?? "empty"}-${right?.id ?? index}`}>
              {left ? (
                <PulseEntity
                  node={left}
                  side="left"
                  selected={left.id === selectedNodeId}
                  disabled={generating}
                  onSelect={onSelectNode}
                />
              ) : <span className="pulse-field-entity is-empty" />}
              <span
                className={`pulse-field-edge is-left${left?.active ? " is-on" : ""}${left?.id === selectedNodeId ? " is-selected" : ""}`}
                aria-hidden
              />
              <span className="pulse-field-axis-gap" aria-hidden />
              <span
                className={`pulse-field-edge is-right${right?.active ? " is-on" : ""}${right?.id === selectedNodeId ? " is-selected" : ""}`}
                aria-hidden
              />
              {right ? (
                <PulseEntity
                  node={right}
                  side="right"
                  selected={right.id === selectedNodeId}
                  disabled={generating}
                  onSelect={onSelectNode}
                />
              ) : <span className="pulse-field-entity is-empty" />}
            </div>
          ))}
        </div>
      </div>

      {selectedNode ? (
        <section className="pulse-selection" aria-label={`${selectedNode.name} monitoring details`}>
          <div className="pulse-selection-copy" aria-live="polite">
            <p className="pulse-selection-name">{selectedNode.name}</p>
            <p className="pulse-selection-summary">{entityStatus(selectedNode, true)}</p>
            <p className="pulse-selection-reason">
              {selectedNode.latestSignal || "No unread signal is attached to this entity right now."}
            </p>
          </div>
          <div className="pulse-selection-actions">
            {selectedNode.reviewHref ? (
              <Link className="pulse-selection-action is-primary" href={selectedNode.reviewHref}>
                Review signal
              </Link>
            ) : (
              <Link className="pulse-selection-action is-primary" href={selectedNode.askHref}>
                Ask Briefly
              </Link>
            )}
            <Link className="pulse-selection-action" href={selectedNode.networkHref}>
              Open in Network
            </Link>
            <button type="button" className="pulse-selection-action" onClick={onClearSelection}>
              Show all
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function PulseEntity({
  node,
  side,
  selected,
  disabled,
  onSelect,
}: {
  node: PulseNode;
  side: "left" | "right";
  selected: boolean;
  disabled: boolean;
  onSelect: (nodeId: string) => void;
}) {
  return (
    <button
      type="button"
      className={`pulse-field-entity is-${side}${node.active ? " is-on" : ""}${selected ? " is-selected" : ""}`}
      onClick={() => onSelect(node.id)}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={`${node.name}, ${entityStatus(node, true)}`}
      data-state={disabled ? "loading" : selected ? "success" : undefined}
    >
      <span className="pulse-field-entity-name">{shortLabel(node.name, 26)}</span>
      <span className="pulse-field-entity-state">{entityStatus(node)}</span>
    </button>
  );
}

function entityStatus(node: PulseNode, detailed = false): string {
  const signals = countPhrase(node.signalCount, "1 signal", `${node.signalCount} signals`);
  const details = [
    node.urgentCount > 0
      ? countPhrase(node.urgentCount, "1 urgent", `${node.urgentCount} urgent`)
      : null,
    node.changeCount > 0
      ? countPhrase(node.changeCount, "1 material change", `${node.changeCount} material changes`)
      : null,
    node.decisionCount > 0
      ? countPhrase(node.decisionCount, "1 decision affected", `${node.decisionCount} decisions affected`)
      : null,
  ].filter(Boolean);

  if (detailed && node.signalCount > 0) return [signals, ...details].join(" · ");
  if (details.length > 0) return details.join(" · ");
  if (node.signalCount > 0) return signals;
  if (node.cardIds.length > 0) return "Connected to today’s brief";
  return "Watching";
}
