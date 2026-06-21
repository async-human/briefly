import type { ProfileIntelligence, WrappedSnapshot } from "@/lib/api";

export function hasWrappedContent(wrapped: WrappedSnapshot): boolean {
  return Boolean(
    wrapped.synthesis ||
      wrapped.weekly_synthesis ||
      wrapped.lead ||
      (wrapped.shifts && wrapped.shifts.length > 0) ||
      (wrapped.mind_shifts && wrapped.mind_shifts.length > 0) ||
      (wrapped.active_topics && wrapped.active_topics.length > 0) ||
      (wrapped.high_engagement && wrapped.high_engagement.length > 0) ||
      (wrapped.ignored && wrapped.ignored.length > 0) ||
      (wrapped.uncovered && wrapped.uncovered.length > 0) ||
      (wrapped.gaps && wrapped.gaps.length > 0) ||
      (wrapped.emerging && wrapped.emerging.length > 0) ||
      (wrapped.emerging_threads && wrapped.emerging_threads.length > 0) ||
      wrapped.depth_label,
  );
}

export function buildWrappedFromIntel(intel: ProfileIntelligence): WrappedSnapshot | null {
  const topicActual = intel.behavioral?.topic_actual;
  if (!topicActual) return null;

  const entries = Object.entries(topicActual).filter(([, v]) => v.total > 0);
  if (entries.length === 0) return null;

  const active_topics = entries
    .filter(([, v]) => v.engaged > 0)
    .sort((a, b) => b[1].rate - a[1].rate)
    .slice(0, 4)
    .map(([topic, v]) => {
      const parts: string[] = [];
      if (v.engaged) {
        parts.push(`${v.engaged} opened`);
      }
      if (v.saves) {
        parts.push(`${v.saves} saved`);
      }
      if (v.rate >= 0.01) {
        parts.push(`${Math.round(v.rate * 100)}% open rate`);
      }
      return { topic, detail: parts.join(" · ") || "Engaged recently" };
    });

  const ignored = entries
    .filter(([, v]) => v.skipped > v.engaged && v.total >= 2)
    .sort((a, b) => b[1].skipped - a[1].skipped)
    .slice(0, 3)
    .map(([topic, v]) => ({
      topic,
      detail: `${v.skipped} skipped · ${v.total} shown`,
      action: { label: "Edit interests", href: "/settings" as const },
    }));

  const emerging = (intel.behavioral?.emerging_topics ?? []).slice(0, 3).map((topic) => ({
    topic,
    detail: "Emerging in your reading",
  }));

  const insightText = intel.behavioral?.insights?.[0]?.text?.trim();
  const synthesis =
    insightText ||
    (active_topics.length
      ? `Most active: ${active_topics
          .slice(0, 2)
          .map((t) => t.topic)
          .join(", ")}`
      : "");

  const openRate = intel.reading_stats?.avg_open_rate;
  const week_stats =
    openRate != null && openRate >= 0
      ? { delta_label: `${Math.round(openRate * 100)}% avg open rate` }
      : undefined;

  if (!active_topics.length && !ignored.length && !emerging.length && !synthesis) {
    return null;
  }

  return {
    synthesis: synthesis || undefined,
    active_topics: active_topics.length ? active_topics : undefined,
    ignored: ignored.length ? ignored : undefined,
    emerging: emerging.length ? emerging : undefined,
    week_stats,
    section_hints: {
      active: "Topics you opened or saved recently",
      ignored: "Shown often but usually skipped",
      emerging: "Threads gaining traction in your reading",
    },
  };
}

/** True when wrapped data has enough structure to show meaningful week-in-focus rows. */
export function hasSubstantiveWrappedContent(wrapped: WrappedSnapshot): boolean {
  if (!hasWrappedContent(wrapped)) return false;

  const synthesis = (wrapped.synthesis || wrapped.weekly_synthesis || wrapped.lead || "").trim();
  if (synthesis && !isGenericWeeklyCopy(synthesis)) return true;
  if ((wrapped.active_topics?.length ?? 0) > 0) return true;
  if ((wrapped.high_engagement?.length ?? 0) > 0) return true;
  if ((wrapped.shifts?.length ?? 0) > 0 || (wrapped.mind_shifts?.length ?? 0) > 0) return true;
  if ((wrapped.ignored?.length ?? 0) > 0) return true;
  if ((wrapped.uncovered?.length ?? 0) > 0 || (wrapped.gaps?.length ?? 0) > 0) return true;
  if ((wrapped.emerging?.length ?? 0) > 0) return true;
  if (wrapped.depth_label || wrapped.week_stats?.delta_label) return true;
  return false;
}

export function getWeekFocusDescription(wrapped?: WrappedSnapshot | null): string {
  const lead = (wrapped?.synthesis || wrapped?.weekly_synthesis || wrapped?.lead || "").trim();
  if (lead && !isGenericWeeklyCopy(lead)) return lead.slice(0, 72);
  return "Topics, skips, and shifts from your reading";
}

export function isGenericWeeklyCopy(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("non-existent") ||
    lower.includes("consider reviewing your preferences") ||
    lower.includes("still taking shape") ||
    lower.includes("keep reading to build") ||
    lower.includes("aligns with your declared interests") ||
    lower.includes("updating your interests could help")
  );
}
