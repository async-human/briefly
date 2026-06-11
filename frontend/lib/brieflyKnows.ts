import type { BehavioralInsight, ProfileIntelligence, StoryThread } from "@/lib/api";

const INSIGHT_PRIORITY: Record<string, number> = {
  divergence: 0,
  drift: 1,
  source_loyalty: 2,
  engagement: 3,
  saves: 9,
};

export function rankInsights(insights: BehavioralInsight[]): BehavioralInsight[] {
  return [...insights].sort(
    (a, b) =>
      (INSIGHT_PRIORITY[a.type] ?? 5) - (INSIGHT_PRIORITY[b.type] ?? 5),
  );
}

export type TopicEngagementRow = {
  topic: string;
  rate: number;
  storiesShown: number;
  saves: number;
  skipped: number;
  engaged: number;
};

export function getTopTopicEngagement(
  intel: ProfileIntelligence,
  limit = 3,
): TopicEngagementRow[] {
  const topicActual = intel.behavioral?.topic_actual ?? {};
  return Object.entries(topicActual)
    .filter(([topic]) => topic.trim().length > 1)
    .map(([topic, data]) => ({
      topic,
      rate: data.rate ?? 0,
      storiesShown: data.stories_shown ?? 0,
      saves: data.saves ?? 0,
      skipped: data.skipped ?? 0,
      engaged: data.engaged ?? 0,
    }))
    .filter((row) => row.storiesShown > 0 || row.saves + row.skipped > 0)
    .sort((a, b) => b.rate - a.rate || b.saves - a.saves || b.storiesShown - a.storiesShown)
    .slice(0, limit);
}

export function getTopSourceEngagement(
  intel: ProfileIntelligence,
): { name: string; rate: number } | null {
  const entries = Object.entries(intel.behavioral?.source_engagement ?? {})
    .filter(([name, rate]) => name.trim().length > 1 && rate >= 0.45)
    .sort(([, a], [, b]) => b - a);
  if (!entries.length) return null;
  const [name, rate] = entries[0];
  return { name, rate };
}

export function formatTopicSignal(row: TopicEngagementRow): string {
  const parts: string[] = [];
  if (row.saves > 0) parts.push(`${row.saves} saved`);
  if (row.skipped > 0) parts.push(`${row.skipped} skipped`);
  if (parts.length === 0 && row.engaged > 0) parts.push(`${row.engaged} engaged`);
  if (parts.length === 0 && row.storiesShown > 0) {
    return `${row.storiesShown} in briefings · no actions yet`;
  }
  return parts.join(" · ");
}

/** One-line accordion subtitle for the dashboard drawer. */
export function getBrieflyKnowsTeaser(
  intel: ProfileIntelligence,
  streak: number,
): string {
  const insights = rankInsights(intel.behavioral?.insights ?? []);
  const topInsight = insights[0];
  if (topInsight?.label) {
    return topInsight.label;
  }

  const topTopic = getTopTopicEngagement(intel, 1)[0];
  if (topTopic && topTopic.rate >= 0.35) {
    return `${topTopic.topic} · ${Math.round(topTopic.rate * 100)}% engaged`;
  }

  const thread = intel.active_threads?.[0];
  if (thread) {
    return `Tracking ${thread.topic}`;
  }

  const emerging = [
    ...(intel.emerging_interests ?? []),
    ...(intel.behavioral?.emerging_topics ?? []),
  ][0];
  if (emerging) {
    return `Emerging: ${emerging}`;
  }

  if (streak > 1) {
    return `Day ${intel.digest_day || 1} · ${streak}-day streak`;
  }

  return `Day ${intel.digest_day || 1} · reading patterns`;
}

export function getFeaturedThread(threads: StoryThread[] | undefined): StoryThread | null {
  if (!threads?.length) return null;
  return threads[0];
}
