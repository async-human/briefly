"""Tests for account deletion billing cleanup."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from briefly_api.services.privacy_gmail import (
    deactivate_user_account,
    delete_user_account,
    finalize_user_account_deletion,
)


def test_finalize_user_account_deletion_cancels_dodo_subscription():
    user = MagicMock()
    user.id = "user-1"
    user.email = "test@example.com"
    user.ls_subscription_id = "sub_abc"

    db = AsyncMock()
    db.get = AsyncMock(return_value=user)
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
        asyncio.run(
            finalize_user_account_deletion(
                db,
                "user-1",
                settings,
                subscription_id="sub_abc",
                user_email="test@example.com",
            )
        )

    cancel_mock.assert_awaited_once_with(settings, "sub_abc")
    db.add.assert_called_once()
    db.delete.assert_awaited_once_with(user)


def test_finalize_user_account_deletion_skips_cancel_without_subscription():
    user = MagicMock()
    user.id = "user-1"
    user.email = "free@example.com"
    user.ls_subscription_id = None

    db = AsyncMock()
    db.get = AsyncMock(return_value=user)
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
        asyncio.run(
            finalize_user_account_deletion(
                db,
                "user-1",
                settings,
                subscription_id=None,
                user_email="free@example.com",
            )
        )

    cancel_mock.assert_not_awaited()
    db.delete.assert_awaited_once_with(user)


def test_deactivate_user_account_locks_account():
    user = MagicMock()
    user.is_active = True

    db = AsyncMock()
    db.flush = AsyncMock()

    asyncio.run(deactivate_user_account(db, user))

    assert user.is_active is False
    db.flush.assert_awaited_once()


def test_delete_user_account_still_hard_deletes():
    user = MagicMock()
    user.id = "user-1"
    user.email = "test@example.com"
    user.ls_subscription_id = None

    db = AsyncMock()
    db.get = AsyncMock(return_value=user)
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
        "briefly_api.services.privacy_gmail.finalize_user_account_deletion",
        new_callable=AsyncMock,
    ) as finalize_mock:
        asyncio.run(delete_user_account(db, user, settings))

    finalize_mock.assert_awaited_once()
