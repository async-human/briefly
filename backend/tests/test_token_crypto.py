"""Tests for OAuth token encryption."""
from __future__ import annotations

from briefly_api.security.token_crypto import decrypt_token, encrypt_token


def test_encrypt_decrypt_roundtrip():
    plain = "ya29.test-access-token-value"
    stored = encrypt_token(plain)
    assert stored.startswith("enc:v1:")
    assert decrypt_token(stored) == plain


def test_decrypt_legacy_plaintext():
    plain = "legacy-unencrypted-token"
    assert decrypt_token(plain) == plain


def test_double_encrypt_is_idempotent():
    plain = "token-value"
    once = encrypt_token(plain)
    twice = encrypt_token(once)
    assert twice == once
