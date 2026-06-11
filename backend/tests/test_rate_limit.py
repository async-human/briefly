"""Rate limit helper tests."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from briefly_api.services.rate_limit import enforce_rate_limit


def test_enforce_rate_limit_disabled():
    with patch("briefly_api.services.rate_limit.get_settings") as mock_settings:
        mock_settings.return_value.rate_limit_enabled = False
        asyncio.run(
            enforce_rate_limit(scope="ask", subject="user-1", limit=1, window_seconds=60)
        )


def test_enforce_rate_limit_exceeded():
    mock_client = AsyncMock()
    mock_client.incr.return_value = 2
    mock_client.expire.return_value = True
    mock_client.ttl.return_value = 42

    with patch("briefly_api.services.rate_limit.get_settings") as mock_settings:
        mock_settings.return_value.rate_limit_enabled = True
        mock_settings.return_value.redis_url = "redis://localhost:6379/0"
        mock_settings.return_value.app_env = "production"

        with patch("redis.asyncio.Redis.from_url", return_value=mock_client):
            with pytest.raises(HTTPException) as exc:
                asyncio.run(
                    enforce_rate_limit(scope="ask", subject="user-1", limit=1, window_seconds=60)
                )
            assert exc.value.status_code == 429
            assert exc.value.headers.get("Retry-After") == "42"


def test_enforce_rate_limit_allows_under_cap():
    mock_client = AsyncMock()
    mock_client.incr.return_value = 1
    mock_client.expire.return_value = True

    with patch("briefly_api.services.rate_limit.get_settings") as mock_settings:
        mock_settings.return_value.rate_limit_enabled = True
        mock_settings.return_value.redis_url = "redis://localhost:6379/0"
        mock_settings.return_value.app_env = "production"

        with patch("redis.asyncio.Redis.from_url", return_value=mock_client):
            asyncio.run(
                enforce_rate_limit(scope="ask", subject="user-1", limit=5, window_seconds=60)
            )

    mock_client.incr.assert_awaited_once()
