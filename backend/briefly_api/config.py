"""
briefly_api/config.py

All configuration from environment variables.
LLM provider, model, and embedding provider are fully swappable
by changing .env — zero code changes required.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


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

    # ── Redis ────────────────────────────────────────────────────────────────
    redis_url: str = "redis://localhost:6379/0"

    # ── LLM — fully agnostic ─────────────────────────────────────────────────
    # Swap provider + model from .env with zero code changes
    llm_provider: Literal["anthropic", "openai", "groq"] = "anthropic"
    llm_model: str = "claude-sonnet-4-5"
    llm_temperature: float = 0.3
    llm_max_tokens: int = 4096

    # Provider API keys — only the active provider's key is required
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    groq_api_key: str = ""

    # ── Embeddings — fully agnostic ───────────────────────────────────────────
    embedding_provider: Literal["voyage", "openai"] = "voyage"
    embedding_model: str = "voyage-3"
    embedding_dim: int = 1024  # voyage-3=1024, text-embedding-3-small=1536

    voyage_api_key: str = ""

    # ── Email ingestion ───────────────────────────────────────────────────────
    # Each user gets a unique address: {token}@{email_ingestion_domain}
    email_ingestion_domain: str = "mail.briefly.app"
    smtp_host: str = "0.0.0.0"
    smtp_port: int = 2525

    # ── Email delivery (Resend) ───────────────────────────────────────────────
    resend_api_key: str = ""
    digest_from_email: str = "digest@briefly.app"
    digest_from_name: str = "Briefly"

    # ── YouTube ───────────────────────────────────────────────────────────────
    youtube_api_key: str = ""

    # ── Reddit ────────────────────────────────────────────────────────────────
    reddit_client_id: str = ""
    reddit_client_secret: str = ""
    reddit_user_agent: str = "briefly-digest/1.0"

    # ── Pipeline config ───────────────────────────────────────────────────────
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

    # ── Auth ─────────────────────────────────────────────────────────────────
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 60 * 24 * 7  # 7 days
    magic_link_expire_minutes: int = 15
    google_client_id: str = ""
    google_client_secret: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def google_redirect_uri(self) -> str:
        return f"{self.backend_url.rstrip('/')}/api/v1/auth/google/callback"

    # ── Admin ────────────────────────────────────────────────────────────────
    admin_key: str = "change-me-admin-key"


@lru_cache
def get_settings() -> Settings:
    return Settings()
