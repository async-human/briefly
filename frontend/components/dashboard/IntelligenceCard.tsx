"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { shortLabel, type IntelligenceObject } from "@/lib/intelligenceHome";

type IntelligenceCardProps = {
  object: IntelligenceObject;
};

export function IntelligenceCard({ object }: IntelligenceCardProps) {
  const [open, setOpen] = useState(false);
  const [gone, setGone] = useState(false);
  const [rating, setRating] = useState(false);
  const [ratingError, setRatingError] = useState(false);
  const [showReasons, setShowReasons] = useState(false);
  const panelId = useId();
  const conf = object.confidence != null ? Math.round(object.confidence * 100) : null;
  const beliefMoved =
    object.kind === "decision"
    && object.previousConfidence != null
    && object.confidence != null
    && object.previousConfidence !== object.confidence;
  const kindClass =
    object.kind === "decision" ? "glance-card--decision"
      : object.kind === "pattern" ? "glance-card--pattern"
        : "glance-card--change";

  if (gone) return null;

  async function markNoise(label: "irrelevant" | "duplicate" | "incorrect", note: string) {
    if (!object.signalId || rating) return;
    setRating(true);
    setRatingError(false);
    try {
      await api.rateSignal(object.signalId, label, note);
      setGone(true);
    } catch {
      setRating(false);
      setRatingError(true);
    }
  }

  return (
    <article
      className={`glance-card ${kindClass}${open ? " is-open" : ""}`}
      data-state={open ? "success" : undefined}
    >
      <button
        type="button"
        className="glance-card-hit"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <div className="glance-card-copy">
          <span className="glance-card-kicker">{object.label}</span>
          <h3 className="glance-card-title">{object.title}</h3>
          {object.impact ? (
            <p className="glance-card-impact">{object.impact}</p>
          ) : !open ? (
            <p className="glance-card-glance">{truncate(object.why, 90)}</p>
          ) : null}
        </div>
        <Metric object={object} />
      </button>

      <div id={panelId} className="glance-card-layer" hidden={!open}>
        {object.belief ? (
          <>
            <span className="glance-card-kicker">Current belief</span>
            <p className="glance-card-belief">{object.belief}</p>
          </>
        ) : null}
        <span className="glance-card-kicker">Why it matters</span>
        <p className="glance-card-why">{object.why}</p>
        {beliefMoved ? (
          <p className="glance-conf">
            {Math.round((object.previousConfidence as number) * 100)}% → {conf}% belief
          </p>
        ) : object.kind === "decision" && conf != null ? (
          <p className="glance-conf">{conf}% belief</p>
        ) : object.kind !== "decision" && conf != null ? (
          <p className="glance-conf">{conf}% confidence</p>
        ) : null}
        <div className="glance-card-actions">
          {object.decisionThreadId ? (
            <Link
              href={`/settings?thread=${encodeURIComponent(object.decisionThreadId)}#decision-threads`}
              className="glance-card-btn"
            >
              Review decision
            </Link>
          ) : null}
          {object.askHref ? (
            <Link href={object.askHref} className="glance-card-btn">
              Ask Briefly
            </Link>
          ) : null}
          {object.readHref ? (
            <Link href={object.readHref} className="glance-card-btn glance-card-btn-quiet">
              Review
            </Link>
          ) : null}
          {object.signalId ? (
            <button
              type="button"
              className="glance-card-btn glance-card-btn-quiet"
              onClick={() => setShowReasons((value) => !value)}
              disabled={rating}
              data-state={rating ? "loading" : undefined}
            >
              {rating ? "Saving…" : "Not important"}
            </button>
          ) : null}
          {object.sourceUrl ? (
            <a
              href={object.sourceUrl}
              className="glance-card-btn glance-card-btn-quiet"
              target="_blank"
              rel="noreferrer"
            >
              {object.sourceName || "Source"}
            </a>
          ) : null}
        </div>
        {showReasons && object.signalId ? (
          <div className="glance-card-actions" aria-label="Why this was not important">
            <button disabled={rating} className="glance-card-btn glance-card-btn-quiet" type="button" onClick={() => void markNoise("irrelevant", "already_knew")}>Already knew</button>
            <button disabled={rating} className="glance-card-btn glance-card-btn-quiet" type="button" onClick={() => void markNoise("irrelevant", "does_not_affect_me")}>Doesn’t affect me</button>
            <button disabled={rating} className="glance-card-btn glance-card-btn-quiet" type="button" onClick={() => void markNoise("duplicate", "duplicate_development")}>Duplicate</button>
            <button disabled={rating} className="glance-card-btn glance-card-btn-quiet" type="button" onClick={() => void markNoise("incorrect", "incorrect_signal")}>Incorrect</button>
          </div>
        ) : null}
        {ratingError ? (
          <p className="intel-scan-error" role="alert">Couldn’t save that rating. Try again.</p>
        ) : null}
      </div>
    </article>
  );
}

function Metric({ object }: { object: IntelligenceObject }) {
  if (object.metric) {
    const arrow =
      object.metric.direction === "down" ? "↓ "
        : object.metric.direction === "up" ? "↑ "
          : "";
    return (
      <div className="glance-card-metric">
        <span className={`glance-card-metric-value${object.metric.value.includes("→") ? " is-range" : ""}`}>
          {arrow}{object.metric.value}
        </span>
        <span className="glance-card-metric-hint">{object.metric.hint}</span>
      </div>
    );
  }
  if (object.previousState && object.newState) {
    return (
      <div className="glance-card-metric glance-card-metric--shift">
        <span className="glance-card-metric-was">{shortLabel(object.previousState, 18)}</span>
        <span className="glance-card-metric-arrow" aria-hidden>→</span>
        <span className="glance-card-metric-now">{shortLabel(object.newState, 18)}</span>
      </div>
    );
  }
  return null;
}

function truncate(text: string, n: number): string {
  const t = text.trim();
  if (t.length <= n) return t;
  return `${t.slice(0, n).replace(/\s+\S*$/, "")}…`;
}
