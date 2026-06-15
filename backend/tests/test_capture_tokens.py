"""Tests for capture device tokens."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

from briefly_api.services import capture_tokens as ct


# ── Pure helpers ────────────────────────────────────────────────────────────────

def test_token_format_and_prefix_detection():
    assert ct.looks_like_capture_token("bcap_abc123") is True
    assert ct.looks_like_capture_token("eyJhbGciOi...") is False  # a JWT
    assert ct.looks_like_capture_token("") is False


def test_hash_is_deterministic_and_hex():
    h1 = ct._hash("bcap_secret")
    h2 = ct._hash("bcap_secret")
    assert h1 == h2
    assert len(h1) == 64 and ct._hash("other") != h1


def test_normalize_platform():
    assert ct.normalize_platform("iOS") == "ios"
    assert ct.normalize_platform("  Android ") == "android"
    assert ct.normalize_platform("nonsense") is None
    assert ct.normalize_platform(None) is None


# ── Fakes ────────────────────────────────────────────────────────────────────────

class _Result:
    def __init__(self, obj):
        self._obj = obj

    def scalar_one_or_none(self):
        return self._obj


class _Session:
    def __init__(self, results=None):
        self.added = []
        self._results = list(results or [])

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        pass

    async def execute(self, *_a, **_k):
        return self._results.pop(0)


# ── create_token ────────────────────────────────────────────────────────────────

def test_create_token_returns_plaintext_once_and_stores_hash():
    session = _Session()
    created = asyncio.run(ct.create_token(session, "u1", "My iPhone", platform="ios"))

    assert created.plaintext.startswith("bcap_")
    rec = created.record
    # Stored record holds only the hash, never the plaintext.
    assert rec.token_hash == ct._hash(created.plaintext)
    assert rec.token_hash != created.plaintext
    assert rec.token_prefix == created.plaintext[:9]  # "bcap_" + 4 chars
    assert rec.name == "My iPhone"
    assert rec.platform == "ios"
    assert session.added == [rec]


def test_create_token_rejects_unknown_platform():
    session = _Session()
    created = asyncio.run(ct.create_token(session, "u1", "X", platform="windows-phone"))
    assert created.record.platform is None


# ── resolve_user ────────────────────────────────────────────────────────────────

def test_resolve_user_valid_token_bumps_last_used():
    plaintext = "bcap_validsecret"
    token_row = SimpleNamespace(
        user_id="u1", token_hash=ct._hash(plaintext), revoked_at=None, last_used_at=None,
    )
    user = SimpleNamespace(id="u1", is_active=True)
    session = _Session([_Result(token_row), _Result(user)])

    resolved = asyncio.run(ct.resolve_user(session, plaintext))
    assert resolved is user
    assert token_row.last_used_at is not None  # usage recorded


def test_resolve_user_rejects_non_capture_token():
    session = _Session()
    assert asyncio.run(ct.resolve_user(session, "eyJ-a-jwt")) is None


def test_resolve_user_unknown_token_returns_none():
    session = _Session([_Result(None)])
    assert asyncio.run(ct.resolve_user(session, "bcap_unknown")) is None
