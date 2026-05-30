from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class NormalizedContent:
    """Normalized output every source connector must produce."""

    title: str
    url: str | None
    source_name: str
    source_type: str = "rss"
    section: str = "Your feeds"
    author: str | None = None
    published_at: datetime | None = None
    clean_text: str = ""
    summary: str = ""
    source_id: str = ""  # DB Source.id — injected by collector after fetch
    meta: dict = field(default_factory=dict)  # connector-specific extras

    def __post_init__(self) -> None:
        if not self.summary and self.clean_text:
            self.summary = self.clean_text[:400]
        elif self.clean_text == "" and self.summary:
            self.clean_text = self.summary


# Backward-compatible alias used by existing services
FetchedArticle = NormalizedContent
