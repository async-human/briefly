from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class UserOut(BaseModel):
    id: str
    email: str
    name: str | None
    avatar_url: str | None
    email_token: str
    is_verified: bool
    plan: str = "free"
    is_founding_member: bool = False
    created_at: datetime

    model_config = {"from_attributes": True}


class CheckoutIn(BaseModel):
    plan: Literal["monthly", "yearly"] = "monthly"


class CheckoutOut(BaseModel):
    checkout_url: str
    session_id: str = ""


class PlanUsageOut(BaseModel):
    sources_used: int = 0
    sources_limit: int | None = None
    sources_at_limit: bool = False
    history_days_limit: int | None = None
    digest_items_limit: int | None = None
    free_limits_reached: bool = False


class BillingStatusOut(BaseModel):
    plan: str
    is_founding_member: bool
    is_pro: bool
    subscribed_at: datetime | None = None
    can_cancel: bool = False
    usage: PlanUsageOut = Field(default_factory=PlanUsageOut)


class CancelSubscriptionIn(BaseModel):
    reason: Literal[
        "too_expensive",
        "missing_features",
        "switched_service",
        "unused",
        "customer_service",
        "low_quality",
        "too_complex",
        "other",
    ]
    comment: str | None = Field(default=None, max_length=2000)


class CancelSubscriptionOut(BaseModel):
    ok: bool = True
    ends_immediately: bool = False
    message: str


class OperatingContext(BaseModel):
    company_name: str = ""
    product: str = ""
    target_customers: str = ""
    competitors: list[str] = Field(default_factory=list)
    tech_stack: list[str] = Field(default_factory=list)
    strategic_goals: str = ""
    risks: str = ""
    strategic_questions: list[str] = Field(default_factory=list)


class ProfileOut(BaseModel):
    role: str | None = None
    goal: str | None = None
    digest_time: str = "07:00"
    digest_timezone: str = "Asia/Kolkata"
    interests: list[dict] = Field(default_factory=list)
    never_show: list[str] = Field(default_factory=list)
    recent_insight: str | None = None
    onboarding_completed: bool = False
    brief_style: str = "analyst"
    brief_language: str = "en"
    operating_context: OperatingContext = Field(default_factory=OperatingContext)

    model_config = {"from_attributes": True}

    @field_validator("operating_context", mode="before")
    @classmethod
    def _operating_context(cls, value):
        return value or {}


class ProfileUpdate(BaseModel):
    role: str | None = None
    goal: str | None = None
    digest_time: str | None = None
    digest_timezone: str | None = None
    interests: list[str] | None = None       # topic strings → stored as {topic, weight, source}
    never_show: list[str] | None = None      # hard-filter strings
    priority_topics: list[str] | None = None # "what are you most afraid to miss?" → interrupt-worthy
    recent_insight: str | None = None        # a piece of content that changed their thinking
    brief_style: Literal["analyst", "scan", "plain"] | None = None
    brief_language: Literal["en", "hi"] | None = None
    operating_context: dict | None = None    # structured company / founder context


class NeverShowIn(BaseModel):
    topic: str


class OnboardingStatusOut(BaseModel):
    onboarding_completed: bool
    profile_started: bool
    gmail_connected: bool
    gmail_email: str | None = None
    newsletter_count: int | None = None
    youtube_connected: bool = False
    youtube_channel_count: int | None = None
    reddit_connected: bool = False
    reddit_subreddit_count: int | None = None
    calendar_connected: bool = False
    calendar_email: str | None = None
    sources_count: int
    priority_topics: list[str] = []


class OnboardingCompleteOut(BaseModel):
    onboarding_completed: bool


class GmailConnectOut(BaseModel):
    url: str


class GmailStatusOut(BaseModel):
    connected: bool
    email: str | None = None
    newsletter_count: int | None = None
    access_error: str | None = None
    access_error_message: str | None = None


class YouTubeConnectOut(BaseModel):
    url: str


class YouTubeStatusOut(BaseModel):
    connected: bool
    email: str | None = None
    channel_count: int | None = None


class RedditConnectOut(BaseModel):
    url: str


class RedditStatusOut(BaseModel):
    connected: bool
    username: str | None = None
    subreddit_count: int | None = None


class CalendarConnectOut(BaseModel):
    url: str


