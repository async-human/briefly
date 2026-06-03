import { API_URL, getToken } from "./auth";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  timeoutMs?: number,
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const controller = timeoutMs ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
      signal: controller?.signal ?? options.signal,
    });

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
  } catch (err) {
    if (controller?.signal.aborted) {
      throw new ApiError(
        "Request timed out — your briefing may still be generating. Try refreshing in a moment.",
        408,
      );
    }
    if (err instanceof ApiError) throw err;
    if (err instanceof Error && err.message === "Failed to fetch") {
      throw new ApiError(
        "Could not reach the server — your brief may still be generating. Try Refresh brief in a moment.",
        0,
      );
    }
    throw err;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function requestFormData<T>(
  path: string,
  formData: FormData,
  signal?: AbortSignal,
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers,
    body: formData,
    signal,
  });

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
  auto_suggestions: AutoSuggestion[];
  sources_discovery_confirmed: boolean;
  pending_discovery_count: number;
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

export type BonusItem = {
  title: string;
  source: string;
  url: string;
  score: number;
};

export type DigestOutcome = {
  saved_minutes?: number;
  filtered_count?: number;
  top_priority_content_ids?: string[];
  catch_up_topics?: string[];
  goal?: string | null;
  skipped_note?: string;
  items_shown?: number;
  items_scanned?: number;
};

export type DigestItem = {
  id: string;
  content_id?: string | null;
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
  // Compounding intelligence fields
  memory_reference?: string | null;
  confidence_signal?: string | null;
  evolution_note?: string | null;
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
  meta: {
    skipped?: SkippedItem[];      // backward compat: truly filtered items
    blocked?: SkippedItem[];      // explicitly rejected: never_show, low_relevance
    more_today?: BonusItem[];     // good fit but cut for daily length cap
    outcome?: DigestOutcome;
  };
};

export type GenerateDigestResponse = {
  status: "running" | "complete";
  digest: Digest | null;
  warnings: string[];
};

export type BriefingGenerationStatus = {
  status: "idle" | "running" | "complete" | "error";
  step?: string | null;
  label?: string | null;
  digest_id?: string | null;
  digest?: Digest | null;
  warnings?: string[];
  error?: string | null;
  started_at?: string | null;
  updated_at?: string | null;
};

export type IngestionSummary = {
  last_ingestion_at: string | null;
  last_summary: {
    items_new?: number;
    items_updated?: number;
    sources_ok?: number;
    ingested_at?: string;
  };
  activity_feed: { type: string; message: string; at: string }[];
  pool_items_recent: number;
};

export type DiscoveryCandidate = {
  id: string;
  name: string;
  identifier: string;
  source_type: string;
  layer: "inbound_footprint" | "deep_link" | "youtube_subscription" | "reddit_subscription" | "interest_feed" | string;
  confidence: number;
  relevance_score: number;
  selected: boolean;
  reason: string;
  meta: Record<string, unknown>;
};

export type DiscoveryProgress = {
  status: "running" | "complete" | "error";
  step: string;
  label: string;
  messages_scanned?: number;
  senders_found?: number;
  candidates_found?: number;
  updated_at?: string;
  error?: string;
};

export type DiscoveryMeta = {
  last_run_at?: string;
  gmail_messages_scanned?: number;
  gmail_senders_found?: number;
  gmail_scan_error?: string;
  gmail_scan_error_message?: string;
  discovery_mode?: string;
  connected_accounts?: string[];
  layer_counts?: Record<string, number>;
  duration_ms?: number;
  progress?: DiscoveryProgress;
};

export type DiscoveryRunResponse = {
  status: "running" | "complete" | "error";
  candidates: DiscoveryCandidate[];
  connected_accounts: string[];
  meta: DiscoveryMeta;
};

export type DiscoveryStatusResponse = {
  confirmed: boolean;
  pending_count: number;
  candidates: DiscoveryCandidate[];
  meta: DiscoveryMeta;
};

