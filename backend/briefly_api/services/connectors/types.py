"""Known source type strings — not a DB enum, so new connectors need no migration."""

EMAIL = "email"
GMAIL = "gmail"
RSS = "rss"
YOUTUBE = "youtube"
YOUTUBE_ACCOUNT = "youtube_account"   # OAuth-connected — fetches all subscriptions
REDDIT = "reddit"
REDDIT_ACCOUNT = "reddit_account"     # OAuth-connected — fetches all subscribed subreddits
URL = "url"

ALL_SOURCE_TYPES = frozenset({EMAIL, GMAIL, RSS, YOUTUBE, YOUTUBE_ACCOUNT, REDDIT, REDDIT_ACCOUNT, URL})
FETCHABLE_SOURCE_TYPES = frozenset({GMAIL, RSS, YOUTUBE, YOUTUBE_ACCOUNT, REDDIT, REDDIT_ACCOUNT, URL})
