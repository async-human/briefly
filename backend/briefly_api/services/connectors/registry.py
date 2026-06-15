from __future__ import annotations

from dataclasses import dataclass, field
from urllib.parse import urlparse

from briefly_api.config import Settings
from briefly_api.services.connectors.base import BaseConnector
from briefly_api.services.connectors.email import EmailConnector
from briefly_api.services.connectors.gmail import GmailConnector
from briefly_api.services.connectors.readwise import ReadwiseConnector
from briefly_api.services.connectors.reddit import RedditConnector
from briefly_api.services.connectors.reddit_account import RedditAccountConnector
from briefly_api.services.connectors.rss import RssConnector
from briefly_api.services.connectors.url import UrlConnector
from briefly_api.services.connectors.watched_page import WatchedPageConnector
from briefly_api.services.connectors.youtube import YoutubeConnector
from briefly_api.services.connectors.youtube_account import YoutubeAccountConnector
from briefly_api.services.url_scraper import _looks_like_article_path, discover_rss_feed

# Order matters for detection — most specific first.
CONNECTORS: list[BaseConnector] = [
    EmailConnector(),
    GmailConnector(),
    ReadwiseConnector(),
    YoutubeAccountConnector(),   # OAuth-connected account (before manual YouTube)
    YoutubeConnector(),
    RedditAccountConnector(),    # OAuth-connected account (before manual Reddit)
    RedditConnector(),
    RssConnector(),
    UrlConnector(),
    WatchedPageConnector(),   # explicit "follow this page" — never auto-detected
]

CONNECTOR_MAP: dict[str, BaseConnector] = {c.source_type: c for c in CONNECTORS}

# Generic URL handling (RSS autodiscovery + article vs index heuristics) runs after
# specific connectors and must not be short-circuited by UrlConnector.can_handle.
_DEFERRED_URL_TYPES = frozenset({"url", "watched_page"})


@dataclass
class DetectAlternative:
    source_type: str
    label: str
    hint: str


@dataclass
class DetectedSource:
    source_type: str
    identifier: str
    label: str
    hint: str
    confidence: str  # "high" | "medium"
    alternatives: list[DetectAlternative] = field(default_factory=list)


async def detect_source(identifier: str, settings: Settings | None = None) -> DetectedSource:
    value = identifier.strip()
    if not value:
        raise ValueError("Enter a URL, email, channel, or subreddit.")

    for connector in CONNECTORS:
        if connector.source_type in _DEFERRED_URL_TYPES:
            continue
        if connector.can_handle(value):
            normalized = connector.normalize_identifier(value)
            return DetectedSource(
                source_type=connector.source_type,
                identifier=normalized,
                label=connector.label,
                hint=connector.detect_hint,
                confidence="high",
            )

    # Generic URL — try RSS autodiscovery, then article-path heuristic.
    if value.startswith(("http://", "https://")) or "." in value:
        url_connector = CONNECTOR_MAP["url"]
        watched_connector = CONNECTOR_MAP["watched_page"]
        normalized = url_connector.normalize_identifier(value)
        feed_url = await discover_rss_feed(normalized)
        if feed_url:
            rss = CONNECTOR_MAP["rss"]
            return DetectedSource(
                source_type=rss.source_type,
                identifier=feed_url,
                label=rss.label,
                hint="RSS feed discovered on this site.",
                confidence="medium",
            )

        parsed = urlparse(normalized)
        if _looks_like_article_path(parsed.path):
            return DetectedSource(
                source_type=url_connector.source_type,
                identifier=normalized,
                label="Save once",
                hint="This looks like a single article — we'll scrape it once, with no ongoing updates.",
                confidence="medium",
                alternatives=[
                    DetectAlternative(
                        source_type=watched_connector.source_type,
                        label="Follow this site",
                        hint=watched_connector.detect_hint,
                    ),
                ],
            )

        return DetectedSource(
            source_type=watched_connector.source_type,
            identifier=normalized,
            label="Follow this site",
            hint=watched_connector.detect_hint,
            confidence="medium",
            alternatives=[
                DetectAlternative(
                    source_type=url_connector.source_type,
                    label="Save once",
                    hint="Scrape only this page once — no ongoing updates.",
                ),
            ],
        )

    raise ValueError(
        "Couldn't detect source type. Try a full URL, YouTube channel, subreddit name, or email."
    )


def get_connector(source_type: str) -> BaseConnector | None:
    return CONNECTOR_MAP.get(source_type)
