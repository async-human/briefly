"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { countPhrase, knownStateLine, knownStateValue, shortLabel, type PulseNode } from "@/lib/intelligenceHome";

type MorningPulseProps = {
  greeting: string;
  dateLabel: string;
  line: string;
  changeCount: number;
  decisionCount: number;
  urgentCount: number;
  watchCount: number;
  pendingCheckCount: number;
  lastCheckedAt: string | null;
  nodes: PulseNode[];
  connectionLabel: string | null;
  generating?: boolean;
  scanning: boolean;
  scanError: boolean;
  scanResult: { entities: number; newAlerts: number } | null;
  onScan: () => void;
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
  watchCount,
  pendingCheckCount,
  lastCheckedAt,
  nodes,
  connectionLabel,
  generating,
  scanning,
  scanError,
  scanResult,
  onScan,
  selectedNodeId,
  onSelectNode,
  onClearSelection,
}: MorningPulseProps) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

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
          <div className="pulse-world-heading">
            <h3 className="pulse-world-title">Your world</h3>
            <p
              className={`pulse-world-monitor${scanning ? " is-scanning" : ""}${scanError ? " is-error" : ""}`}
              role={scanError ? "alert" : "status"}
            >
              <span className="pulse-monitor-dot" aria-hidden />
              {monitoringOverview({
                watchCount,
                pendingCheckCount,
                lastCheckedAt,
                scanning,
                scanError,
                scanResult,
                now,
              })}
            </p>
          </div>
          <div className="pulse-world-tools">
            <p className="pulse-world-meta">{worldStatus}</p>
            {watchCount > 0 ? (
              <button
                type="button"
                className="pulse-world-check"
                onClick={onScan}
                disabled={scanning}
                aria-busy={scanning}
                data-state={scanning ? "loading" : scanError ? "error" : scanResult ? "success" : undefined}
              >
                {scanning ? "Checking…" : scanError ? "Retry check" : "Check now"}
              </button>
            ) : null}
          </div>
        </header>
        <PulseField
          nodes={nodes}
          connectionLabel={connectionLabel}
          generating={Boolean(generating)}
          scanning={scanning}
          now={now}
          onScan={onScan}
          selectedNodeId={selectedNodeId}
          onSelectNode={onSelectNode}
          onClearSelection={onClearSelection}
        />
        <p className="pulse-world-note">
          Select an entity to see last-known pricing, API, and product state. Cards below are
          only for a material change, not the baseline.
        </p>
      </article>
    </header>
  );
}

