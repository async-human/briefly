"""The deploy bootstrap and Alembic chain must advance together."""
from __future__ import annotations

import re
from pathlib import Path

BACKEND = Path(__file__).parents[1]
VERSIONS = BACKEND / "alembic" / "versions"
ENSURE = BACKEND / "briefly_api" / "scripts" / "ensure_migrations.py"


def _declared_head() -> str:
    match = re.search(r'^_HEAD = "(\d+)"', ENSURE.read_text(encoding="utf-8"), re.M)
    assert match, "_HEAD missing from ensure_migrations.py"
    return match.group(1)


def test_declared_head_has_matching_migration():
    head = _declared_head()
    matches = list(VERSIONS.glob(f"{head}_*.py"))
    assert len(matches) == 1, f"expected one migration for head {head}, got {matches}"
    text = matches[0].read_text(encoding="utf-8")
    assert f'revision = "{head}"' in text
    assert "content_hash" in text


def test_truth_layer_migration_still_present():
    path = VERSIONS / "019_signal_truth_layer.py"
    text = path.read_text(encoding="utf-8")
    assert 'down_revision = "018"' in text
    assert "event_fingerprint" in text
    assert "is_material_change" in text
    assert "uq_entity_alert_event" in text
    assert "uq_entity_snapshot_signal" in text


def test_page_watch_migration_adds_hash_columns():
    path = VERSIONS / "021_entity_source_page_watch.py"
    text = path.read_text(encoding="utf-8")
    assert 'down_revision = "020"' in text
    assert "content_hash" in text
    assert "last_extract" in text
    assert "last_error" in text
    assert "consecutive_failures" in text
