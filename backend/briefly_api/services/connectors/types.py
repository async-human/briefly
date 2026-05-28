"""Known source type strings — not a DB enum, so new connectors need no migration."""

EMAIL = "email"
RSS = "rss"
YOUTUBE = "youtube"
REDDIT = "reddit"
URL = "url"

ALL_SOURCE_TYPES = frozenset({EMAIL, RSS, YOUTUBE, REDDIT, URL})
FETCHABLE_SOURCE_TYPES = frozenset({RSS, YOUTUBE, REDDIT, URL})