class CalendarStatusOut(BaseModel):
    connected: bool
    email: str | None = None


class MeOut(BaseModel):
    user: UserOut
    profile: ProfileOut | None
    ingestion_email: str
    onboarding_completed: bool = False
    gmail_connected: bool = False
    youtube_connected: bool = False
    reddit_connected: bool = False
    calendar_connected: bool = False
    reading_streak: int = 0  # consecutive days with a digest
    auto_suggestions: list["AutoSuggestionOut"] = Field(default_factory=list)
    sources_discovery_confirmed: bool = False
    pending_discovery_count: int = 0


class DigestItemOut(BaseModel):
    id: str
    content_id: str | None = None
    position: int
    section: str | None
    headline: str
    summary: str
    why_it_matters: str
    who_it_affects: str | None = None
    suggested_action: str | None = None
    source_name: str | None
    source_url: str | None
    all_sources: list[dict] = Field(default_factory=list)
    memory_connections: list[dict] = Field(default_factory=list)
    was_saved: bool = False
    was_clicked: bool = False
    duplicate_count: int = 1
    # Compounding intelligence fields
    memory_reference: str | None = None
    confidence_signal: str | None = None
    evolution_note: str | None = None
    contradiction_flag: bool = False
    contradiction_explanation: str | None = None
    was_disliked: bool = False
    score_breakdown: dict = Field(default_factory=dict)
    why_this_summary: str | None = None
    detector_type: str | None = None
    evidence: list[dict] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class DigestStatsOut(BaseModel):
    closing_line: str
    dedup_line: str | None = None
    items_ingested: int = 0
    items_shown: int = 0
    source_count: int = 0
    merged_story_count: int = 0
    monthly_time_saved_minutes: int = 0
    monthly_time_saved_label: str = "~0m"
    avg_read_minutes: float = 1.5


class FeedbackOut(BaseModel):
    learned_message: str | None = None


class SerendipityConnectionOut(BaseModel):
    title: str
    body: str
    content_id: str | None = None


class ProactiveEventOut(BaseModel):
    id: str
    event_type: str
    title: str
    body: str
    thread_key: str | None = None
    priority: int = 0
    created_at: str | None = None


class CalendarMeetingOut(BaseModel):
    title: str
    time: str
    day_label: str | None = None
    attendees: list[str] = Field(default_factory=list)


class CalendarUpcomingOut(BaseModel):
    connected: bool
    meetings: list[CalendarMeetingOut] = Field(default_factory=list)
    meeting_count: int = 0
    summary_text: str | None = None


class DigestOut(BaseModel):
    id: str
    digest_date: str
    status: str
    subject_line: str | None
    preview_text: str | None
    total_items_ingested: int
    total_items_shown: int
    created_at: datetime
    items: list[DigestItemOut] = Field(default_factory=list)
    meta: dict = Field(default_factory=dict)  # skipped items, pipeline extras
    stats: DigestStatsOut | None = None

    model_config = {"from_attributes": True}


class GenerateDigestOut(BaseModel):
    status: str = "complete"
    digest: DigestOut | None = None
    warnings: list[str] = Field(default_factory=list)


class BriefingGenerationStatusOut(BaseModel):
    status: str = "idle"
    step: str | None = None
    label: str | None = None
    digest_id: str | None = None
    digest: DigestOut | None = None
    warnings: list[str] = Field(default_factory=list)
    error: str | None = None
    started_at: str | None = None
    updated_at: str | None = None


class YouTubeSyncStatsOut(BaseModel):
    connected: bool = False
    channel_count: int | None = None
    pool_videos_recent: int = 0
    pool_with_transcript: int = 0
    last_sync_items: int = 0
    manual_channel_count: int = 0
    manual_channels: list[dict] = Field(default_factory=list)
    recent_videos: list[dict] = Field(default_factory=list)
    last_fetch: dict | None = None


class IngestionSummaryOut(BaseModel):
    last_ingestion_at: datetime | None = None
    last_summary: dict = Field(default_factory=dict)
    activity_feed: list[dict] = Field(default_factory=list)
    pool_items_recent: int = 0
    youtube: YouTubeSyncStatsOut | None = None


