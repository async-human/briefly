"""Known source type strings — not a DB enum, so new connectors need no migration."""

EMAIL = "email"
GMAIL = "gmail"
RSS = "rss"
YOUTUBE = "youtube"
YOUTUBE_ACCOUNT = "youtube_account"   # OAuth-connected — fetches all subscriptions
REDDIT = "reddit"
REDDIT_ACCOUNT = "reddit_account"     # OAuth-connected — fetches all subscribed subreddits
URL = "url"
WATCHED_PAGE = "watched_page"   # poll any page, harvest new articles it links to
READWISE = "readwise"
BRAIN_DUMP = "brain_dump"
BROWSER_CAPTURE = "browser_capture"

ALL_SOURCE_TYPES = frozenset({
    EMAIL, GMAIL, RSS, YOUTUBE, YOUTUBE_ACCOUNT, REDDIT, REDDIT_ACCOUNT, URL, WATCHED_PAGE, READWISE,
    BRAIN_DUMP, BROWSER_CAPTURE,
})
FETCHABLE_SOURCE_TYPES = frozenset({EMAIL, GMAIL, RSS, YOUTUBE, YOUTUBE_ACCOUNT, REDDIT, REDDIT_ACCOUNT, URL, WATCHED_PAGE, READWISE})
# System placeholders — not user-added feeds; must not consume free source slots.
INTERNAL_SOURCE_TYPES = frozenset({BRAIN_DUMP, BROWSER_CAPTURE})
