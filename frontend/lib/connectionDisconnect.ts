import type { OnboardingStatus, Source } from "@/lib/api";

export type ConnectorId = "gmail" | "youtube" | "reddit" | "calendar";

const DISCONNECT_DETAILS: Record<ConnectorId, string> = {
  gmail: "Google access revoked. Forwarded mail to your Briefly address is kept.",
  youtube: "New videos won't sync into your brief pool.",
  reddit: "Subreddit feeds won't appear in future briefs.",
  calendar: "Meeting-aware briefings are turned off.",
};

export function disconnectDetail(id: ConnectorId): string {
  return DISCONNECT_DETAILS[id];
}

export function optimisticDisconnectStatus(
  id: ConnectorId,
  status: OnboardingStatus,
): OnboardingStatus {
  if (id === "gmail") {
    return {
      ...status,
      gmail_connected: false,
      gmail_email: null,
      newsletter_count: null,
    };
  }
  if (id === "youtube") {
    return {
      ...status,
      youtube_connected: false,
      youtube_channel_count: null,
    };
  }
  if (id === "calendar") {
    return {
      ...status,
      calendar_connected: false,
      calendar_email: null,
    };
  }
  return {
    ...status,
    reddit_connected: false,
    reddit_subreddit_count: null,
  };
}

export function sourcesAfterOAuthDisconnect(id: ConnectorId, sources: Source[]): Source[] {
  if (id === "youtube") {
    return sources.filter((s) => s.source_type !== "youtube_account");
  }
  if (id === "reddit") {
    return sources.filter((s) => s.source_type !== "reddit_account");
  }
  if (id === "gmail") {
    return sources.filter((s) => s.source_type !== "gmail");
  }
  return sources;
}