class DigestSummaryOut(BaseModel):
    id: str
    digest_date: str
    status: str
    subject_line: str | None
    preview_text: str | None
    total_items_shown: int
    created_at: datetime

    model_config = {"from_attributes": True}


class SourceOut(BaseModel):
    id: str
    source_type: str
    status: str
    name: str | None
    identifier: str
    last_fetched_at: datetime | None
    created_at: datetime
    priority: str = "normal"

    model_config = {"from_attributes": True}

    @model_validator(mode="before")
    @classmethod
    def _extract_priority(cls, data: object) -> object:
        if not hasattr(data, "meta"):
            return data
        from briefly_api.services.source_priority import normalize_priority

        meta = data.meta or {}
        return {
            "id": data.id,
            "source_type": data.source_type,
            "status": data.status.value if hasattr(data.status, "value") else data.status,
            "name": data.name,
            "identifier": data.identifier,
            "last_fetched_at": data.last_fetched_at,
            "created_at": data.created_at,
            "priority": normalize_priority(meta.get("priority")),
        }


class SourcePriorityIn(BaseModel):
    priority: str = Field(description="high | normal | low")


class SourceCreate(BaseModel):
    identifier: str
    source_type: str | None = None
    name: str | None = None
    meta: dict = Field(default_factory=dict)


class SourceDetectAlternative(BaseModel):
    source_type: str
    label: str
    hint: str


class SourceDetectOut(BaseModel):
    source_type: str
    identifier: str
    label: str
    hint: str
    confidence: str
    alternatives: list[SourceDetectAlternative] = Field(default_factory=list)


class GmailSenderOut(BaseModel):
    email: str
    name: str
    count: int


class GmailDiscoverOut(BaseModel):
    senders: list[GmailSenderOut]


class BulkSourceCreate(BaseModel):
    sources: list[SourceCreate]
    from_gmail: bool = False


class BulkSourceOut(BaseModel):
    added: list[SourceOut]
    skipped: int


class FeedbackIn(BaseModel):
    signal_type: str  # opened | clicked | saved | skipped | tracked | asked | dismissed | acted | decision_changed | ...
    digest_item_id: str | None = None
    digest_id: str | None = None
    meta: dict = Field(default_factory=dict)  # extra context per signal (e.g. read_time_seconds)


class SourceSuggestionOut(BaseModel):
    name: str
    url: str
    source_type: str
    topic: str
    description: str
    # How this source surfaced: "similar" (content match to what you read),
    # "readers_like_you" (collaborative), or "interest" (keyword discovery).
    method: str = "interest"
    reason: str = ""
    score: float = 0.0


class AutoSuggestionOut(BaseModel):
    name: str
    url: str
    source_type: str = "rss"
    topic: str
    description: str
    reason: str = ""
    discovered_at: str | None = None
    source: str = "catalog"  # catalog | medium


class DiscoveryCandidateOut(BaseModel):
    id: str
    name: str
    identifier: str
    source_type: str
    layer: str
    confidence: float
    relevance_score: float
    selected: bool
    reason: str
    meta: dict = Field(default_factory=dict)


class DiscoveryRunOut(BaseModel):
    status: str = "complete"
    candidates: list[DiscoveryCandidateOut]
    connected_accounts: list[str] = Field(default_factory=list)
    meta: dict = Field(default_factory=dict)


class DiscoveryConfirmIn(BaseModel):
    candidate_ids: list[str] = Field(default_factory=list)


class DiscoveryConfirmOut(BaseModel):
    added: list[SourceOut]
    total_sources: int
    confirmed: bool


class DiscoveredArticleOut(BaseModel):
    id: str
    title: str
    url: str
    source_name: str
    summary: str = ""
    published_at: str | None = None
    feed_url: str = ""
    source_type: str = "rss"
    relevance_score: float = 0.0
    discovery_reason: str = ""
    why_relevant: str = ""
    intent_topic: str = ""
    publisher_domain: str = ""


class DiscoveredArticlesOut(BaseModel):
    articles: list[DiscoveredArticleOut]
    refreshed_at: str | None = None
    meta: dict = Field(default_factory=dict)


class ReadwiseConnectIn(BaseModel):
    api_key: str


class BrainDumpTextIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=50_000)


class BrainDumpTranscribeOut(BaseModel):
    text: str


