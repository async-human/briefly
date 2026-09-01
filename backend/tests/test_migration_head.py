"""The deploy bootstrap and Alembic chain must advance together."""
from __future__ import annotations

from pathlib import Path

from briefly_api.scripts.ensure_migrations import _HEAD


def test_declared_head_has_matching_migration_and_truth_columns():
    versions = Path(__file__).parents[1] / "alembic" / "versions"
    migration = versions / f"{_HEAD}_signal_truth_layer.py"
    assert migration.exists()
    text = migration.read_text(encoding="utf-8")
    assert 'down_revision = "018"' in text
    assert "event_fingerprint" in text
    assert "is_material_change" in text
    assert "uq_entity_alert_event" in text
    assert "uq_entity_snapshot_signal" in text
