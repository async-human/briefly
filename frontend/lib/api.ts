import { API_URL, getToken } from "./auth";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = body.detail;
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join(", ")
          : res.statusText;
    throw new ApiError(message || res.statusText, res.status);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export type User = {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  email_token: string;
  is_verified: boolean;
  created_at: string;
};

export type Profile = {
  role: string | null;
  goal: string | null;
  digest_time: string;
  digest_timezone: string;
  interests: { topic: string; weight: number; source: string }[];
  never_show: string[];
  recent_insight: string | null;
};

export type MeResponse = {
  user: User;
  profile: Profile | null;
  ingestion_email: string;
  onboarding_completed: boolean;
  gmail_connected: boolean;
  youtube_connected: boolean;
  reddit_connected: boolean;
  reading_streak: number;
};

export type OnboardingStatus = {
  onboarding_completed: boolean;
  profile_started: boolean;
  gmail_connected: boolean;
  gmail_email: string | null;
  newsletter_count: number | null;
  youtube_connected: boolean;
  youtube_channel_count: number | null;
  reddit_connected: boolean;
  reddit_subreddit_count: number | null;
  sources_count: number;
};

export type MemoryConnection = {
  type: string;
  description: string;
  digest_id?: string;
  item_id?: string;
};

export type SkippedItem = {
  title: string;
  source: string;
  reason: string;
  score: number;
};

export type DigestItem = {
  id: string;
  position: number;
  section: string | null;
  headline: string;
  summary: string;
  why_it_matters: string;
  source_name: string | null;
  source_url: string | null;
  all_sources: Record<string, unknown>[];
  memory_connections: MemoryConnection[];
  was_saved: boolean;
  was_clicked: boolean;
  duplicate_count: number;
};

export type Digest = {
  id: string;
  digest_date: string;
  status: string;
  subject_line: string | null;
  preview_text: string | null;
  total_items_ingested: number;
  total_items_shown: number;
  created_at: string;
  items: DigestItem[];
  meta: { skipped?: SkippedItem[] };
};

export type GenerateDigestResponse = {
  digest: Digest;
  warnings: string[];
};

export type DigestSummary = {
  id: string;
  digest_date: string;
  status: string;
  subject_line: string | null;
  preview_text: string | null;
  total_items_shown: number;
  created_at: string;
};

export type SourceDetection = {
  source_type: string;
  identifier: string;
  label: string;
  hint: string;
  confidence: string;
};

export type GmailSender = {
  email: string;
  name: string;
  count: number;
};

export type GmailDiscoverResponse = {
  senders: GmailSender[];
};

export type BulkAddResponse = {
  added: Source[];
  skipped: number;
};

export type SourceSuggestion = {
  name: string;
  url: string;
  source_type: string;
  topic: string;
  description: string;
};

export type Source = {
  id: string;
  source_type: string;
  status: string;
  name: string | null;
  identifier: string;
  last_fetched_at: string | null;
  created_at: string;
};

export const api = {
  getMe: () => request<MeResponse>("/api/v1/me"),
  getLatestDigest: () => request<Digest | null>("/api/v1/digests/latest"),
  getDigests: () => request<DigestSummary[]>("/api/v1/digests"),
  getDigest: (id: string) => request<Digest>(`/api/v1/digests/${id}`),
  getSources: () => request<Source[]>("/api/v1/sources"),
  detectSource: (body: { identifier: string; source_type?: string }) =>
    request<SourceDetection>("/api/v1/sources/detect", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  addSource: (body: { identifier: string; source_type?: string; name?: string }) =>
    request<Source>("/api/v1/sources", { method: "POST", body: JSON.stringify(body) }),
  deleteSource: (id: string) =>
    request<void>(`/api/v1/sources/${id}`, { method: "DELETE" }),
  generateDigest: () =>
    request<GenerateDigestResponse>("/api/v1/digests/generate", { method: "POST" }),
  getOnboardingStatus: () => request<OnboardingStatus>("/api/v1/onboarding/status"),
  updateOnboardingProfile: (body: {
    role?: string;
    goal?: string;
    digest_time?: string;
    digest_timezone?: string;
    interests?: string[];
    never_show?: string[];
    recent_insight?: string;
  }) =>
    request<OnboardingStatus>("/api/v1/onboarding/profile", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  completeOnboarding: () =>
    request<{ onboarding_completed: boolean }>("/api/v1/onboarding/complete", {
      method: "POST",
    }),
  startGmailConnect: (redirectPath = "/onboarding") =>
    request<{ url: string }>(
      `/api/v1/auth/gmail/start?redirect_path=${encodeURIComponent(redirectPath)}`,
      { method: "POST" },
    ),
  getGmailStatus: () =>
    request<{ connected: boolean; email: string | null; newsletter_count: number | null }>(
      "/api/v1/auth/gmail/status",
    ),
  disconnectGmail: () => request<void>("/api/v1/auth/gmail", { method: "DELETE" }),

  startYouTubeConnect: (redirectPath = "/onboarding") =>
    request<{ url: string }>(
      `/api/v1/auth/youtube/start?redirect_path=${encodeURIComponent(redirectPath)}`,
      { method: "POST" },
    ),
  getYouTubeStatus: () =>
    request<{ connected: boolean; email: string | null; channel_count: number | null }>(
      "/api/v1/auth/youtube/status",
    ),
  disconnectYouTube: () => request<void>("/api/v1/auth/youtube", { method: "DELETE" }),

  startRedditConnect: (redirectPath = "/onboarding") =>
    request<{ url: string }>(
      `/api/v1/auth/reddit/start?redirect_path=${encodeURIComponent(redirectPath)}`,
      { method: "POST" },
    ),
  getRedditStatus: () =>
    request<{ connected: boolean; username: string | null; subreddit_count: number | null }>(
      "/api/v1/auth/reddit/status",
    ),
  disconnectReddit: () => request<void>("/api/v1/auth/reddit", { method: "DELETE" }),

  // Gmail discovery
  discoverGmailNewsletters: () =>
    request<GmailDiscoverResponse>("/api/v1/sources/discover/gmail"),
  bulkAddSources: (sources: { identifier: string; source_type?: string; name?: string }[]) =>
    request<BulkAddResponse>("/api/v1/sources/bulk", {
      method: "POST",
      body: JSON.stringify({ sources }),
    }),

  // Source suggestions
  getSourceSuggestions: () =>
    request<SourceSuggestion[]>("/api/v1/sources/suggestions"),

  // Item feedback
  recordFeedback: (body: { signal_type: string; digest_item_id: string; digest_id?: string }) =>
    request<void>("/api/v1/feedback", { method: "POST", body: JSON.stringify(body) }),

  // Reading session completion — records a "opened" signal with elapsed time
  completeReading: (digestId: string, readTimeSec: number) =>
    request<void>("/api/v1/feedback", {
      method: "POST",
      body: JSON.stringify({
        signal_type: "opened",
        digest_item_id: digestId,   // reuse field to carry digest id
        digest_id: digestId,
        read_time_seconds: readTimeSec,
      }),
    }).catch(() => { /* non-critical */ }),

  // Readwise
  connectReadwise: (api_key: string) =>
    request<Source>("/api/v1/auth/readwise/connect", {
      method: "POST",
      body: JSON.stringify({ api_key }),
    }),
  disconnectReadwise: () => request<void>("/api/v1/auth/readwise", { method: "DELETE" }),
};