class BrainDumpOut(BaseModel):
    id: str
    title: str
    clean_summary: str
    intent_type: str
    action_items: list[str] = Field(default_factory=list)
    relevance_keywords: list[str] = Field(default_factory=list)
    should_inject_into_morning_brief: bool = False
    tomorrow_brief_preview: str = ""
    raw_transcript: str
    input_mode: str
    created_at: datetime
    injected_at: datetime | None = None
    injected_digest_id: str | None = None


class UrlCaptureIn(BaseModel):
    url: str = Field(..., min_length=8, max_length=2048)
    title: str | None = Field(None, max_length=500)
    note: str | None = Field(None, max_length=2000)


class UrlCaptureFeedbackOut(BaseModel):
    connection_sentence: str | None = None
    thread_key: str | None = None
    thread_label: str | None = None
    thread_item_count: int | None = None
    why_relevant: str | None = None
    briefing_message: str | None = None


class UrlCaptureOut(BaseModel):
    id: str
    title: str
    url: str
    summary: str
    user_note: str | None = None
    created_at: datetime
    already_saved: bool = False
    enrichment_status: Literal["complete", "partial", "pending"] = "pending"
    enrichment: UrlCaptureFeedbackOut = Field(default_factory=UrlCaptureFeedbackOut)


class BrowserCaptureListOut(BaseModel):
    id: str
    title: str
    url: str | None = None
    summary: str
    user_note: str | None = None
    created_at: datetime
    in_briefing: bool = False
    connection_sentence: str | None = None
    thread_label: str | None = None
    why_relevant: str | None = None


class CaptureTokenCreateIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)   # device label
    platform: str | None = Field(None, max_length=32)       # ios | android | extension | shortcut | web


class CaptureTokenOut(BaseModel):
    id: str
    name: str
    token_prefix: str
    platform: str | None = None
    created_at: datetime
    last_used_at: datetime | None = None


class CaptureTokenCreatedOut(CaptureTokenOut):
    token: str   # full plaintext secret — returned only once, at creation


class OrbSpeakIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)
    voice: str | None = None


class OrbProactiveSeenIn(BaseModel):
    event_ids: list[str] = Field(default_factory=list)


class OrbProactiveVoiceOut(BaseModel):
    """Whether the always-on orb should speak up now, and what to say."""
    speak: bool = False
    script: str | None = None
    event_ids: list[str] = Field(default_factory=list)


class OrbProactiveSnoozeIn(BaseModel):
    hours: int = 3


class OrbTurnOut(BaseModel):
    transcript: str
    thread_id: str | None = None
    session_id: str | None = None
    answer: str
    citations: list[dict] = Field(default_factory=list)
    tool_trace: list[dict] = Field(default_factory=list)
    # True when the agent asked something and is waiting on the user — the client
    # re-opens the mic so it's a back-and-forth, not tap-to-talk.
    expects_reply: bool = False
    # Optional concise text for the SCREEN (distinct from the spoken `answer`). Used
    # by the ambient orb so it shows a tidy line, not the whole spoken body.
    display: str | None = None
    timings: dict[str, int] = Field(default_factory=dict)
    route_kind: str | None = None
    route_reason: str | None = None


class OrbSessionIn(BaseModel):
    session_id: str | None = None
    thread_id: str | None = None
    surface: str = "desktop"


class OrbSessionOut(BaseModel):
    session_id: str
    thread_id: str | None = None


class OrbWelcomeOut(BaseModel):
    speak: bool
    script: str | None = None
    open_listen: bool = False
    user_name: str | None = None


class OrbVoiceConfigOut(BaseModel):
    voice: str
    provider: str
    format: str
    enabled: bool
    content_type: str | None = None
    single_request_max_chars: int = 900


class OrbWakeCheckOut(BaseModel):
    transcript: str
    wake: bool


class OrbWakeCheckIn(BaseModel):
    audio_base64: str
    content_type: str = "audio/webm"
    filename: str = "wake.webm"


class OrbTurnJsonIn(BaseModel):
    audio_base64: str | None = None
    text: str | None = None
    thread_id: str | None = None
    session_id: str | None = None
    surface: str = "desktop"
    content_id: str | None = None
    content_type: str = "audio/webm"
    filename: str = "turn.webm"

