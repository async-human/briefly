from __future__ import annotations

from dataclasses import dataclass

from briefly_api.config import Settings
from briefly_api.services.connectors.base import BaseConnector
from briefly_api.services.connectors.email import EmailConnector
from briefly_api.services.connectors.gmail import GmailConnector
from briefly_api.services.connectors.readwise import ReadwiseConnector
from briefly_api.services.connectors.reddit import RedditConnector
from briefly_api.services.connectors.reddit_account import RedditAccountConnector
from briefly_api.services.connectors.rss import RssConnector
from briefly_api.services.connectors.url import UrlConnector
from briefly_api.services.connectors.youtube import YoutubeConnector
from briefly_api.services.connectors.youtube_account import YoutubeAccountConnector
from briefly_api.services.url_scraper import discover_rss_feed

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
]

CONNECTOR_MAP: dict[str, BaseConnector] = {c.source_type: c for c in CONNECTORS}


@dataclass
class DetectedSource:
    source_type: str
    identifier: str
    label: str
    hint: str
    confidence: str  # "high" | "medium"


async def detect_source(identifier: str, settings: Settings | None = None) -> DetectedSource:
    value = identifier.strip()
    if not value:
        raise ValueError("Enter a URL, email, channel, or subreddit.")

    for connector in CONNECTORS:
        if connector.can_handle(value):
            normalized = connector.normalize_identifier(value)
            return DetectedSource(
                source_type=connector.source_type,
                identifier=normalized,
                label=connector.label,
                hint=connector.detect_hint,
                confidence="high",
            )

    # Generic URL — try RSS autodiscovery before falling back to scraper.
    if value.startswith(("http://", "https://")) or "." in value:
        url_connector = CONNECTOR_MAP["url"]
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
        return DetectedSource(
            source_type=url_connector.source_type,
            identifier=normalized,
            label=url_connector.label,
            hint=url_connector.detect_hint,
            confidence="medium",
        )

    raise ValueError(
        "Couldn't detect source type. Try a full URL, YouTube channel, subreddit name, or email."
    )


def get_connector(source_type: str) -> BaseConnector | None:
    return CONNECTOR_MAP.get(source_type)
