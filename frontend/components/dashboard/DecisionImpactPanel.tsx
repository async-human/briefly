"use client";

import Link from "next/link";
import { askUrl } from "@/lib/askLinks";
import type { DigestItem, WatchedAlert } from "@/lib/api";

type DecisionFields = Pick<
  DigestItem,
  | "decision_thread_id"
  | "decision_title"
  | "decision_belief"
  | "decision_confidence"
  | "decision_previous_confidence"
  | "decision_status"
  | "decision_stance"
  | "memory_reference"
  | "evolution_note"
  | "contradiction_flag"
  | "contradiction_explanation"
  | "suggested_action"
  | "headline"
>;

type DecisionImpactPanelProps = {
  item: DecisionFields;
  onKeepMonitoring?: () => void;
  keepMonitoringDone?: boolean;
};

function settingsThreadHref(threadId: string): string {
  return `/settings?thread=${encodeURIComponent(threadId)}#decision-threads`;
}

export function hasDecisionImpact(item: DecisionFields): boolean {
  return Boolean(
    item.decision_thread_id
      || item.memory_reference
      || item.evolution_note
      || (item.contradiction_flag && item.contradiction_explanation),
  );
}

export function DecisionImpactPanel({
  item,
  onKeepMonitoring,
  keepMonitoringDone,
}: DecisionImpactPanelProps) {
  if (!hasDecisionImpact(item)) return null;

  const threadId = item.decision_thread_id;
  const title = item.decision_title?.trim();
  const belief = item.decision_belief?.trim();
  const stance = item.decision_stance;
  const status = item.decision_status;
  const conf =
    typeof item.decision_confidence === "number" ? Math.round(item.decision_confidence * 100) : null;
  const prevConf =
    typeof item.decision_previous_confidence === "number"
      ? Math.round(item.decision_previous_confidence * 100)
      : null;
  const beliefMoved = prevConf != null && conf != null && prevConf !== conf;
  const isReconsider =
    stance === "contradicting" || status === "reconsider" || Boolean(item.contradiction_flag);

  const pastContext =
    item.memory_reference?.trim()
    || item.evolution_note?.trim()
    || (item.contradiction_flag && item.contradiction_explanation
      ? item.contradiction_explanation.trim()
      : null);

  let impactLine: string | null = null;
  if (isReconsider && title && belief) {
    impactLine = `This may weaken your assumption on “${title}”: ${belief}`;
  } else if (isReconsider && title) {
    impactLine = `Worth revisiting your “${title}” decision thread.`;
  } else if (title && belief) {
    impactLine = `Connected to your “${title}” thread — current belief: ${belief}`;
  } else if (title) {
    impactLine = `Connected to your “${title}” decision thread.`;
  }

  const askPrompt = title
    ? `Given this update on “${item.headline}”, how does it affect our decision on ${title}?`
    : `How does “${item.headline}” affect our strategic assumptions?`;

  return (
    <section
      className={`read-decision-impact${isReconsider ? " is-reconsider" : ""}`}
      aria-labelledby={threadId ? "read-decision-impact-title" : undefined}
    >
      <header className="read-decision-impact-head">
        <span className="read-field-label" id="read-decision-impact-title">
          {isReconsider ? "Assumption to revisit" : "Decision context"}
        </span>
        {isReconsider ? (
          <span className="read-decision-impact-badge">May change your call</span>
        ) : null}
      </header>

      {impactLine ? <p className="read-decision-impact-lead">{impactLine}</p> : null}

      {pastContext && pastContext !== impactLine ? (
        <div className="read-six-point">
          <span className="read-field-label">Past context</span>
          <p className="read-six-point-text">{pastContext}</p>
        </div>
      ) : null}

      {beliefMoved ? (
        <p className="read-decision-impact-conf">
          Belief confidence: {prevConf}% → {conf}%
        </p>
      ) : conf != null && threadId ? (
        <p className="read-decision-impact-conf">{conf}% belief confidence</p>
      ) : null}

      {item.suggested_action ? (
        <div className="read-six-point">
          <span className="read-field-label">Recommended</span>
          <p className="read-six-point-text">{item.suggested_action}</p>
        </div>
      ) : null}

      <div className="read-decision-impact-actions" role="group" aria-label="Decision actions">
        {threadId ? (
          <Link href={settingsThreadHref(threadId)} className="read-decision-btn">
            Review decision
          </Link>
        ) : null}
        <Link
          href={askUrl({ threadId: threadId ?? undefined, title: askPrompt })}
          className="read-decision-btn"
        >
          Ask Briefly
        </Link>
        {onKeepMonitoring ? (
          <button
            type="button"
            className={`read-decision-btn read-decision-btn--quiet${keepMonitoringDone ? " is-on" : ""}`}
            onClick={onKeepMonitoring}
            disabled={keepMonitoringDone}
          >
            {keepMonitoringDone ? "Monitoring noted" : "Keep monitoring"}
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function decisionFieldsFromAlert(alert: WatchedAlert): DecisionFields {
  return {
    decision_thread_id: alert.decision_thread_id,
    decision_title: alert.decision_title,
    decision_belief: alert.decision_belief,
    decision_confidence: alert.decision_confidence,
    decision_previous_confidence: alert.decision_previous_confidence,
    decision_status: alert.decision_status,
    decision_stance: alert.decision_stance,
    memory_reference: null,
    evolution_note: null,
    contradiction_flag: false,
    contradiction_explanation: null,
    suggested_action: alert.action,
    headline: alert.title,
  };
}
