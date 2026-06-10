"""
briefly_api/db/models.py

Complete database schema for Briefly.
Every table designed with the second-brain vision in mind —
memory, signals, and connections are first-class citizens.
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger, Boolean, DateTime, Enum, Float, ForeignKey, Index,
    Integer, String, Text, UniqueConstraint, func, text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def _uuid() -> str:
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    pass


# ── Enums ─────────────────────────────────────────────────────────────────────

class SourceType:
    """String constants — not a DB enum. New connectors need no migration."""
    email = "email"
    rss = "rss"
    youtube = "youtube"
    reddit = "reddit"
    url = "url"
    brain_dump = "brain_dump"
    browser_capture = "browser_capture"

class SourceStatus(str, enum.Enum):
    active   = "active"
    paused   = "paused"
    error    = "error"

class ContentStatus(str, enum.Enum):
    pending   = "pending"
    processed = "processed"
    skipped   = "skipped"
    failed    = "failed"

class DigestStatus(str, enum.Enum):
    generating = "generating"
    ready      = "ready"
    sent       = "sent"
    failed     = "failed"

class SignalType(str, enum.Enum):
    opened         = "opened"
    clicked        = "clicked"
    skipped        = "skipped"
    saved          = "saved"
    disliked       = "disliked"
    followed_up    = "followed_up"
    source_added   = "source_added"
    source_removed = "source_removed"


# ── Users ─────────────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    name: Mapped[str | None] = mapped_column(String(255))
    google_id: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True, index=True)
    avatar_url: Mapped[str | None] = mapped_column(String(512))
    email_token: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)  # for catch-all inbox
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False)

    # Subscription
    plan: Mapped[str] = mapped_column(String(20), default="free")  # free | pro
    is_founding_member: Mapped[bool] = mapped_column(Boolean, default=False)
    ls_customer_id: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    ls_subscription_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    subscribed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    profile: Mapped["UserProfile"] = relationship(back_populates="user", uselist=False, cascade="all, delete-orphan")
    sources: Mapped[list["Source"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    oauth_connections: Mapped[list["OAuthConnection"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    digests: Mapped[list["Digest"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    memory: Mapped[list["UserMemory"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    signals: Mapped[list["BehavioralSignal"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    follow_up_threads: Mapped[list["FollowUpThread"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    activity_events: Mapped[list["UserActivityEvent"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    digest_failures: Mapped[list["DigestFailure"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class UserProfile(Base):
    """
    Rich interest profile built during onboarding and updated by the
    LearningAgent after each digest. This is the core of personalization.
    """
    __tablename__ = "user_profiles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), unique=True)

    # Onboarding answers — captured once, refined over time
    role: Mapped[str | None] = mapped_column(String(255))           # "founder", "PM", "engineer", "investor"
    goal: Mapped[str | None] = mapped_column(Text)                   # What they want to achieve
    expertise_level: Mapped[str | None] = mapped_column(String(50))  # "beginner", "intermediate", "expert"
    recent_insight: Mapped[str | None] = mapped_column(Text)         # Content that changed their thinking recently
    changed_mind_about: Mapped[str | None] = mapped_column(Text)     # Something they used to believe

    # Topic interests — JSONB for flexibility
    # Structure: [{"topic": "AI agents", "weight": 0.9, "source": "declared|inferred"}]
    interests: Mapped[list[dict]] = mapped_column(JSONB, default=list)

    # Never show — hard filters
    # Structure: ["celebrity news", "sports", "crypto price updates"]
    never_show: Mapped[list[str]] = mapped_column(JSONB, default=list)

    # Inferred topic clusters — updated by LearningAgent
    # Structure: [{"cluster": "agentic AI", "strength": 0.85, "first_seen": "2026-01-01", "item_count": 23}]
    topic_clusters: Mapped[list[dict]] = mapped_column(JSONB, default=list)

    # Digest preferences
    digest_time: Mapped[str] = mapped_column(String(5), default="07:00")   # HH:MM local time
    digest_timezone: Mapped[str] = mapped_column(String(50), default="Asia/Kolkata")
    digest_length: Mapped[str] = mapped_column(String(20), default="standard")  # brief|standard|comprehensive
    digest_format: Mapped[str] = mapped_column(String(20), default="sections")  # sections|flat

    onboarding_completed: Mapped[bool] = mapped_column(Boolean, default=False)

    # Learning signals — updated automatically
    avg_open_rate: Mapped[float] = mapped_column(Float, default=0.0)
    avg_click_rate: Mapped[float] = mapped_column(Float, default=0.0)
    total_digests_received: Mapped[int] = mapped_column(Integer, default=0)
    total_follow_ups: Mapped[int] = mapped_column(Integer, default=0)

    # Profile embedding — used for semantic matching
    # Updated when interests change significantly
    profile_embedding: Mapped[list[float] | None] = mapped_column(Vector(1024))
    # When the embedding was last regenerated (triggers every 7 days)
    profile_embedding_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Auto-discovered source suggestions — written by InterestDiscoveryAgent
    # Structure: [{"name": str, "url": str, "source_type": str, "topic": str,
    #              "description": str, "reason": str, "discovered_at": str}]
    suggested_sources: Mapped[list[dict]] = mapped_column(JSONB, nullable=True, default=list, server_default="[]")

    # V1.5 — passive ingestion
    ingest_time: Mapped[str] = mapped_column(String(5), default="03:00")
    auto_expand_sources: Mapped[bool] = mapped_column(Boolean, default=False)
    last_ingestion_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ingestion_meta: Mapped[dict] = mapped_column(JSONB, default=dict)
    source_weights: Mapped[dict] = mapped_column(JSONB, default=dict)
    activity_feed: Mapped[list[dict]] = mapped_column(JSONB, default=list)

    # Dynamic source discovery — confirm-before-add
    pending_source_discoveries: Mapped[list[dict]] = mapped_column(JSONB, default=list)
    sources_discovery_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    discovery_last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    discovery_meta: Mapped[dict] = mapped_column(JSONB, default=dict)

    # Article-level discovery — relevant content from outside user subscriptions
    # Structure: [{id, title, url, source_name, summary, relevance_score, why_relevant, ...}]
    discovered_articles: Mapped[list[dict]] = mapped_column(JSONB, default=list)
    discovered_articles_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user: Mapped["User"] = relationship(back_populates="profile")


class UserActivityEvent(Base):
    """Append-only activity log — replaces unbounded JSONB on UserProfile."""

    __tablename__ = "user_activity_events"
    __table_args__ = (
        Index("ix_user_activity_user_created", "user_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    event_type: Mapped[str] = mapped_column(String(50), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    meta: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship(back_populates="activity_events")


class DigestFailure(Base):
    """Failed scheduled digest — drives retry and user notification."""

    __tablename__ = "digest_failures"
    __table_args__ = (
        Index("ix_digest_failures_pending", "resolved_at", "next_retry_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    digest_date: Mapped[str] = mapped_column(String(10), nullable=False)
    error_message: Mapped[str] = mapped_column(Text, nullable=False)
    retry_count: Mapped[int] = mapped_column(Integer, default=0)
    max_retries: Mapped[int] = mapped_column(Integer, default=3)
    notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_retry_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped["User"] = relationship(back_populates="digest_failures")


# ── Sources ───────────────────────────────────────────────────────────────────

class Source(Base):
    """
    A content source for a user. One row per source per user.
    Ingestion metadata (last_fetched, error_count) lives here.
    """
    __tablename__ = "sources"
    __table_args__ = (
        UniqueConstraint("user_id", "source_type", "identifier", name="uq_source"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    source_type: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[SourceStatus] = mapped_column(Enum(SourceStatus), default=SourceStatus.active)

    # Human-readable name (auto-detected or user-set)
    name: Mapped[str | None] = mapped_column(String(255))

    # Type-specific identifier:
    # email: sender address
    # rss: feed URL
    # youtube: channel URL, @handle, or channel ID
    # reddit: subreddit name (without r/)
    # url: any webpage URL
    identifier: Mapped[str] = mapped_column(String(1024), nullable=False)

    # Ingestion state
    last_fetched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_successful_fetch_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error_count: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str | None] = mapped_column(Text)

    # Source-level metadata (feed title, channel name, subscriber count, etc.)
    meta: Mapped[dict] = mapped_column(JSONB, default=dict)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship(back_populates="sources")
    raw_contents: Mapped[list["RawContent"]] = relationship(back_populates="source", cascade="all, delete-orphan")


# ── OAuth connections (Gmail, etc.) ───────────────────────────────────────────

class OAuthConnection(Base):
    """Stored OAuth tokens for third-party integrations (Gmail inbox, etc.)."""

    __tablename__ = "oauth_connections"
    __table_args__ = (UniqueConstraint("user_id", "provider", name="uq_oauth_provider"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(50), nullable=False)  # gmail
    account_email: Mapped[str | None] = mapped_column(String(255))
    access_token: Mapped[str] = mapped_column(Text, nullable=False)
    refresh_token: Mapped[str | None] = mapped_column(Text)
    token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    scopes: Mapped[str] = mapped_column(String(512), default="")
    meta: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped["User"] = relationship(back_populates="oauth_connections")


# ── Raw Content ───────────────────────────────────────────────────────────────

class RawContent(Base):
    """
    Every ingested item before processing. This is the source of truth
    for all content. Never deleted — forms the long-term memory base.
    """
    __tablename__ = "raw_contents"
    __table_args__ = (
        UniqueConstraint("source_id", "content_hash", name="uq_content"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    source_id: Mapped[str] = mapped_column(String(36), ForeignKey("sources.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[ContentStatus] = mapped_column(Enum(ContentStatus), default=ContentStatus.pending)

    # Content fields
    title: Mapped[str | None] = mapped_column(Text)
    url: Mapped[str | None] = mapped_column(Text)
    author: Mapped[str | None] = mapped_column(String(255))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Raw and cleaned text
    raw_text: Mapped[str | None] = mapped_column(Text)       # as received
    clean_text: Mapped[str | None] = mapped_column(Text)     # after HTML stripping, boilerplate removal
    summary: Mapped[str | None] = mapped_column(Text)        # LLM-generated summary

    # Deduplication
    content_hash: Mapped[str | None] = mapped_column(String(64), index=True)  # SHA256 of clean_text
    canonical_id: Mapped[str | None] = mapped_column(String(36), index=True)  # points to primary item if dupe

    # Scoring
    relevance_score: Mapped[float | None] = mapped_column(Float)
    novelty_score: Mapped[float | None] = mapped_column(Float)
    quality_score: Mapped[float | None] = mapped_column(Float)

    # Extra metadata (video duration, reddit score, email sender, etc.)
    meta: Mapped[dict] = mapped_column(JSONB, default=dict)

    source: Mapped["Source"] = relationship(back_populates="raw_contents")
    embedding: Mapped["ContentEmbedding | None"] = relationship(back_populates="content", uselist=False, cascade="all, delete-orphan")


class ContentEmbedding(Base):
    __tablename__ = "content_embeddings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    content_id: Mapped[str] = mapped_column(String(36), ForeignKey("raw_contents.id", ondelete="CASCADE"), unique=True)
    embedding: Mapped[list[float]] = mapped_column(Vector(1024), nullable=False)
    model: Mapped[str] = mapped_column(String(100), nullable=False)  # which model generated this
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    content: Mapped["RawContent"] = relationship(back_populates="embedding")


# ── Digests ───────────────────────────────────────────────────────────────────

class Digest(Base):
    """
    One digest per user per day. Contains the full rendered output
    plus all metadata needed for the memory and learning layers.
    """
    __tablename__ = "digests"
    __table_args__ = (
        UniqueConstraint("user_id", "digest_date", name="uq_digest_date"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[DigestStatus] = mapped_column(Enum(DigestStatus), default=DigestStatus.generating)
    digest_date: Mapped[str] = mapped_column(String(10), nullable=False)  # YYYY-MM-DD

    # Rendered content
    subject_line: Mapped[str | None] = mapped_column(Text)
    preview_text: Mapped[str | None] = mapped_column(Text)   # email preview snippet
    html_body: Mapped[str | None] = mapped_column(Text)      # full HTML email
    web_body: Mapped[str | None] = mapped_column(Text)       # web app rendered version

    # Pipeline metadata
    total_items_ingested: Mapped[int] = mapped_column(Integer, default=0)
    total_items_scored: Mapped[int] = mapped_column(Integer, default=0)
    total_items_shown: Mapped[int] = mapped_column(Integer, default=0)
    sources_included: Mapped[list[str]] = mapped_column(JSONB, default=list)  # source IDs
    pipeline_duration_ms: Mapped[int | None] = mapped_column(Integer)
    meta: Mapped[dict] = mapped_column(JSONB, default=dict)  # skipped items, pipeline extras

    # Delivery
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resend_message_id: Mapped[str | None] = mapped_column(String(255))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship(back_populates="digests")
    items: Mapped[list["DigestItem"]] = relationship(back_populates="digest", cascade="all, delete-orphan", order_by="DigestItem.position")


class DigestItem(Base):
    """
    One item within a digest. Stores everything needed to render
    the item and to learn from user interaction with it.
    """
    __tablename__ = "digest_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    digest_id: Mapped[str] = mapped_column(String(36), ForeignKey("digests.id", ondelete="CASCADE"), index=True)
    content_id: Mapped[str] = mapped_column(String(36), ForeignKey("raw_contents.id", ondelete="SET NULL"), nullable=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False)  # order within digest

    # Section (e.g. "AI & Product", "India Startup", "Must Read")
    section: Mapped[str | None] = mapped_column(String(100))

    # Rendered fields — what the user actually sees
    headline: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    why_it_matters: Mapped[str] = mapped_column(Text, nullable=False)  # personalised "why this matters to YOU"
    source_name: Mapped[str | None] = mapped_column(String(255))
    source_url: Mapped[str | None] = mapped_column(Text)

    # Cross-source dedup metadata
    # If multiple sources covered this story, all are listed here
    all_sources: Mapped[list[dict]] = mapped_column(JSONB, default=list)  # [{"name": ..., "url": ...}]
    duplicate_count: Mapped[int] = mapped_column(Integer, default=1)

    # Memory connections — links to past digest items or themes
    # [{"type": "update_to", "digest_id": ..., "item_id": ..., "description": "Update to Monday's story on X"}]
    memory_connections: Mapped[list[dict]] = mapped_column(JSONB, default=list)

    # Scoring
    relevance_score: Mapped[float | None] = mapped_column(Float)
    novelty_score: Mapped[float | None] = mapped_column(Float)

    # Compounding intelligence fields — written by BriefingWriterAgent
    memory_reference: Mapped[str | None] = mapped_column(Text)    # "You've been tracking this for 6 weeks..."
    confidence_signal: Mapped[str | None] = mapped_column(Text)   # "94% match to your top interest cluster"
    evolution_note: Mapped[str | None] = mapped_column(Text)      # surfaces behavior diverging from stated interests

    # User interaction (updated by LearningAgent)
    was_clicked: Mapped[bool] = mapped_column(Boolean, default=False)
    was_saved: Mapped[bool] = mapped_column(Boolean, default=False)
    was_disliked: Mapped[bool] = mapped_column(Boolean, default=False)
    had_follow_up: Mapped[bool] = mapped_column(Boolean, default=False)
    follow_up_depth: Mapped[int] = mapped_column(Integer, default=0)  # count of follow-up turns on this item

    digest: Mapped["Digest"] = relationship(back_populates="items")


# ── Memory ────────────────────────────────────────────────────────────────────

class UserMemory(Base):
    """
    Persistent memory layer — what the user has been exposed to,
    what themes keep appearing, what topics are trending for them.
    This is what makes the digest feel like a second brain over time.
    """
    __tablename__ = "user_memory"
    __table_args__ = (
        Index("ix_user_memory_user_type", "user_id", "memory_type"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    memory_type: Mapped[str] = mapped_column(String(50), nullable=False)
    # Types:
    # "seen_story"    — user was shown this story (content_hash → seen)
    # "topic_trend"   — a topic the user keeps seeing (topic + frequency)
    # "story_thread"  — an ongoing story with multiple updates
    # "interest_signal" — inferred interest from behavior

    key: Mapped[str] = mapped_column(String(512), nullable=False, index=True)   # content_hash, topic name, etc.
    value: Mapped[dict] = mapped_column(JSONB, default=dict)   # flexible payload per type
    strength: Mapped[float] = mapped_column(Float, default=1.0)  # decays over time for old memories
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    occurrence_count: Mapped[int] = mapped_column(Integer, default=1)

    user: Mapped["User"] = relationship(back_populates="memory")


# ── Behavioral Signals ────────────────────────────────────────────────────────

class BehavioralSignal(Base):
    """
    Every interaction a user has with their digest.
    Feeds the LearningAgent to improve relevance over time.
    """
    __tablename__ = "behavioral_signals"
    __table_args__ = (
        Index("ix_behavioral_signals_user_created", "user_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    signal_type: Mapped[SignalType] = mapped_column(Enum(SignalType), nullable=False)
    digest_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("digests.id", ondelete="SET NULL"))
    digest_item_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("digest_items.id", ondelete="SET NULL"))
    source_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("sources.id", ondelete="SET NULL"))
    meta: Mapped[dict] = mapped_column(JSONB, default=dict)  # extra context per signal type
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship(back_populates="signals")


# ── Follow-up Threads ─────────────────────────────────────────────────────────

class FollowUpThread(Base):
    """
    Conversational follow-up sessions. User asks questions about
    digest items or their knowledge base. Each session is stored
    for memory and learning purposes.
    """
    __tablename__ = "follow_up_threads"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    digest_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("digests.id", ondelete="SET NULL"))
    digest_item_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("digest_items.id", ondelete="SET NULL"))

    # Full conversation history as JSONB
    # [{"role": "user"|"assistant", "content": "...", "timestamp": "..."}]
    messages: Mapped[list[dict]] = mapped_column(JSONB, default=list)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user: Mapped["User"] = relationship(back_populates="follow_up_threads")


# ── Content Enrichment Cache ──────────────────────────────────────────────────

class ContentEnrichmentCache(Base):
    """
    Pre-computed enrichment for each RawContent item per user.

    Built continuously by ContextBuilderAgent (runs every 2 hours) so that by
    7 am, every item in the digest pool already has memory connections,
    contradiction flags, and narrative hooks computed.  The BriefingWriterAgent
    reads from here instead of computing from scratch under time pressure.
    """
    __tablename__ = "content_enrichment_cache"
    __table_args__ = (
        UniqueConstraint("content_id", "user_id", name="uq_enrichment_cache"),
        Index("ix_enrichment_cache_user_staleness", "user_id", "enriched_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    content_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("raw_contents.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )

    # Connection analysis (ConnectionSkill)
    why_relevant: Mapped[str | None] = mapped_column(Text)
    # e.g. "matches your 6-week AI-reliability thread"
    memory_connections: Mapped[list[dict]] = mapped_column(JSONB, default=list)
    thread_update: Mapped[str | None] = mapped_column(Text)
    # e.g. "3rd update to the GPT-5 story"
    thread_key: Mapped[str | None] = mapped_column(String(255))
    connection_strength: Mapped[float] = mapped_column(Float, default=0.0)  # 0-1

    # Contradiction detection (ContradictionSkill)
    contradiction_flag: Mapped[bool] = mapped_column(Boolean, default=False)
    contradiction_explanation: Mapped[str | None] = mapped_column(Text)
    contradicts_item_id: Mapped[str | None] = mapped_column(String(36))

    # Breaking development flag (set by ContentWatcherAgent)
    is_breaking_development: Mapped[bool] = mapped_column(Boolean, default=False)
    breaking_topic: Mapped[str | None] = mapped_column(String(255))

    # Narrative pre-computation (NarrativeSkill — fast path for writer)
    user_angle: Mapped[str | None] = mapped_column(Text)
    # the specific angle that matters for this user's role/goal
    opening_hook: Mapped[str | None] = mapped_column(Text)
    # best opening sentence for this user
    connection_sentence: Mapped[str | None] = mapped_column(Text)
    # how to link this item to the user's past reading

    # Housekeeping
    enriched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    enrichment_version: Mapped[int] = mapped_column(Integer, default=1)


# ── Behavioral Fingerprint ────────────────────────────────────────────────────

class BehavioralFingerprint(Base):
    """
    A computed behavioral fingerprint per user rebuilt every 6 hours by
    SignalMonitorAgent.  Contains derived engagement patterns that go beyond
    raw signals — topics the user actually reads deeply vs. topics they declared
    but ignore, reading-time patterns, coverage gaps, and mind shifts.

    BriefingWriterAgent injects this as a second context layer alongside the
    static onboarding profile so the writer prompt reflects who the user IS
    (demonstrated behaviour) rather than who they said they were (onboarding).
    """
    __tablename__ = "behavioral_fingerprints"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), unique=True
    )

    # Topics the user engages deeply with (follow-up depth ≥ 2, or saved)
    # [{"topic": "LLM infrastructure", "follow_up_count": 12, "avg_depth": 3.2}]
    high_engagement_topics: Mapped[list[dict]] = mapped_column(JSONB, default=list)

    # Declared topics the user consistently ignores (skip rate > 70 %)
    # [{"topic": "crypto", "declared": True, "actual_clicks": 0, "skip_count": 8}]
    low_engagement_topics: Mapped[list[dict]] = mapped_column(JSONB, default=list)

    # 0 = quick scanner, 1 = deep reader (derived from avg follow_up_depth)
    depth_preference_score: Mapped[float] = mapped_column(Float, default=0.5)

    # {"peak_hour_utc": 8, "avg_items_read": 6.2, "preferred_length": "standard"}
    reading_time_pattern: Mapped[dict] = mapped_column(JSONB, default=dict)

    # Tracked interests that had < 2 items in last 5 days
    # ["Indian startup exits", "AI agent reliability"]
    coverage_gaps: Mapped[list[str]] = mapped_column(JSONB, default=list)

    # Topics where engagement direction changed in last 2 weeks vs prior 2 weeks
    # [{"topic": "crypto", "direction": "declining", "evidence": "was clicking 2mo ago, now ignoring"}]
    mind_shifts: Mapped[list[dict]] = mapped_column(JSONB, default=list)

    # Inferred current focus derived from last 7 days of deep engagements
    current_focus: Mapped[str | None] = mapped_column(Text)
    # e.g. "LLM infrastructure and AI reliability"

    total_signals_analyzed: Mapped[int] = mapped_column(Integer, default=0)

    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


# ── Breaking Development Events ───────────────────────────────────────────────

class BreakingDevelopmentEvent(Base):
    """
    Detected when 3+ content items on the same topic arrive from distinct
    sources within a 6-hour window.  ContentWatcherAgent writes these rows;
    ProactiveSurfacingAgent reads them and queues notifications.
    """
    __tablename__ = "breaking_development_events"
    __table_args__ = (
        Index("ix_breaking_dev_user_topic", "user_id", "topic"),
        Index("ix_breaking_dev_unnotified", "user_id", "notified_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    topic: Mapped[str] = mapped_column(String(255), nullable=False)
    content_ids: Mapped[list[str]] = mapped_column(JSONB, default=list)
    source_count: Mapped[int] = mapped_column(Integer, default=3)
    detected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# ── Source Fetch Patterns ─────────────────────────────────────────────────────

class SourceFetchPattern(Base):
    """
    Learned optimal fetch timing per source.  ContentWatcherAgent updates
    `content_arrival_pattern` every cycle; the scheduler uses `best_fetch_hour`
    to fetch each source right after its content typically publishes rather than
    at a fixed 03:00.
    """
    __tablename__ = "source_fetch_patterns"
    __table_args__ = (
        UniqueConstraint("source_id", name="uq_source_fetch_pattern"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    source_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("sources.id", ondelete="CASCADE"), unique=True
    )

    # UTC hour (0-23) when this source most reliably has new content
    best_fetch_hour: Mapped[int | None] = mapped_column(Integer)

    # {"hourly_distribution": [0,0,5,12,...], "peak_hours": [8,9,17], "samples": 30}
    content_arrival_pattern: Mapped[dict] = mapped_column(JSONB, default=dict)

    last_content_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    pattern_confidence: Mapped[float] = mapped_column(Float, default=0.0)  # 0–1

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


# ── Proactive Surfacing Events ─────────────────────────────────────────────────

class ProactiveSurfacingEvent(Base):
    """
    Queue of proactive notifications assembled by ProactiveSurfacingAgent.
    Events are created on triggers (thread update, breaking development, voice-
    note connection, contradiction) and consumed at digest-compose time or via
    a push-notification pathway.

    event_type values:
      "thread_update"       — a tracked story thread has a significant update
      "breaking_development"— 3+ sources covered the same topic in 6 h
      "voice_note_connection"— a brain-dump connects to external content found
      "contradiction"       — new item contradicts something shown last 30 days
      "coverage_gap_alert"  — tracked topic has had no content for 5 days
    """
    __tablename__ = "proactive_surfacing_events"
    __table_args__ = (
        Index("ix_proactive_user_unsurfaced", "user_id", "surfaced_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )

    event_type: Mapped[str] = mapped_column(String(50), nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)

    content_ids: Mapped[list[str]] = mapped_column(JSONB, default=list)
    thread_key: Mapped[str | None] = mapped_column(String(255))
    priority: Mapped[int] = mapped_column(Integer, default=5)  # 1=low … 10=urgent

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    surfaced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    dismissed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# ── Magic Links ───────────────────────────────────────────────────────────────

class MagicLink(Base):
    __tablename__ = "magic_links"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"))
    token: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
