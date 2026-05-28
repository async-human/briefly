from __future__ import annotations

from dataclasses import dataclass


@dataclass
class FetchedArticle:
    title: str
    summary: str
    url: str | None
    source_name: str
    source_type: str = "rss"
    section: str = "Your feeds"
