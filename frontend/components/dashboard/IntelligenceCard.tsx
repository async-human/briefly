"use client";

import { useId, useState } from "react";
import Link from "next/link";
import type { IntelligenceObject } from "@/lib/intelligenceHome";

type IntelligenceCardProps = {
  object: IntelligenceObject;
};

export function IntelligenceCard({ object }: IntelligenceCardProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const conf = object.confidence != null ? Math.round(object.confidence * 100) : null;
  const kindClass =
    object.kind === "decision" ? "glance-card--decision"
      : object.kind === "pattern" ? "glance-card--pattern"
        : "glance-card--change";
  const sources = object.corroborating && object.corroborating > 1 ? object.corroborating : null;

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
        <span className="glance-card-kicker">{object.label}</span>
        <h3 className="glance-card-title">{object.title}</h3>
        {!open ? (
          <p className="glance-card-glance">{truncate(object.why, 110)}</p>
        ) : null}
        {object.previousState && object.newState ? (
          <StateShift from={object.previousState} to={object.newState} />
        ) : null}
        {!open && sources ? <SourceMarks count={sources} /> : null}
      </button>

      <div id={panelId} className="glance-card-layer" hidden={!open}>
        <p className="glance-card-why">{object.why}</p>
        {object.connected ? (
          <p className="glance-card-meta">
            Connected to {object.connected}
            {conf != null ? ` · ${conf}% confidence` : ""}
            {sources ? ` · ${sources} sources` : ""}
          </p>
        ) : (
          (conf != null || sources) && (
            <p className="glance-card-meta">
              {conf != null ? `${conf}% confidence` : null}
              {conf != null && sources ? " · " : null}
              {sources ? `${sources} sources` : null}
            </p>
          )
        )}
        {open && sources ? <SourceMarks count={sources} /> : null}
        <div className="glance-card-actions">
          {object.readHref ? (
            <Link href={object.readHref} className="glance-card-btn">
              Understand
            </Link>
          ) : null}
          {object.askHref ? (
            <Link href={object.askHref} className="glance-card-btn glance-card-btn-quiet">
              Why does this matter?
            </Link>
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
      </div>
    </article>
  );
}

function StateShift({ from, to }: { from: string; to: string }) {
  return (
    <div className="glance-shift" aria-label={`Was ${from}, now ${to}`}>
      <div className="glance-shift-col">
        <span className="glance-shift-k">Was</span>
        <span className="glance-shift-v">{from}</span>
      </div>
      <span className="glance-shift-arrow" aria-hidden>
        →
      </span>
      <div className="glance-shift-col">
        <span className="glance-shift-k">Now</span>
        <span className="glance-shift-v">{to}</span>
      </div>
    </div>
  );
}

function SourceMarks({ count }: { count: number }) {
  const n = Math.min(count, 8);
  return (
    <p className="glance-sources">
      <span className="glance-sources-dots" aria-hidden>
        {Array.from({ length: n }, (_, i) => (
          <i key={i} />
        ))}
      </span>
      {count} {count === 1 ? "source" : "sources"}
    </p>
  );
}

function truncate(text: string, n: number): string {
  const t = text.trim();
  if (t.length <= n) return t;
  return `${t.slice(0, n).replace(/\s+\S*$/, "")}…`;
}
