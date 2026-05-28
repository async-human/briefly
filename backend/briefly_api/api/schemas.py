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

    model_config = {"from_attributes": True}


class MeOut(BaseModel):
    user: UserOut
    profile: ProfileOut | None
    ingestion_email: str


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

    model_config = {"from_attributes": True}


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

