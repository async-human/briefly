from briefly_api.services.connectors.email import EmailConnector
from briefly_api.services.connectors.gmail import GmailConnector
from briefly_api.services.connectors.reddit import RedditConnector
from briefly_api.services.connectors.registry import CONNECTOR_MAP, CONNECTORS, detect_source, get_connector
from briefly_api.services.connectors.rss import RssConnector
from briefly_api.services.connectors.url import UrlConnector
from briefly_api.services.connectors.youtube import YoutubeConnector

__all__ = [
    "CONNECTORS",
    "CONNECTOR_MAP",
    "EmailConnector",
    "GmailConnector",
    "RssConnector",
    "YoutubeConnector",
    "RedditConnector",
    "UrlConnector",
    "detect_source",
    "get_connector",
]
