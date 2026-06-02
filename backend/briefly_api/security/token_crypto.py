"""Encrypt OAuth tokens at rest using Fernet (key derived from secret_key)."""
from __future__ import annotations

import base64
import hashlib
import logging

from cryptography.fernet import Fernet, InvalidToken

from briefly_api.config import get_settings

log = logging.getLogger(__name__)

_PREFIX = "enc:v1:"


def _fernet() -> Fernet:
    settings = get_settings()
    digest = hashlib.sha256(settings.secret_key.encode("utf-8")).digest()
    key = base64.urlsafe_b64encode(digest)
    return Fernet(key)


def encrypt_token(plaintext: str) -> str:
    if not plaintext:
        return plaintext
    if plaintext.startswith(_PREFIX):
        return plaintext
    token = _fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")
    return f"{_PREFIX}{token}"


def decrypt_token(stored: str) -> str:
    if not stored:
        return stored
    if not stored.startswith(_PREFIX):
        return stored
    ciphertext = stored[len(_PREFIX) :]
    try:
        return _fernet().decrypt(ciphertext.encode("ascii")).decode("utf-8")
    except InvalidToken:
        log.warning("Failed to decrypt token — returning empty string")
        return ""
