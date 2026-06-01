from datetime import datetime, timezone, timedelta

from briefly_api.services.medium_ingestion import _filter_by_age, _title_matches_keywords


def test_filter_by_age_drops_old():
    old = datetime.now(timezone.utc) - timedelta(days=90)
    from briefly_api.services.articles import NormalizedContent

    items = [
        NormalizedContent(
            title="Old post",
            url="https://medium.com/p/abc123456789",
            source_name="Medium",
            published_at=old,
            clean_text="text",
        )
    ]
    kept = _filter_by_age(items, max_age_days=21)
    assert kept == []


def test_title_matches_keywords():
    keywords = {"generative", "machine", "learning"}
    assert _title_matches_keywords("Generative AI in Production", keywords)
    assert not _title_matches_keywords("My Vacation Photos", keywords)
