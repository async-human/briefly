from briefly_api.services.source_priority import (
    apply_priority_to_source_score,
    max_items_for_source,
    normalize_priority,
    priority_from_source,
    priority_sort_key,
)


class _FakeSource:
    def __init__(self, sid: str, priority: str | None = None):
        self.id = sid
        self.meta = {"priority": priority} if priority else {}


def test_normalize_priority():
    assert normalize_priority("high") == "high"
    assert normalize_priority("invalid") == "normal"


def test_priority_from_source():
    assert priority_from_source(_FakeSource("1", "high")) == "high"
    assert priority_from_source(_FakeSource("2")) == "normal"


def test_max_items_for_source():
    pmap = {"a": "high", "b": "normal", "c": "low"}
    assert max_items_for_source("a", pmap) == 5
    assert max_items_for_source("b", pmap) == 2
    assert max_items_for_source("c", pmap) == 1


def test_apply_priority_boost():
    pmap = {"x": "high", "y": "low"}
    assert apply_priority_to_source_score(0.5, "x", pmap) >= 0.82
    assert apply_priority_to_source_score(0.9, "y", pmap) <= 0.45


def test_priority_sort_key():
    pmap = {"h": "high", "n": "normal", "l": "low"}
    assert priority_sort_key("h", pmap) < priority_sort_key("n", pmap)
    assert priority_sort_key("n", pmap) < priority_sort_key("l", pmap)
