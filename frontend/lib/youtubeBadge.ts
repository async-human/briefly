import type { DigestItem } from "@/lib/api";

export type YouTubeBadgeInfo = {
  signal: "liked" | "subscription" | "playlist" | "channel";
  has_transcript?: boolean;
  channel?: string | null;
};

const SIGNAL_LABELS: Record<YouTubeBadgeInfo["signal"], string> = {
  liked: "Liked on YouTube",
  subscription: "From your subscriptions",
  playlist: "From your playlist",
  channel: "YouTube channel",
};

export function isYouTubeDigestItem(item: Pick<DigestItem, "source_url" | "section">): boolean {
  const url = (item.source_url || "").toLowerCase();
  if (url.includes("youtube.com") || url.includes("youtu.be")) return true;
  return (item.section || "").toLowerCase() === "youtube";
}

export function getYouTubeBadge(item: DigestItem): YouTubeBadgeInfo | null {
  const raw = item.score_breakdown?.youtube;
  if (raw && typeof raw === "object" && "signal" in raw) {
    return raw as YouTubeBadgeInfo;
  }
  if (!isYouTubeDigestItem(item)) return null;
  return {
    signal: "subscription",
    has_transcript: false,
    channel: item.source_name,
  };
}

export function youtubeBadgeLabel(badge: YouTubeBadgeInfo): string {
  const base = SIGNAL_LABELS[badge.signal] ?? "YouTube";
  if (badge.channel && badge.signal !== "channel") {
    return `${base} · ${badge.channel}`;
  }
  if (badge.channel && badge.signal === "channel") {
    return badge.channel;
  }
  return base;
}
