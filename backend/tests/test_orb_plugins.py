"""Tests for orb plugin loading."""
from __future__ import annotations

from briefly_api.agent.plugins import _normalize_plugin_modules


def test_normalize_empty_plugin_env():
    assert _normalize_plugin_modules("") == []
    assert _normalize_plugin_modules('""') == []
    assert _normalize_plugin_modules("''") == []
    assert _normalize_plugin_modules('  ""  ') == []


def test_normalize_plugin_list():
    assert _normalize_plugin_modules("foo.bar, baz.qux") == ["foo.bar", "baz.qux"]
    assert _normalize_plugin_modules('"foo.bar", "baz.qux"') == ["foo.bar", "baz.qux"]
