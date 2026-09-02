"use client";

import Link from "next/link";
import type { Digest, ProfileIntelligence } from "@/lib/api";
import { hasSubstantiveWrappedContent } from "@/lib/weekInFocus";

type Props = {
  intel: ProfileIntelligence | null;
  digest: Digest | null;
};

type IntelligenceObservation = {
  id: string;
  label: string;
  title: string;
  detail: string;
};

const MAX_OBSERVATIONS = 4;

function clean(value: string | null | undefined, max = 150): string {
  const text = (value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1)).replace(/\s+\S*$/, "")}…`;
}

function buildObservations(
  intel: ProfileIntelligence | null,
  digest: Digest | null,
): IntelligenceObservation[] {
  const observations: IntelligenceObservation[] = [];
  const seen = new Set<string>();
  const add = (observation: IntelligenceObservation | null) => {
    if (!observation || observations.length >= MAX_OBSERVATIONS) return;
    const key = `${observation.label}:${observation.title}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    observations.push(observation);
  };

  const wrapped = digest?.meta?.wrapped;
  const shift = wrapped?.shifts?.[0] || wrapped?.mind_shifts?.[0];
  if (shift) {
    const shiftTitle = clean(
      shift.label || [shift.topic, shift.direction].filter(Boolean).join(" "),
      80,
    );
    add({
      id: `shift:${shift.topic}`,
      label: "What is changing",
      title: shiftTitle || clean(shift.topic, 80),
      detail: clean(
        shift.detail || shift.evidence || shift.examples?.[0]?.headline || "A sustained change is forming in your reading.",
      ),
    });
  } else if (wrapped && hasSubstantiveWrappedContent(wrapped)) {
    const active = wrapped.active_topics?.[0] || wrapped.high_engagement?.[0];
    add({
      id: "week-focus",
      label: "What is changing",
      title: clean(active?.topic || wrapped.current_focus || "Your week in focus", 80),
      detail: clean(
        active?.detail || wrapped.synthesis || wrapped.weekly_synthesis || wrapped.lead,
      ),
    });
  }

  const blindSpot = digest?.meta?.blind_spots?.[0];
  if (blindSpot) {
    add({
      id: `blind:${blindSpot.topic}`,
      label: "What you may be missing",
      title: clean(blindSpot.topic, 80),
      detail: clean(blindSpot.counter_argument || blindSpot.counter_headline || blindSpot.consensus),
    });
  }

  const thread = intel?.active_threads?.[0];
  if (thread) {
    const appearances = `${thread.appearances} ${thread.appearances === 1 ? "signal" : "signals"}`;
    const duration = thread.weeks > 0 ? ` across ${thread.weeks} ${thread.weeks === 1 ? "week" : "weeks"}` : "";
    add({
      id: `thread:${thread.topic}`,
      label: "Thread progressing",
      title: clean(thread.topic, 80),
      detail: clean(`${appearances}${duration}. ${thread.latest}`),
    });
  }

  const connection = digest?.meta?.serendipity?.[0];
  if (connection) {
    add({
      id: `connection:${connection.title}`,
      label: "What connects",
      title: clean(connection.title, 80),
      detail: clean(connection.thread_update || connection.body),
    });
  }

  const gap = wrapped?.uncovered?.[0] || wrapped?.gaps?.[0] || wrapped?.ignored?.[0];
  if (gap) {
    add({
      id: `gap:${gap.topic}`,
      label: "Coverage to reconsider",
      title: clean(gap.topic, 80),
      detail: clean(gap.detail || "Your recent reading leaves this area lightly covered."),
    });
  }

  const behavioral = intel?.behavioral?.insights?.[0];
  if (behavioral) {
    add({
      id: `pattern:${behavioral.type}`,
      label: "Your reading pattern",
      title: clean(behavioral.label, 80),
      detail: clean(behavioral.text),
    });
  }

  return observations;
}

export function DashboardInsightsDrawer({ intel, digest }: Props) {
  const observations = buildObservations(intel, digest);

  return (
    <section className="dash-intelligence-panel" aria-labelledby="dash-intelligence-title">
      <header className="dash-intelligence-head">
        <div>
          <p className="dash-intelligence-kicker">Across your reading</p>
          <h2 id="dash-intelligence-title" className="dash-intelligence-title">
            Briefly Intelligence
          </h2>
        </div>
        <span className="dash-intelligence-count" aria-label={`${observations.length} observations`}>
          {String(observations.length).padStart(2, "0")}
        </span>
      </header>

      {observations.length > 0 ? (
        <ol className="dash-intelligence-list">
          {observations.map((observation) => (
            <li key={observation.id} className="dash-intelligence-item">
              <p className="dash-intelligence-label">{observation.label}</p>
              <h3 className="dash-intelligence-observation">{observation.title}</h3>
              <p className="dash-intelligence-detail">{observation.detail}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="dash-intelligence-empty">
          No durable pattern yet. Briefly will surface shifts, blind spots, and progressing threads as evidence accumulates.
        </p>
      )}

      <Link href="/intelligence" className="dash-intelligence-open">
        Open Intelligence <span aria-hidden>→</span>
      </Link>
    </section>
  );
}
