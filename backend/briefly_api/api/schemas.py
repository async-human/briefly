from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class UserOut(BaseModel):
    id: str
    email: str
    name: str | None
    avatar_url: str | None
    email_token: str
    is_verified: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class ProfileOut(BaseModel):
    role: str | None = None
    goal: str | None = None
    digest_time: str = "07:00"
    digest_timezone: str = "Asia/Kolkata"
    interests: list[dict] = Field(default_factory=list)
    never_show: list[str] = Field(default_factory=list)
    recent_insight: str | None = None
    onboarding_completed: bool = False

    model_config = {"from_attributes": True}


class ProfileUpdate(BaseModel):
    role: str | None = None
    goal: str | None = None
    digest_time: str | None = None
    digest_timezone: str | None = None
    interests: list[str] | None = None       # topic strings → stored as {topic, weight, source}
    never_show: list[str] | None = None      # hard-filter strings
    recent_insight: str | None = None        # a piece of content that changed their thinking


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
    sources_count: int


class OnboardingCompleteOut(BaseModel):
    onboarding_completed: bool


class GmailConnectOut(BaseModel):
    url: str


class GmailStatusOut(BaseModel):
    connected: bool
    email: str | None = None
    newsletter_count: int | None = None


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


class MeOut(BaseModel):
    user: UserOut
    profile: ProfileOut | None
    ingestion_email: str
    onboarding_completed: bool = False
    gmail_connected: bool = False
    youtube_connected: bool = False
    reddit_connected: bool = False
    reading_streak: int = 0  # consecutive days with a digest
    auto_suggestions: list["AutoSuggestionOut"] = Field(default_factory=list)


class DigestItemOut(BaseModel):
    id: str
    position: int
    section: str | None
    headline: str
    summary: str
    why_it_matters: str
    source_name: str | None
    source_url: str | None
    all_sources: list[dict] = Field(default_factory=list)
    memory_connections: list[dict] = Field(default_factory=list)
    was_saved: bool = False
    was_clicked: bool = False
    duplicate_count: int = 1

    model_config = {"from_attributes": True}


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

    model_config = {"from_attributes": True}


class GenerateDigestOut(BaseModel):
    digest: DigestOut
    warnings: list[str] = Field(default_factory=list)


class IngestionSummaryOut(BaseModel):
    last_ingestion_at: datetime | None = None
    last_summary: dict = Field(default_factory=dict)
    activity_feed: list[dict] = Field(default_factory=list)
    pool_items_recent: int = 0


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

    model_config = {"from_attributes": True}


class SourceCreate(BaseModel):
    identifier: str
    source_type: str | None = None
    name: str | None = None


class SourceDetectOut(BaseModel):
    source_type: str
    identifier: str
    label: str
    hint: str
    confidence: str


class GmailSenderOut(BaseModel):
    email: str
    name: str
    count: int


class GmailDiscoverOut(BaseModel):
    senders: list[GmailSenderOut]


class BulkSourceCreate(BaseModel):
    sources: list[SourceCreate]


class BulkSourceOut(BaseModel):
    added: list[SourceOut]
    skipped: int


class FeedbackIn(BaseModel):
    signal_type: str  # "liked" | "disliked" | "clicked" | "saved"
    digest_item_id: str
    digest_id: str | None = None


class SourceSuggestionOut(BaseModel):
    name: str
    url: str
    source_type: str
    topic: str
    description: str


class AutoSuggestionOut(BaseModel):
    name: str
    url: str
    source_type: str = "rss"
    topic: str
    description: str
    reason: str = ""
    discovered_at: str | None = None
    source: str = "catalog"  # catalog | medium


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
    raw_transcript: str
    input_mode: str
    created_at: datetime
    injected_at: datetime | None = None
    injected_digest_id: str | None = None

