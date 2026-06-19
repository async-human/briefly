"""
briefly_api/config.py

All configuration from environment variables.
LLM provider, model, and embedding provider are fully swappable
by changing .env — zero code changes required.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_VALID_AUDIO_VOICES = frozenset({*(f"M{i}" for i in range(1, 6)), *(f"F{i}" for i in range(1, 6))})


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── App ──────────────────────────────────────────────────────────────────
    app_name: str = "Briefly"
    app_env: Literal["development", "staging", "production"] = "development"
    secret_key: str = "change-me-in-production"
    frontend_url: str = "http://localhost:3000"
    backend_url: str = "http://localhost:8000"
    cors_origins: str = "http://localhost:3000"

    # ── Database ─────────────────────────────────────────────────────────────
    database_url: str = "postgresql+asyncpg://briefly:briefly@localhost:5432/briefly"
    # Connection pool — keep pool_size + max_overflow below your Postgres
    # max_connections budget across ALL processes (web + worker).
    db_pool_size: int = 10
    db_max_overflow: int = 15

    # ── Redis ────────────────────────────────────────────────────────────────
    redis_url: str = "redis://localhost:6379/0"

    # ── Process layout ───────────────────────────────────────────────────────
    # web = API only | worker = scheduler + jobs + enrichment | all = dev default
    process_role: Literal["web", "worker", "all"] = Field(
        default="all",
        validation_alias=AliasChoices("process_role", "briefly_process_role"),
    )
    background_job_poll_seconds: int = 10
    # Max simultaneous per-user pipeline/ingestion runs in the scheduler.
    # Each digest run holds DB connections and makes several LLM calls, so
    # this must stay well below db_pool_size.
    scheduler_max_concurrent_digests: int = 3
    scheduler_max_concurrent_ingestions: int = 4

    # ── API rate limits (Redis-backed, per user per hour) ────────────────────
    rate_limit_enabled: bool = True
    rate_limit_ask_per_hour: int = 60
    rate_limit_ask_stream_per_hour: int = 60
    rate_limit_transcribe_preview_per_hour: int = 30
    rate_limit_digest_generate_per_hour: int = 6

    # ── LLM — fully agnostic ─────────────────────────────────────────────────
    # Swap provider + model from .env with zero code changes
    llm_provider: Literal["anthropic", "openai", "groq"] = "openai"
    llm_model: str = "gpt-4o-mini"
    llm_temperature: float = 0.3
    llm_max_tokens: int = 4096

    # Provider API keys — only the active provider's key is required
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    groq_api_key: str = ""

    # ── Speech-to-text — fully agnostic ───────────────────────────────────────
    # SPEECH_TO_TEXT_PROVIDER (alias: STT_PROVIDER): openai | deepgram | groq | openai_compatible
    # openai            → STT_MODEL=gpt-4o-transcribe (OPENAI_API_KEY)
    # deepgram          → STT_MODEL=nova-2 or nova-3 (DEEPGRAM_API_KEY)
    # groq              → STT_MODEL=whisper-large-v3 (GROQ_API_KEY)
    # openai_compatible → self-hosted SOTA open models via an OpenAI-compatible
    #                     /v1/audio/transcriptions server (faster-whisper-server,
    #                     Speaches, Parakeet). Set STT_BASE_URL; STT_MODEL is the
    #                     server's model id (e.g. "Systran/faster-whisper-large-v3").
    # local             → run faster-whisper IN-PROCESS (no Docker, no server).
    #                     STT_MODEL is the model id (e.g. "large-v3", "distil-large-v3").
    speech_to_text_provider: Literal["openai", "deepgram", "groq", "openai_compatible", "local"] = Field(
        default="openai",
        validation_alias=AliasChoices("speech_to_text_provider", "stt_provider"),
    )
    stt_model: str = "gpt-4o-transcribe"
    # Base URL for openai_compatible STT (e.g. http://localhost:8000/v1). Empty = OpenAI cloud.
    stt_base_url: str = ""
    stt_api_key: str = ""  # optional; many self-hosted servers accept any/none
    # For provider=local (faster-whisper in-process):
    stt_device: str = "cpu"           # cpu | cuda
    stt_compute_type: str = "int8"    # int8 (CPU) | float16 (GPU) | int8_float16
    deepgram_api_key: str = ""

    # ── Embeddings — fully agnostic ───────────────────────────────────────────
    embedding_provider: Literal["voyage", "openai"] = "voyage"
    embedding_model: str = "voyage-3"
    embedding_dim: int = 1024  # voyage-3=1024, text-embedding-3-small=1536

    voyage_api_key: str = ""

    # ── Email ingestion ───────────────────────────────────────────────────────
    # Each user gets a unique address: {token}@{email_ingestion_domain}
    email_ingestion_domain: str = "mail.briefly.app"
    # webhook = Resend inbound (production) | smtp = local dev server | both
    inbound_email_mode: Literal["webhook", "smtp", "both"] = "webhook"
    smtp_ingestion_enabled: bool = False
    smtp_host: str = "0.0.0.0"
    smtp_port: int = 2525
    resend_inbound_webhook_secret: str = ""

    # ── Email delivery (Resend) ───────────────────────────────────────────────
    resend_api_key: str = ""
    digest_from_email: str = "digest@briefly.app"
    digest_from_name: str = "Briefly"

    # ── Web search (optional, explicit fallback — see PRODUCT.md) ─────────────
    # The assistant answers from the user's own sources by default; this backstops
    # explicit "search the web" requests only. Off unless enabled + key are set.
    web_search_enabled: bool = False
    web_search_provider: Literal["tavily", "brave"] = "tavily"
    web_search_api_key: str = ""
    web_search_max_results: int = 5

    # ── YouTube ───────────────────────────────────────────────────────────────
    youtube_api_key: str = ""

    # ── Reddit ────────────────────────────────────────────────────────────────
    reddit_client_id: str = ""
    reddit_client_secret: str = ""
    reddit_user_agent: str = "briefly-digest/1.0"

    # ── Pipeline config ───────────────────────────────────────────────────────
    # Heuristic: minutes to read one filtered item (closing stats card; labeled est.)
    avg_read_minutes: float = 1.5
    # Relevance: items below this score are dropped from digest pool
    relevance_threshold: float = 0.55
    # Dedup: items with cosine similarity above this are merged
    dedup_similarity_threshold: float = 0.82
    # Digest: target number of items per digest
    digest_target_items: int = 10
    digest_min_items: int = 5
    digest_max_items: int = 14
    # Quality gate: if scored pool has fewer than this, relax relevance filter
    quality_gate_min_pool: int = 8
    # Dual-pool planner: minimum relevance to rescue an older item into the briefing
    relevance_rescue_threshold: float = 0.80
    # Dual-pool planner: don't rescue items older than this many days
    relevance_rescue_max_age_days: int = 14
    # Pool A (What's new): skip newest-from-source if below this relevance
    freshness_min_relevance: float = 0.40
    # Medium digest: drop expanded articles older than this (days)
    medium_max_article_age_days: int = 21
    # Medium digest: min cosine similarity (title vs profile) to include a recommendation
    medium_min_profile_similarity: float = 0.52
    # V1.5 — pre-ingested content pool
    use_preingested_pool: bool = True
    pool_max_age_hours: int = 48
    min_pool_items_before_live_fetch: int = 6
    default_ingest_time: str = "03:00"
    # On manual generate, run a quick ingest if pool is stale (hours)
    live_fetch_if_pool_older_hours: int = 4

    # ── Auth ─────────────────────────────────────────────────────────────────
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 60 * 24 * 7  # 7 days
    magic_link_expire_minutes: int = 15
    google_client_id: str = ""
    google_client_secret: str = ""

    @property
    def stt_provider(self) -> Literal["openai", "deepgram", "groq"]:
        """Backward-compatible alias for speech_to_text_provider."""
        return self.speech_to_text_provider

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def google_redirect_uri(self) -> str:
        return f"{self.backend_url.rstrip('/')}/api/v1/auth/google/callback"

    @property
    def gmail_redirect_uri(self) -> str:
        return f"{self.backend_url.rstrip('/')}/api/v1/auth/gmail/callback"

    @property
    def youtube_redirect_uri(self) -> str:
        """YouTube OAuth completes via the Gmail callback (already in GCP)."""
        return self.gmail_redirect_uri

    @property
    def reddit_redirect_uri(self) -> str:
        return f"{self.backend_url.rstrip('/')}/api/v1/auth/reddit/callback"

    @property
    def calendar_redirect_uri(self) -> str:
        """Calendar OAuth completes via the Gmail callback (already in GCP)."""
        return self.gmail_redirect_uri

    gmail_scopes: str = (
        "https://www.googleapis.com/auth/gmail.readonly "
        "https://www.googleapis.com/auth/gmail.send openid email"
    )
    calendar_scopes: str = (
        "https://www.googleapis.com/auth/calendar.readonly openid email"
    )

    # ── Continuous enrichment worker ──────────────────────────────────────────
    # Runs every N hours; pre-computes memory connections + contradiction flags
    # for all new pool items so the morning pipeline is just assembly.
    enrichment_worker_enabled: bool = True
    enrichment_worker_interval_hours: int = 2
    # Max items to enrich per user per run (guards against runaway LLM costs)
    enrichment_max_items_per_run: int = 50
    # Min cosine similarity to the user's active threads to declare a connection
    enrichment_connection_min_similarity: float = 0.65
    # Min cosine similarity between new item and recent items to check for contradiction
    enrichment_contradiction_min_similarity: float = 0.70

    # ── Content watcher ───────────────────────────────────────────────────────
    # Runs every N hours; detects new pool items and breaking developments
    content_watcher_enabled: bool = True
    content_watcher_interval_hours: int = 4
    # How many distinct sources covering the same topic within the window
    # constitutes a "breaking development"
    breaking_development_min_sources: int = 3
    breaking_development_window_hours: int = 6

    # ── Signal monitor ────────────────────────────────────────────────────────
    # Rebuild the behavioral fingerprint every N hours (or after high-intent signal)
    signal_monitor_enabled: bool = True
    behavioral_fingerprint_refresh_hours: int = 6

    # ── Story thread agent ────────────────────────────────────────────────────
    # Runs nightly; uses longer lookback than the in-pipeline MemoryAgent
    story_thread_agent_enabled: bool = True
    story_thread_agent_lookback_days: int = 30
    # Topics that appear in N+ distinct digest-dates become story threads
    story_thread_min_appearances: int = 3
    # A topic with zero content for this many days triggers a coverage_gap_alert
    coverage_gap_alert_days: int = 5

    # ── Proactive surfacing ───────────────────────────────────────────────────
    proactive_surfacing_enabled: bool = True
    # Cap proactive events per user per day to avoid notification fatigue
    proactive_max_per_user_per_day: int = 2
    # Min discovery relevance score for a "relevant_content" proactive alert
    relevant_content_min_score: float = 0.65

    # ── Intraday freshness ────────────────────────────────────────────────────
    # Re-ingest sources + re-run discovery through the day so watched entities /
    # relevant content surface intraday (not just at the nightly run). Cost scales
    # with users × frequency — tune or disable if margins tighten.
    intraday_refresh_enabled: bool = True
    intraday_refresh_hours: int = 4

    # ── Web push (VAPID) ──────────────────────────────────────────────────────
    web_push_enabled: bool = True
    vapid_public_key: str = ""
    vapid_private_key: str = ""
    vapid_subject: str = "mailto:notifications@briefly.app"
    # Min proactive priority that triggers a real-time push (digest still gets all)
    push_min_priority: int = 6

    # ── Context-aware push gating ─────────────────────────────────────────────
    # Priority >= this always interrupts, ignoring quiet hours / meetings.
    push_always_priority: int = 9
    # Local quiet-hours window (24h). Non-urgent pushes are held to the orb inbox.
    quiet_hours_start: int = 22
    quiet_hours_end: int = 7
    # Hold non-urgent pushes while the user is in a calendar meeting.
    push_respect_calendar_busy: bool = True

    # ── Weekly intelligence skill ─────────────────────────────────────────────
    weekly_intelligence_enabled: bool = True
    # ISO weekday: 0=Monday … 6=Sunday (run on this day)
    weekly_intelligence_weekday: int = 0
    # UTC hour to run the weekly analysis
    weekly_intelligence_hour: int = 2

    # ── Weekly report email ───────────────────────────────────────────────────
    weekly_report_email_enabled: bool = True
    weekly_report_email_time: str = "08:00"  # local Sunday

    # ── Writer model tiering ──────────────────────────────────────────────────
    pro_writer_model: str = "gpt-4o"

    # ── Lemon Squeezy (legacy) ────────────────────────────────────────────────
    lemon_squeezy_webhook_secret: str = ""
    ls_founding_variant_id: str = ""
    ls_pro_variant_id: str = ""
    founding_member_cap: int = 200

    # ── Dodo Payments ─────────────────────────────────────────────────────────
    dodo_payments_api_key: str = ""
    dodo_payments_webhook_key: str = Field(
        default="",
        validation_alias=AliasChoices(
            "dodo_payments_webhook_key",
            "dodo_webhook_secret",
            "DODO_WEBHOOK_SECRET",
        ),
    )
    dodo_payments_env: Literal["test_mode", "live_mode"] = "test_mode"
    dodo_pro_monthly_product_id: str = ""
    dodo_pro_yearly_product_id: str = ""

    # ── Audio (TTS) ───────────────────────────────────────────────────────────
    audio_enabled: bool = False
    audio_storage_path: str = "/tmp/briefly_audio"
    audio_voice_name: str = "M1"

    # ── Text-to-speech — fully agnostic (for /listen + the voice orb) ──────────
    # TTS_PROVIDER:
    #   openai_compatible → self-hosted SOTA open models via an OpenAI-compatible
    #                       /v1/audio/speech server. Default targets Kokoro-FastAPI
    #                       (Apache-2.0, fast, CPU-friendly). Set TTS_BASE_URL.
    #   openai            → OpenAI cloud TTS (OPENAI_API_KEY).
    #   local             → run Kokoro IN-PROCESS (no Docker, no server). Outputs WAV.
    #   disabled          → no streaming TTS (falls back to the AudioAgent path).
    tts_provider: Literal["openai_compatible", "openai", "local", "disabled"] = "openai_compatible"
    tts_model: str = "kokoro"               # server-side model id (Kokoro-FastAPI: "kokoro")
    tts_voice: str = "af_heart"             # Kokoro default voice
    tts_format: str = "mp3"                 # mp3 | wav | opus | pcm
    tts_base_url: str = "http://localhost:8880/v1"  # Kokoro-FastAPI default; empty = OpenAI cloud
    tts_api_key: str = ""                   # optional; self-hosted servers often need none
    tts_lang_code: str = "a"                # for provider=local Kokoro: 'a'=American English, 'b'=British

    @field_validator("audio_voice_name", mode="before")
    @classmethod
    def normalize_audio_voice_name(cls, value: object) -> str:
        voice = str(value or "M1").strip().upper()
        if voice not in _VALID_AUDIO_VOICES:
            raise ValueError(
                f"Invalid AUDIO_VOICE_NAME {value!r} — use one of "
                f"{sorted(_VALID_AUDIO_VOICES)}"
            )
        return voice

    # Comma-separated emails that bypass Pro gates (internal testing / founders).
    pro_bypass_emails: str = (
        "sharshal499@gmail.com,kkrharsh16@gmail.com,shindeharshal338@gmail.com"
    )

    # ── Sentry ────────────────────────────────────────────────────────────────
    sentry_dsn: str = ""
    sentry_traces_sample_rate: float = 0.1  # 10% of requests traced

    @property
    def pro_bypass_email_set(self) -> frozenset[str]:
        return frozenset(
            e.strip().lower()
            for e in self.pro_bypass_emails.split(",")
            if e.strip()
        )

    @property
    def runs_background_workers(self) -> bool:
        return self.process_role in ("worker", "all")

    @property
    def runs_web_server(self) -> bool:
        return self.process_role in ("web", "all")

    @property
    def scheduler_lock_strict(self) -> bool:
        """Scheduled jobs require Redis locks in production worker mode."""
        return self.app_env == "production" and self.runs_background_workers

    @property
    def smtp_ingestion_active(self) -> bool:
        if self.smtp_ingestion_enabled:
            return True
        if self.app_env == "development" and self.inbound_email_mode in ("smtp", "both"):
            return True
        return self.inbound_email_mode == "both"

    # ── Admin ────────────────────────────────────────────────────────────────
    admin_key: str = "change-me-admin-key"

    def validate_production_security(self) -> None:
        """
        Hard safety checks before serving real users.
        JWT signing AND OAuth-token encryption both derive from secret_key,
        so a default/weak value in production is a critical compromise.
        """
        if self.app_env != "production":
            return
        problems: list[str] = []
        if self.secret_key == "change-me-in-production" or len(self.secret_key) < 32:
            problems.append(
                "SECRET_KEY is default or shorter than 32 chars — JWTs would be "
                "forgeable and stored OAuth tokens trivially decryptable. "
                "Set a strong SECRET_KEY (e.g. `openssl rand -hex 32`)."
            )
        if problems:
            raise RuntimeError(
                "Refusing to start in production with insecure settings:\n- "
                + "\n- ".join(problems)
            )


@lru_cache
def get_settings() -> Settings:
    return Settings()
