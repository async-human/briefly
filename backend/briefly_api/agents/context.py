"""
briefly_api/agents/context.py

The PipelineContext is the single shared object passed through
every agent in the pipeline. Agents read from it and write to it.
No agent calls another agent directly — they only modify context.

This makes the pipeline:
  - Testable (mock any context state)
  - Skippable (any agent can be skipped via config)
  - Debuggable (full state visible at any point)
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from briefly_api.db.models import Source


@dataclass
class RawItem:
    """A single piece of ingested content before processing."""
    id: str
    source_id: str
    source_type: str      # email | rss | youtube | reddit
    source_name: str
    title: str
    url: str | None
    author: str | None
    published_at: datetime | None
    clean_text: str
    content_hash: str
    meta: dict = field(default_factory=dict)

    # Set by processing agents
    summary: str = ""
    embedding: list[float] | None = None
    relevance_score: float = 0.0
    novelty_score: float = 1.0
    quality_score: float = 0.5
    is_duplicate: bool = False
    canonical_id: str | None = None     # ID of primary item if this is a dupe
    duplicate_sources: list[dict] = field(default_factory=list)  # other sources that covered this
    drop_reason: str = ""               # "never_show" | "low_relevance" | "crowded_out"


@dataclass
class DigestItemDraft:
    """A digest item being constructed by the BriefingWriterAgent."""
    content_id: str | None
    position: int
    section: str
    headline: str
    summary: str
    why_it_matters: str    # THE most important field — personalised to user
    source_name: str
    source_url: str | None
    all_sources: list[dict] = field(default_factory=list)
    duplicate_count: int = 1
    memory_connections: list[dict] = field(default_factory=list)
    relevance_score: float = 0.0
    novelty_score: float = 0.0
    # Compounding intelligence fields — populated by BriefingWriterAgent
    memory_reference: str = ""    # explicit past-reading connection ("You've been following this for 6 weeks...")
    confidence_signal: str = ""   # how strongly Briefly knows this matches the user ("94% match to top cluster")
    evolution_note: str = ""      # surfaces when behavior diverges from stated interests
    contradiction_flag: bool = False
    contradiction_explanation: str = ""


@dataclass
class UserContext:
    """Everything known about the user at pipeline run time."""
    user_id: str
    email: str
    name: str | None
    profile: dict          # full UserProfile as dict
    recent_digest_items: list[dict]  # last 7 days of digest items (for memory)
    seen_content_hashes: set[str]    # all content hashes shown in last 30 days
    active_story_threads: list[dict] # ongoing stories being tracked
    topic_clusters: list[dict]       # inferred topic interests with weights
    sources: list[Any] = field(default_factory=list)  # active Source ORM objects
    plan: str = "free"
    is_pro: bool = False


@dataclass
class PipelineContext:
    """
    Shared state for the entire pipeline run.
    Passed through every agent. Each agent reads and writes to this.
    """
    # Who we're generating for
    user: UserContext
    run_date: str          # YYYY-MM-DD
    run_started_at: datetime = field(default_factory=datetime.utcnow)
    force_refresh: bool = False  # manual refresh — fetch sources live, relax filters

    # Stage 1: Raw ingested content (populated by SourceCollectorAgent)
    raw_items: list[RawItem] = field(default_factory=list)
    ingestion_errors: list[dict] = field(default_factory=list)

    # Stage 2: After cleaning (populated by ContentCleanerAgent)
    cleaned_items: list[RawItem] = field(default_factory=list)

    # Stage 3: After deduplication (populated by DeduplicationAgent)
    deduplicated_items: list[RawItem] = field(default_factory=list)
    duplicate_groups: list[list[str]] = field(default_factory=list)  # groups of duplicate item IDs

    # Stage 4: After relevance scoring (populated by RelevanceAgent)
    scored_items: list[RawItem] = field(default_factory=list)
    dropped_items: list[RawItem] = field(default_factory=list)  # below threshold

    # Stage 5: After novelty + memory (populated by NoveltyAgent + MemoryAgent)
    enriched_items: list[RawItem] = field(default_factory=list)
    memory_connections: dict[str, list[dict]] = field(default_factory=dict)  # item_id → connections

    # Stage 6: Planned digest (populated by BriefingPlannerAgent)
    planned_sections: list[dict] = field(default_factory=list)  # [{"name": ..., "item_ids": [...]}]
    selected_item_ids: list[str] = field(default_factory=list)
    crowded_out_items: list[RawItem] = field(default_factory=list)  # passed relevance but cut by planner

    # Stage 7: Written digest (populated by BriefingWriterAgent)
    digest_items: list[DigestItemDraft] = field(default_factory=list)
    subject_line: str = ""
    preview_text: str = ""

    # Stage 8: Verified + rendered (populated by CitationVerifierAgent + DeliveryAgent)
    html_body: str = ""
    web_body: str = ""
    verification_warnings: list[str] = field(default_factory=list)

    # Stage 8b: Audio (populated by AudioAgent — optional)
    audio_url: str | None = None

    # Pipeline metadata
    total_ingested: int = 0
    total_after_dedup: int = 0
    total_after_relevance: int = 0
    total_shown: int = 0
    pipeline_errors: list[dict] = field(default_factory=list)

    # ── Proactive intelligence layer (populated by pipeline before writer) ────
    # Pre-computed enrichment from ContentEnrichmentCache, keyed by content_id.
    # Each dict mirrors the ContentEnrichmentCache row fields:
    #   why_relevant, connection_sentence, thread_update, thread_key,
    #   contradiction_flag, contradiction_explanation, user_angle
    enrichment_cache: dict[str, dict] = field(default_factory=dict)

    # Behavioral fingerprint text block (from BehavioralFingerprint table).
    # Injected into the writer prompt's cached prefix so the LLM knows the
    # user's demonstrated behavior, not just their onboarding answers.
    behavioral_fingerprint_text: str = ""

    # Pending proactive surfacing events (from ProactiveSurfacingEvent table).
    # The writer uses these to know which threads/topics to elevate.
    proactive_events: list[dict] = field(default_factory=list)

    # Cross-domain connections surfaced weekly / in digest meta
    serendipity_connections: list[dict] = field(default_factory=list)

    # Shared DB session — set by pipeline orchestrator, used by agents that need DB
    db_session: Any | None = field(default=None, repr=False)

    def log_error(self, agent: str, error: str, item_id: str | None = None) -> None:
        self.pipeline_errors.append({
            "agent": agent,
            "error": error,
            "item_id": item_id,
            "timestamp": datetime.utcnow().isoformat(),
        })

    @property
    def has_enough_items(self) -> bool:
        return len(self.scored_items) >= 3

    @property
    def pipeline_duration_ms(self) -> int:
        delta = datetime.utcnow() - self.run_started_at
        return int(delta.total_seconds() * 1000)
