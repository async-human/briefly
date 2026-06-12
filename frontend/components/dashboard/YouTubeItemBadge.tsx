"use client";

import { SourceIcon } from "@/components/SourceIcon";
import type { DigestItem } from "@/lib/api";
import { getYouTubeBadge, youtubeBadgeLabel } from "@/lib/youtubeBadge";

type Props = {
  item: DigestItem;
  variant?: "default" | "compact";
};

export function YouTubeItemBadge({ item, variant = "default" }: Props) {
  const badge = getYouTubeBadge(item);
  if (!badge) return null;

  const label = youtubeBadgeLabel(badge);

  return (
    <span className={`yt-item-badge yt-item-badge--${variant}`}>
      <SourceIcon type="youtube" size={variant === "compact" ? 12 : 14} />
      <span className="yt-item-badge-label">{label}</span>
      {badge.has_transcript ? (
        <span className="yt-item-badge-transcript">Transcript</span>
      ) : null}
    </span>
  );
}
