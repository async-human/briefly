"""Tests for account deletion billing cleanup."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from briefly_api.services.privacy_gmail import delete_user_account


def test_delete_user_account_cancels_dodo_subscription():
    user = MagicMock()
    user.id = "user-1"
    user.email = "test@example.com"
    user.ls_subscription_id = "sub_abc"

    db = AsyncMock()
    db.execute = AsyncMock(
        return_value=MagicMock(
            scalars=MagicMock(return_value=MagicMock(all=MagicMock(return_value=[])))
        )
    )
    db.add = MagicMock()
    db.delete = AsyncMock()
    db.flush = AsyncMock()

    settings = MagicMock()
    settings.dodo_payments_api_key = "test_key"

    with patch(
        "briefly_api.services.privacy_gmail.dodo_payments.cancel_subscription_for_account_deletion",
        new_callable=AsyncMock,
    ) as cancel_mock:
        asyncio.run(delete_user_account(db, user, settings))

    cancel_mock.assert_awaited_once_with(settings, "sub_abc")
    db.add.assert_called_once()
    db.delete.assert_awaited_once_with(user)


def test_delete_user_account_skips_cancel_without_subscription():
    user = MagicMock()
    user.id = "user-1"
    user.email = "free@example.com"
    user.ls_subscription_id = None

    db = AsyncMock()
    db.execute = AsyncMock(
        return_value=MagicMock(
            scalars=MagicMock(return_value=MagicMock(all=MagicMock(return_value=[])))
        )
    )
    db.delete = AsyncMock()
    db.flush = AsyncMock()

    settings = MagicMock()
    settings.dodo_payments_api_key = "test_key"

    with patch(
        "briefly_api.services.privacy_gmail.dodo_payments.cancel_subscription_for_account_deletion",
        new_callable=AsyncMock,
    ) as cancel_mock:
        asyncio.run(delete_user_account(db, user, settings))

    cancel_mock.assert_not_awaited()
    db.delete.assert_awaited_once_with(user)