function PulseField({
  nodes,
  connectionLabel,
  generating,
  scanning,
  now,
  onScan,
  selectedNodeId,
  onSelectNode,
  onClearSelection,
}: {
  nodes: PulseNode[];
  connectionLabel: string | null;
  generating: boolean;
  scanning: boolean;
  now: number | null;
  onScan: () => void;
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
  const coreState = scanning
    ? "Checking source network"
    : selectedNode
      ? signalStatus(selectedNode, true)
      : generating
      ? "Reading your world"
    : connectionLabel
      ? `Context: ${shortLabel(connectionLabel, 24)}`
      : litCount > 0
        ? countPhrase(litCount, "1 entity in focus", `${litCount} entities in focus`)
        : "Monitoring quietly";
  const accessibleSummary = visibleNodes.length > 0
    ? visibleNodes
        .map((node) => `${node.name}, ${monitoringLabel(node, scanning, now)}`)
        .join("; ")
    : "No tracked entities yet";

  return (
    <div className="pulse-field-wrap">
      <div
        className={`pulse-field${generating ? " is-thinking" : ""}${scanning ? " is-scanning" : ""}${selectedNode ? " has-selection" : ""}`}
        role="group"
        aria-label={`Your world connections. ${accessibleSummary}. Select an entity to inspect its signals.`}
        aria-busy={generating || scanning}
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
                  disabled={generating || scanning}
                  scanning={scanning}
                  now={now}
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
                  disabled={generating || scanning}
                  scanning={scanning}
                  now={now}
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
            <p className="pulse-selection-monitor">
              <span className="pulse-monitor-dot" aria-hidden />
              {monitoringLabel(selectedNode, scanning, now)}
              {selectedNode.lastCheckedAt ? ` · ${checkStatus(selectedNode.lastCheckedAt, now)}` : ""}
            </p>
            <p className="pulse-selection-summary">{signalStatus(selectedNode, true)}</p>
            {selectedNode.coverageLine ? (
              <p className="pulse-selection-coverage">{selectedNode.coverageLine}</p>
            ) : null}
            {selectedNode.knownStates.length > 0 ? (
              <ul className="pulse-selection-known">
                {selectedNode.knownStates.map((row) => (
                  <li key={row.aspect}>
                    <span className="pulse-selection-known-label">{row.label}</span>
                    <span className="pulse-selection-known-state">{knownStateValue(row)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="pulse-selection-known-empty">
                {knownStateEmpty(selectedNode)}
              </p>
            )}
            <p className="pulse-selection-reason">
              {selectedNode.latestSignal || quietReason(selectedNode)}
            </p>
          </div>
          <div className="pulse-selection-actions">
            {selectedNode.reviewHref ? (
              <Link className="pulse-selection-action is-primary" href={selectedNode.reviewHref}>
                Review signal
              </Link>
            ) : !selectedNode.lastCheckedAt ? (
              <button
                type="button"
                className="pulse-selection-action is-primary"
                onClick={onScan}
                disabled={scanning}
                aria-busy={scanning}
                data-state={scanning ? "loading" : undefined}
              >
                {scanning ? "Checking…" : "Check sources"}
              </button>
            ) : (
              <Link className="pulse-selection-action is-primary" href={selectedNode.askHref}>
                Ask Briefly
              </Link>
            )}
            {selectedNode.coverageStatus === "news_only" ? (
              <Link className="pulse-selection-action" href="/settings">
                Pin a page
              </Link>
            ) : (
              <Link className="pulse-selection-action" href={selectedNode.networkHref}>
                Open in Network
              </Link>
            )}
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
  scanning,
  now,
  onSelect,
}: {
  node: PulseNode;
  side: "left" | "right";
  selected: boolean;
  disabled: boolean;
  scanning: boolean;
  now: number | null;
  onSelect: (nodeId: string) => void;
}) {
  const monitor = entityMonitorPresentation(node, scanning, now);

  return (
    <button
      type="button"
      className={`pulse-field-entity is-${side} is-${monitor.tone}${node.active ? " is-on" : ""}${selected ? " is-selected" : ""}`}
      onClick={() => onSelect(node.id)}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={`${node.name}, ${monitor.badge}${monitor.detail ? `, ${monitor.detail}` : ""}${node.knownStates[0] ? `, ${knownStateLine(node.knownStates[0])}` : ""}`}
      data-state={disabled ? "loading" : selected ? "success" : undefined}
    >
      <span className="pulse-field-entity-name">{shortLabel(node.name, 26)}</span>
      <span className="pulse-field-entity-badge">
        <span className="pulse-monitor-dot" aria-hidden />
        {monitor.badge}
      </span>
      {monitor.detail ? (
        <span className="pulse-field-entity-activity">{monitor.detail}</span>
      ) : null}
      {node.knownStates[0] ? (
        <span className="pulse-field-entity-known">{knownStateLine(node.knownStates[0])}</span>
      ) : null}
    </button>
  );
}

type MonitorTone = "pending" | "live" | "hot" | "paused" | "scanning";

function entityMonitorPresentation(
  node: PulseNode,
  scanning: boolean,
  now: number | null,
): { tone: MonitorTone; badge: string; detail: string | null } {
  if (scanning) {
    return { tone: "scanning", badge: "Scanning sources", detail: null };
  }
  if (!node.monitoringActive) {
    return { tone: "paused", badge: "Paused", detail: "Monitoring is off" };
  }
  if (!node.lastCheckedAt) {
    return {
      tone: "pending",
      badge: "Needs first scan",
      detail: "Run Check now to activate",
    };
  }
  if (node.urgentCount > 0) {
    return {
      tone: "hot",
      badge: countPhrase(node.urgentCount, "1 urgent", `${node.urgentCount} urgent`),
      detail: signalStatus(node),
    };
  }
  if (node.signalCount > 0 || node.changeCount > 0 || node.decisionCount > 0) {
    return {
      tone: "hot",
      badge: signalStatus(node),
      detail: checkStatus(node.lastCheckedAt, now),
    };
  }
  if (node.cardIds.length > 0) {
    return {
      tone: "hot",
      badge: "In today’s brief",
      detail: checkStatus(node.lastCheckedAt, now),
    };
  }
  return {
    tone: "live",
    badge: "Live",
    detail: checkStatus(node.lastCheckedAt, now),
  };
}

function knownStateEmpty(node: PulseNode): string {
  if (node.coverageStatus === "news_only" || node.coverageStatus === "skipped") {
    return "No official pricing, docs, or changelog page confirmed yet. Pin a URL in Settings if we missed it.";
  }
  if (node.coverageStatus === "official" || node.coverageStatus === "partial") {
    return (
      node.coverageLine
      || "The first confirmed official page is stored as a baseline, not an alert. Last-known copy appears once Check now stores an extract."
    );
  }
  return "No last-known pricing, API, or product state yet.";
}

function signalStatus(node: PulseNode, detailed = false): string {
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
  return "No unread signals";
}

function monitoringLabel(node: PulseNode, scanning: boolean, now: number | null): string {
  return entityMonitorPresentation(node, scanning, now).badge;
}

function checkStatus(lastCheckedAt: string | null, now: number | null): string {
  if (!lastCheckedAt) return "First check pending";
  if (now == null) return "Source check recorded";
  const checkedAt = Date.parse(lastCheckedAt);
  if (!Number.isFinite(checkedAt)) return "Source check recorded";
  const elapsedMinutes = Math.max(0, Math.floor((now - checkedAt) / 60_000));
  if (elapsedMinutes < 1) return "Checked just now";
  if (elapsedMinutes < 60) return `Checked ${elapsedMinutes} min ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `Checked ${elapsedHours} hr ago`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  return `Checked ${elapsedDays} d ago`;
}

function quietReason(node: PulseNode): string {
  if (!node.monitoringActive) return "Monitoring is paused for this entity.";
  if (!node.lastCheckedAt) {
    return "The first source check has not completed yet. Run a check to establish its monitoring state.";
  }
  return "No unread signal met the alert threshold on the latest source check.";
}

function monitoringOverview({
  watchCount,
  pendingCheckCount,
  lastCheckedAt,
  scanning,
  scanError,
  scanResult,
  now,
}: {
  watchCount: number;
  pendingCheckCount: number;
  lastCheckedAt: string | null;
  scanning: boolean;
  scanError: boolean;
  scanResult: { entities: number; newAlerts: number } | null;
  now: number | null;
}): string {
  if (scanError) return "Source check failed · retry available";
  if (scanning) {
    return countPhrase(watchCount, "Checking 1 active watch…", `Checking ${watchCount} active watches…`);
  }
  if (scanResult) {
    const watches = countPhrase(scanResult.entities, "1 watch checked", `${scanResult.entities} watches checked`);
    const alerts = scanResult.newAlerts === 0
      ? "no new alerts"
      : countPhrase(scanResult.newAlerts, "1 new alert", `${scanResult.newAlerts} new alerts`);
    return `${watches} · ${alerts}`;
  }
  if (watchCount === 0) return "No active watches";
  const watches = countPhrase(watchCount, "1 active watch", `${watchCount} active watches`);
  if (pendingCheckCount > 0) {
    const pending = countPhrase(
      pendingCheckCount,
      "1 needs first scan",
      `${pendingCheckCount} need first scan`,
    );
    return `${watches} · ${pending}`;
  }
  return `${watches} · ${checkStatus(lastCheckedAt, now)}`;
}
