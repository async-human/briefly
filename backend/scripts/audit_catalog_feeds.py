"""Audit catalog RSS feed URLs."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from briefly_api.services.source_catalog import _CATALOG
from briefly_api.services.rss import feed_has_entries, _load_feed_sync

failures = []
for entry in _CATALOG:
    url = entry["url"]
    ok = feed_has_entries(url)
    feed, final_url, status = _load_feed_sync(url)
    if ok:
        print(f"OK   {entry['name'][:45]:45} entries={len(feed.entries):3}")
    else:
        print(f"FAIL {entry['name'][:45]:45} status={status} entries={len(feed.entries)} final={final_url}")
        failures.append(entry)

print(f"\n{len(_CATALOG) - len(failures)}/{len(_CATALOG)} passed, {len(failures)} failed")