export type DiscoveryConfirmResponse = {
  added: Source[];
  total_sources: number;
  confirmed: boolean;
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

export type AutoSuggestion = SourceSuggestion & {
  reason: string;
  discovered_at?: string | null;
  source: "catalog" | "medium" | string;
};

export type Source = {
  id: string;
  source_type: string;
  status: string;
  name: string | null;
  identifier: string;
  last_fetched_at: string | null;
  created_at: string;
  priority?: "high" | "normal" | "low";
};

export type StoryThread = {
  topic: string;
  weeks: number;
  appearances: number;
  latest: string;
};

export type ProfileIntelligence = {
  digest_day: number;
  strongest_interests: string[];
  emerging_interests: string[];
  moved_away_from: string[];
  active_threads: StoryThread[];
  top_sources: string[];
  deprioritized_sources: string[];
  topic_strengths: Record<string, number>;
  reading_stats: {
    total_digests: number;
    avg_open_rate: number;
    avg_click_rate: number;
  };
  interests_are_declared: boolean;
};

export type WeeklyReportTopic = {
  topic: string;
  observation: string;
};

export type WeeklyReport = {
  week_number: number;
  digest_day: number;
  user_name: string | null;
  digest_date: string;
  stories_read: number;
  top_source: string;
  top_topics: WeeklyReportTopic[];
  thinking_shift: string;
  building_thread: string;
  blind_spot: string;
};

export type BrainDump = {
  id: string;
  title: string;
  clean_summary: string;
  intent_type: string;
  action_items: string[];
  relevance_keywords: string[];
  should_inject_into_morning_brief: boolean;
  tomorrow_brief_preview?: string;
  raw_transcript: string;
  input_mode: string;
  created_at: string;
  injected_at?: string | null;
  injected_digest_id?: string | null;
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
  setSourcePriority: (id: string, priority: "high" | "normal" | "low") =>
    request<Source>(`/api/v1/sources/${id}/priority`, {
      method: "PATCH",
      body: JSON.stringify({ priority }),
    }),
  generateDigest: (options?: { force?: boolean }) =>
    request<GenerateDigestResponse>(
      `/api/v1/digests/generate${options?.force ? "?force=true" : ""}`,
      { method: "POST" },
    ),
  getBriefingGenerationStatus: () =>
    request<BriefingGenerationStatus>("/api/v1/digests/generate/status"),
  getIngestionSummary: () =>
    request<IngestionSummary>("/api/v1/ingestion/summary"),
  runIngestion: () =>
    request<IngestionSummary>("/api/v1/ingestion/run", { method: "POST" }),
  runSourceDiscovery: () =>
    request<DiscoveryRunResponse>("/api/v1/sources/discover/run", { method: "POST" }),
  confirmSourceDiscovery: (candidateIds: string[]) =>
    request<DiscoveryConfirmResponse>("/api/v1/sources/discover/confirm", {
      method: "POST",
      body: JSON.stringify({ candidate_ids: candidateIds }),
    }),
  getDiscoveryStatus: () =>
    request<DiscoveryStatusResponse>("/api/v1/sources/discover/status"),
  resetSourceDiscovery: () =>
    request<{ reset: boolean }>("/api/v1/sources/discover/reset", { method: "POST" }),
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
    request<{
      connected: boolean;
      email: string | null;
      newsletter_count: number | null;
      access_error?: string | null;
      access_error_message?: string | null;
    }>("/api/v1/auth/gmail/status"),
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
  recordFeedback: (body: {
    signal_type: string;
    digest_item_id: string;
    digest_id?: string;
    meta?: Record<string, unknown>;
  }) =>
    request<void>("/api/v1/feedback", { method: "POST", body: JSON.stringify(body) }),

  // Reading session completion — records a "opened" signal with elapsed time
  completeReading: (digestId: string, readTimeSec: number) =>
    request<void>("/api/v1/feedback", {
      method: "POST",
      body: JSON.stringify({
        signal_type: "opened",
        digest_item_id: digestId,
        digest_id: digestId,
        meta: { read_time_seconds: readTimeSec },
      }),
    }).catch(() => { /* non-critical */ }),

  // Profile intelligence — accumulated learning data
  getProfileIntelligence: () =>
    request<ProfileIntelligence>("/api/v1/profile/intelligence"),

  // Weekly intelligence report
  getWeeklyReport: () =>
    request<WeeklyReport>("/api/v1/weekly-report"),

  // Readwise
  connectReadwise: (api_key: string) =>
    request<Source>("/api/v1/auth/readwise/connect", {
      method: "POST",
      body: JSON.stringify({ api_key }),
    }),
  disconnectReadwise: () => request<void>("/api/v1/auth/readwise", { method: "DELETE" }),

  // Brain Dump
  listBrainDumps: () => request<BrainDump[]>("/api/v1/brain-dumps"),
  createBrainDump: (body: { text: string }) =>
    request<BrainDump>("/api/v1/brain-dumps", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createBrainDumpAudio: (blob: Blob, filename = "recording.webm") => {
    const form = new FormData();
    form.append("file", blob, filename);
    return requestFormData<BrainDump>("/api/v1/brain-dumps/audio", form);
  },
  transcribeBrainDumpPreview: (
    blob: Blob,
    filename = "recording.webm",
    signal?: AbortSignal,
  ) => {
    const form = new FormData();
    form.append("file", blob, filename);
    return requestFormData<{ text: string }>(
      "/api/v1/brain-dumps/transcribe-preview",
      form,
      signal,
    );
  },
};
