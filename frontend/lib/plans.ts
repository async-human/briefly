import { ApiError } from "./api";

export const FREE_SOURCE_LIMIT = 3;
export const FREE_HISTORY_DAYS = 7;
export const FREE_DIGEST_ITEMS = 5;

export type UpgradeReason =
  | "sources_limit"
  | "brain_dump"
  | "pro_feature"
  | "general";

export const UPGRADE_COPY: Record<
  UpgradeReason,
  { title: string; subtitle: string }
> = {
  sources_limit: {
    title: "You've reached the free source limit",
    subtitle: `Free includes ${FREE_SOURCE_LIMIT} source connections. Upgrade to Pro for unlimited sources and the full Briefly experience.`,
  },
  brain_dump: {
    title: "Brain dump is a Pro feature",
    subtitle:
      "Capture voice notes, links, and thoughts — Briefly weaves them into your next briefing. Upgrade to unlock.",
  },
  pro_feature: {
    title: "This feature requires Pro",
    subtitle:
      "Upgrade for unlimited sources, full briefings, brain dump, Ask Briefly, and more.",
  },
  general: {
    title: "Upgrade to Briefly Pro",
    subtitle:
      "Unlock unlimited sources, full briefings, brain dump, audio briefs, and deeper intelligence.",
  },
};

export const FREE_FEATURES = [
  { text: `${FREE_SOURCE_LIMIT} source connections`, included: true },
  { text: `${FREE_DIGEST_ITEMS} items per briefing`, included: true },
  { text: "Gmail, YouTube, Reddit, RSS", included: true },
  { text: `${FREE_HISTORY_DAYS}-day history`, included: true },
  { text: "Email delivery", included: true },
  { text: "Brain dump & manual capture", included: false },
  { text: "Ask Briefly", included: false },
  { text: "Audio briefs", included: false },
];

export const PRO_FEATURES = [
  { text: "Unlimited source connections", included: true },
  { text: "Full briefing, 8–14 items", included: true },
  { text: "All source types + Readwise", included: true },
  { text: "Unlimited history", included: true },
  { text: "Brain dump — voice, text, links", included: true },
  { text: "Ask Briefly — search your knowledge", included: true },
  { text: "Interest learning", included: true },
  { text: "Audio brief for your commute", included: true },
];

export function isPlanLimitError(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status !== 403) return false;
  return /upgrade|pro plan|free plan|available on the pro/i.test(err.message);
}

export function upgradeReasonFromError(err: unknown): UpgradeReason {
  if (!(err instanceof ApiError)) return "general";
  if (/source/i.test(err.message)) return "sources_limit";
  if (/brain dump|capture/i.test(err.message)) return "brain_dump";
  if (err.status === 403) return "pro_feature";
  return "general";
}
