"use client";

import { SourceIcon } from "@/components/SourceIcon";
import type { YouTubeSyncStats } from "@/lib/api";

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "Not yet";
  const diffMs = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Yesterday" : `${days}d ago`;
}

type Props = {
  stats: YouTubeSyncStats | null | undefined;
  compact?: boolean;
};

export function YouTubeSyncStatus({ stats, compact = false }: Props) {
  if (!stats) return null;

  const hasYoutube =
    stats.connected || stats.manual_channel_count > 0 || stats.pool_videos_recent > 0;

  if (!hasYoutube) {
    return (
      <div className="yt-sync yt-sync--empty">
        <div className="yt-sync-head">
          <SourceIcon type="youtube" size={18} />
          <span className="yt-sync-title">YouTube</span>
        </div>
        <p className="yt-sync-hint">
          Connect YouTube in Settings to pull subscriptions, liked videos, and transcripts into your brief.
        </p>
      </div>
    );
  }

  const last = stats.last_fetch;
  const showFetchDetail = last && (last.items as number) > 0;

  return (
    <div className={`yt-sync${compact ? " yt-sync--compact" : ""}`}>
      <div className="yt-sync-head">
        <SourceIcon type="youtube" size={18} />
        <div className="yt-sync-head-text">
          <span className="yt-sync-title">YouTube sync</span>
          {stats.connected && stats.channel_count != null && stats.channel_count > 0 ? (
            <span className="yt-sync-sub">
              {stats.channel_count} subscribed channel{stats.channel_count === 1 ? "" : "s"}
            </span>
          ) : stats.connected ? (
            <span className="yt-sync-sub yt-sync-sub--warn">Connected — check subscription privacy</span>
          ) : stats.manual_channel_count > 0 ? (
            <span className="yt-sync-sub">
              {stats.manual_channel_count} manual channel{stats.manual_channel_count === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
      </div>

      <ul className="yt-sync-metrics">
        <li>
          <strong>{stats.pool_videos_recent}</strong>
          <span>videos in pool</span>
        </li>
        <li>
          <strong>{stats.pool_with_transcript}</strong>
          <span>with transcripts</span>
        </li>
        {stats.last_sync_items > 0 ? (
          <li>
            <strong>{stats.last_sync_items}</strong>
            <span>last sync</span>
          </li>
        ) : null}
      </ul>

      {showFetchDetail ? (
        <p className="yt-sync-detail">
          Last fetch {formatRelative(last.at as string)} —{" "}
          {last.items as number} video{(last.items as number) === 1 ? "" : "s"}
          {(last.liked as number) > 0 ? ` · ${last.liked} liked` : ""}
          {(last.subscriptions as number) > 0 ? ` · ${last.subscriptions} from subs` : ""}
          {(last.transcripts as number) > 0 ? ` · ${last.transcripts} transcribed` : ""}
        </p>
      ) : null}

      {stats.recent_videos.length > 0 && !compact ? (
        <ul className="yt-sync-recent">
          {stats.recent_videos.map((video) => (
            <li key={video.url}>
              <a href={video.url} target="_blank" rel="noopener noreferrer">
                {video.title}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
