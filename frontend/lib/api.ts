import { API_URL, clearToken, getToken, setAuthNext } from "./auth";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/**
 * Session expired (JWT past its 7-day window) — clear the stale token and
 * send the user to login instead of surfacing raw 401 errors in the UI.
 * The login page owns all post-login redirect logic.
 */
function handleUnauthorized(): void {
  if (typeof window === "undefined") return;
  const path = window.location.pathname;
  if (path.startsWith("/login") || path.startsWith("/auth")) return;
  if (!getToken()) return; // never had a session — page guards handle this
  clearToken();
  setAuthNext(path);
  window.location.assign("/login?reason=session_expired");
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
      if (res.status === 401) handleUnauthorized();
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
    if (res.status === 401) handleUnauthorized();
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

export type BriefStyle = "analyst" | "scan" | "plain";
export type BriefLanguage = "en" | "hi";

export type Profile = {
  role: string | null;
  goal: string | null;
  digest_time: string;
  digest_timezone: string;
  interests: { topic: string; weight: number; source: string }[];
  never_show: string[];
  recent_insight: string | null;
  brief_style?: BriefStyle;
  brief_language?: BriefLanguage;
};

export type MeResponse = {
  user: User;
  profile: Profile | null;
  ingestion_email: string;
  onboarding_completed: boolean;
  gmail_connected: boolean;
  youtube_connected: boolean;
  reddit_connected: boolean;
  calendar_connected: boolean;
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
  calendar_connected: boolean;
  calendar_email: string | null;
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
  contradiction_flag?: boolean;
  contradiction_explanation?: string | null;
  was_disliked?: boolean;
  score_breakdown?: Record<string, unknown>;
  why_this_summary?: string | null;
};

export type DigestStats = {
  closing_line: string;
  dedup_line?: string | null;
  items_ingested: number;
  items_shown: number;
  source_count: number;
  merged_story_count: number;
  monthly_time_saved_minutes: number;
  monthly_time_saved_label: string;
  avg_read_minutes: number;
};

export type SerendipityConnection = {
  title: string;
  body: string;
  content_id?: string | null;
  headline?: string | null;
  kind?: "in_brief" | "history" | "saved" | string;
  thread_update?: string | null;
  thread_key?: string | null;
  strength?: number;
};

export type ProactiveEvent = {
  id: string;
  event_type: string;
  title: string;
  body: string;
  thread_key?: string | null;
  priority?: number;
  created_at?: string | null;
};

export type FeedbackResponse = {
  learned_message: string | null;
};

export type WrappedExample = {
  headline: string;
  source?: string | null;
};

export type WrappedAction = {
  label: string;
  href: string;
};

export type WrappedShift = {
  topic: string;
  direction: string;
  label?: string;
  detail?: string;
  evidence?: string;
  examples?: WrappedExample[];
  action?: WrappedAction;
};

export type WrappedTopicRow = {
  topic: string;
  detail?: string;
  examples?: WrappedExample[];
  action?: WrappedAction;
};

/** @deprecated Use WrappedTopicRow */
export type WrappedTopic = WrappedTopicRow;

export type WrappedWeekStats = {
  reads_this_week?: number;
  reads_prior_week?: number;
  delta_label?: string;
};

export type WrappedSectionHints = {
  active?: string;
  shifting?: string;
  ignored?: string;
  uncovered?: string;
  emerging?: string;
};

export type WrappedSnapshot = {
  synthesis?: string;
  lead?: string;
  depth_trend?: string;
  depth_label?: string;
  weekly_synthesis?: string;
  week_stats?: WrappedWeekStats;
  section_hints?: WrappedSectionHints;
  shifts?: WrappedShift[];
  active_topics?: WrappedTopicRow[];
  ignored?: WrappedTopicRow[];
  uncovered?: WrappedTopicRow[];
  emerging?: WrappedTopicRow[];
  gaps?: WrappedTopicRow[];
  current_focus?: string;
  mind_shifts?: WrappedShift[];
  high_engagement?: WrappedTopicRow[];
  emerging_threads?: string[] | WrappedTopicRow[];
  coverage_gaps?: string[];
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
  stats?: DigestStats | null;
  meta: {
    adjustment_confirmation?: string[];
    closing_stats?: DigestStats;
    skipped?: SkippedItem[];      // backward compat: truly filtered items
    blocked?: SkippedItem[];      // explicitly rejected: never_show, low_relevance
    more_today?: BonusItem[];     // good fit but cut for daily length cap
    outcome?: DigestOutcome;
    serendipity?: SerendipityConnection[];
    proactive_events?: ProactiveEvent[];
    calendar?: {
      meetings: {
        title: string;
        time: string;
        attendees?: string[];
        relevant_stories?: { headline: string; source?: string }[];
        active_threads?: string[];
      }[];
      meeting_count?: number;
    };
    wrapped?: WrappedSnapshot;
    blind_spots?: {
      type: string;
      topic: string;
      consensus: string;
      counter_headline?: string | null;
      counter_source?: string | null;
      counter_argument?: string | null;
    }[];
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

export type DiscoveredArticle = {
  id: string;
  title: string;
  url: string;
  source_name: string;
  summary?: string;
  published_at?: string | null;
  feed_url?: string;
  source_type?: string;
  relevance_score?: number;
  discovery_reason?: string;
  why_relevant?: string;
  intent_topic?: string;
  publisher_domain?: string;
};

export type DiscoveredArticlesResponse = {
  articles: DiscoveredArticle[];
  refreshed_at?: string | null;
  meta?: Record<string, unknown>;
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

export type GmailAccessLogEvent = {
  at: string;
  action: string;
  detail: string;
  messages_scanned?: number;
  senders_found?: number;
  sender?: string;
  count?: number;
  delete_content?: boolean;
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

export type BehavioralInsight = {
  type: string;
  label: string;
  text: string;
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
  behavioral: {
    total_signals?: number;
    overall_engagement?: number;
    save_rate?: number;
    window_days?: number;
    computed_at?: string | null;
    latest_signal_at?: string | null;
    topic_actual?: Record<string, {
      rate: number;
      stories_shown?: number;
      engaged: number;
      saves: number;
      skipped: number;
      total: number;
      ready?: boolean;
      source?: "declared" | "discovered";
    }>;
    source_engagement?: Record<string, number>;
    emerging_topics?: string[];
    insights?: BehavioralInsight[];
  };
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

export type BrowserCapture = {
  id: string;
  title: string;
  url: string | null;
  summary: string;
  user_note: string | null;
  created_at: string;
  in_briefing: boolean;
  connection_sentence: string | null;
  thread_label: string | null;
  why_relevant: string | null;
};

export type UrlCaptureResponse = {
  id: string;
  title: string;
  url: string;
  summary: string;
  user_note: string | null;
  created_at: string;
  already_saved: boolean;
  enrichment_status: "complete" | "partial" | "pending";
  enrichment: {
    connection_sentence: string | null;
    thread_key: string | null;
    thread_label: string | null;
    thread_item_count: number | null;
    why_relevant: string | null;
    briefing_message: string | null;
  };
};

export type KnowledgeGraphNodeType = "topic" | "source" | "item" | "thought" | "thread";

export type KnowledgeGraphNode = {
  id: string;
  type: KnowledgeGraphNodeType;
  label: string;
  size: number;
  meta: Record<string, unknown>;
};

export type KnowledgeGraphEdge = {
  id: string;
  source: string;
  target: string;
  type: string;
  weight: number;
  label: string | null;
};

export type AskCitation = {
  ref: string;
  content_id: string;
  title: string;
  url: string | null;
  source_name: string | null;
  snippet: string;
  kind: string;
};

export type AskMessage = {
  role: "user" | "assistant";
  content: string;
  citations?: AskCitation[];
  timestamp?: string;
};

export type AskThreadSummary = {
  id: string;
  title: string;
  preview: string;
  digest_item_id: string | null;
  content_id: string | null;
  anchor_title: string | null;
  updated_at: string | null;
  message_count: number;
};

export type AskThread = {
  id: string;
  digest_item_id: string | null;
  content_id: string | null;
  anchor_title: string | null;
  messages: AskMessage[];
  created_at: string | null;
  updated_at: string | null;
};

export type AskStreamEvent =
  | { type: "thread_id"; thread_id: string }
  | { type: "delta"; content: string }
  | {
      type: "done";
      citations: AskCitation[];
      created_at: string;
      content_id?: string | null;
      digest_item_id?: string | null;
      anchor_title?: string | null;
    }
  | { type: "error"; message: string };

function parseAskSseBuffer(buffer: string): AskStreamEvent[] {
  const events: AskStreamEvent[] = [];
  for (const part of buffer.split("\n\n")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    for (const line of trimmed.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      events.push(JSON.parse(line.slice(6)) as AskStreamEvent);
    }
  }
  return events;
}

async function* readAskStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<AskStreamEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        for (const event of parseAskSseBuffer(part)) {
          yield event;
          if (event.type === "error") return;
        }
      }
    }
    if (done) break;
  }

  buffer += decoder.decode();
  for (const event of parseAskSseBuffer(buffer)) {
    yield event;
    if (event.type === "error") return;
  }
}

export type KnowledgeGraphResponse = {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  stats: {
    digest_day: number;
    topic_count: number;
    thread_count: number;
    item_count: number;
    thought_count: number;
    source_count: number;
    edge_count: number;
    time_window_days?: number;
    thread_focus?: boolean;
    items_total_candidates?: number;
    items_displayed?: number;
    digests_scanned?: number;
    similarity_edges_capped?: boolean;
  };
};

export const api = {
  getMe: () => request<MeResponse>("/api/v1/me"),
  getLatestDigest: () => request<Digest | null>("/api/v1/digests/latest"),
  getTodayDigest: () => request<Digest | null>("/api/v1/digests/today"),
  getDigests: () => request<DigestSummary[]>("/api/v1/digests"),
  getDigest: (id: string) => request<Digest>(`/api/v1/digests/${id}`),
  getDigestFeedback: (id: string) =>
    request<Record<string, "saved" | "disliked">>(`/api/v1/digests/${id}/feedback`),
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
  generateDigest: (options?: { force?: boolean; restart?: boolean }) => {
    const params = new URLSearchParams();
    if (options?.force) params.set("force", "true");
    if (options?.restart) params.set("restart", "true");
    const qs = params.toString();
    return request<GenerateDigestResponse>(
      `/api/v1/digests/generate${qs ? `?${qs}` : ""}`,
      { method: "POST" },
    );
  },
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
  getDiscoveredArticles: () =>
    request<DiscoveredArticlesResponse>("/api/v1/discover/articles"),
  refreshDiscoveredArticles: () =>
    request<DiscoveredArticlesResponse>("/api/v1/discover/articles/refresh", { method: "POST" }),
  getOnboardingStatus: () => request<OnboardingStatus>("/api/v1/onboarding/status"),
  updateOnboardingProfile: (body: {
    role?: string;
    goal?: string;
    digest_time?: string;
    digest_timezone?: string;
    interests?: string[];
    never_show?: string[];
    recent_insight?: string;
    brief_style?: BriefStyle;
    brief_language?: BriefLanguage;
  }) =>
    request<OnboardingStatus>("/api/v1/onboarding/profile", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  addNeverShowTopic: (topic: string) =>
    request<{ never_show: string[] }>("/api/v1/profile/never-show", {
      method: "POST",
      body: JSON.stringify({ topic }),
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
  disconnectGmail: (deleteContent = true) =>
    request<{
      ok: boolean;
      delete_content: boolean;
      removed_sources: number;
      removed_content_items: number;
    }>(`/api/v1/auth/gmail?delete_content=${deleteContent ? "true" : "false"}`, {
      method: "DELETE",
    }),
  getGmailAccessLog: () =>
    request<{
      connected: boolean;
      email: string | null;
      events: GmailAccessLogEvent[];
    }>("/api/v1/privacy/gmail-access-log"),
  deleteAccount: (confirmEmail: string) =>
    request<void>("/api/v1/privacy/account", {
      method: "DELETE",
      body: JSON.stringify({ confirm_email: confirmEmail }),
    }),

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

  startCalendarConnect: (redirectPath = "/settings") =>
    request<{ url: string }>(
      `/api/v1/auth/calendar/start?redirect_path=${encodeURIComponent(redirectPath)}`,
      { method: "POST" },
    ),
  getCalendarStatus: () =>
    request<{ connected: boolean; email: string | null }>("/api/v1/auth/calendar/status"),
  disconnectCalendar: () => request<void>("/api/v1/auth/calendar", { method: "DELETE" }),

  // Gmail discovery
  discoverGmailNewsletters: () =>
    request<GmailDiscoverResponse>("/api/v1/sources/discover/gmail"),
  bulkAddSources: (
    sources: { identifier: string; source_type?: string; name?: string }[],
    options?: { fromGmail?: boolean },
  ) =>
    request<BulkAddResponse>("/api/v1/sources/bulk", {
      method: "POST",
      body: JSON.stringify({ sources, from_gmail: Boolean(options?.fromGmail) }),
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
    request<FeedbackResponse>("/api/v1/feedback", { method: "POST", body: JSON.stringify(body) }),

  getProactiveEvents: () =>
    request<ProactiveEvent[]>("/api/v1/proactive-events"),

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

  // Week in focus (live behavioral snapshot)
  getWeekInFocus: () =>
    request<WrappedSnapshot>("/api/v1/week-in-focus"),

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

  // Browser captures (extension + mobile share)
  listCaptures: () => request<BrowserCapture[]>("/api/v1/captures"),
  captureUrl: (body: { url: string; title?: string; note?: string }) =>
    request<UrlCaptureResponse>(
      "/api/v1/capture/url",
      { method: "POST", body: JSON.stringify(body) },
      20_000,
    ),

  getKnowledgeGraph: (days?: number) => {
    const qs = days ? `?days=${days}` : "";
    return request<KnowledgeGraphResponse>(`/api/v1/graph${qs}`);
  },
  graphTopicAction: (body: { topic: string; action: "boost" | "mute" }) =>
    request<{ topic: string; action: string; strength: number }>(
      "/api/v1/graph/actions/topic",
      { method: "POST", body: JSON.stringify(body) },
    ),
  graphSourceAction: (body: { source_id: string; action: "prioritize" | "deprioritize" }) =>
    request<{ source_id: string; action: string; priority: string; weight: number }>(
      "/api/v1/graph/actions/source",
      { method: "POST", body: JSON.stringify(body) },
    ),

  ask: (body: {
    message: string;
    thread_id?: string;
    content_id?: string;
    digest_item_id?: string;
  }) =>
    request<{
      thread_id: string;
      assistant: AskMessage & { created_at: string };
    }>("/api/v1/ask", { method: "POST", body: JSON.stringify(body) }, 60000),

  askStream: async function* (
    body: {
      message: string;
      thread_id?: string;
      content_id?: string;
      digest_item_id?: string;
    },
    signal?: AbortSignal,
  ): AsyncGenerator<AskStreamEvent> {
    const token = getToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${API_URL}/api/v1/ask/stream`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const detail = errBody.detail;
      const message =
        typeof detail === "string"
          ? detail
          : Array.isArray(detail)
            ? detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join(", ")
            : res.statusText;
      throw new ApiError(message || res.statusText, res.status);
    }

    if (!res.body) {
      throw new ApiError("No response stream", 0);
    }

    yield* readAskStream(res.body);
  },

  listAskThreads: () =>
    request<{ threads: AskThreadSummary[] }>("/api/v1/ask/threads"),

  getAskThread: (threadId: string) =>
    request<{ thread: AskThread }>(`/api/v1/ask/threads/${threadId}`),

  deleteAskThread: (threadId: string) =>
    request<{ ok: boolean }>(`/api/v1/ask/threads/${threadId}`, { method: "DELETE" }),

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
