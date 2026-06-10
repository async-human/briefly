"use client";

import Link from "next/link";
import type { ProfileIntelligence } from "@/lib/api";

type Props = {
  intel: ProfileIntelligence;
  streak: number;
  declaredInterests: string[];
};

export function BrieflyKnowsSummary({ intel, streak, declaredInterests }: Props) {
  const insights = intel.behavioral?.insights ?? [];
  const topInsight = insights[0];
  const interests = intel.strongest_interests.slice(0, 4);
  const emerging = (intel.behavioral?.emerging_topics ?? []).slice(0, 3);

  if (intel.digest_day === 0 && declaredInterests.length === 0) {
    return (
      <div className="bk-summary bk-summary-empty">
        <p className="bk-summary-eyebrow">What Briefly knows</p>
        <p className="bk-summary-hint">Your intelligence profile builds with every briefing you read.</p>
      </div>
    );
  }

  return (
    <div className="bk-summary">
      <div className="bk-summary-head">
        <div>
          <p className="bk-summary-eyebrow">What Briefly knows</p>
          <h3 className="bk-summary-title">
            Day {intel.digest_day || 1}
            {streak > 1 ? ` · ${streak}-day streak` : ""}
          </h3>
        </div>
        <Link href="/settings" className="bk-summary-link">Full profile →</Link>
      </div>

      {topInsight && (
        <p className="bk-summary-insight">
          <span className="bk-summary-insight-label">{topInsight.label}</span>
          {topInsight.text}
        </p>
      )}

      {interests.length > 0 && (
        <div className="bk-summary-chips">
          {interests.map((t) => (
            <span key={t} className="bk-summary-chip">{t}</span>
          ))}
        </div>
      )}

      {emerging.length > 0 && (
        <p className="bk-summary-emerging">
          Emerging: {emerging.join(", ")}
        </p>
      )}
    </div>
  );
}
