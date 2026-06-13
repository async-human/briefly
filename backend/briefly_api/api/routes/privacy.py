from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.auth.deps import get_current_user
from briefly_api.auth.gmail import get_gmail_connection
from briefly_api.db.engine import get_db
from briefly_api.db.models import User
from briefly_api.services.background_jobs import enqueue_background_job
from briefly_api.services.privacy_gmail import (
    deactivate_user_account,
    list_gmail_access_log,
)

router = APIRouter(tags=["privacy"])


class DeleteAccountIn(BaseModel):
    confirm_email: str = Field(..., min_length=3, max_length=255)


@router.get("/privacy/gmail-access-log")
async def get_gmail_access_log(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    connection = await get_gmail_connection(db, user.id)
    return {
        "connected": connection is not None,
        "email": connection.account_email if connection else None,
        "events": list_gmail_access_log(connection),
    }


@router.delete("/privacy/account", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def delete_account(
    body: DeleteAccountIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    if body.confirm_email.strip().lower() != user.email.strip().lower():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Confirmation email does not match your account.",
        )

    user_id = user.id
    user_email = user.email
    subscription_id = (user.ls_subscription_id or "").strip() or None

    await deactivate_user_account(db, user)
    await db.commit()

    await enqueue_background_job(
        "account_deletion_cleanup",
        {
            "user_id": user_id,
            "user_email": user_email,
            "subscription_id": subscription_id,
        },
        idempotency_key=f"account-deletion:{user_id}",
    )

    return Response(status_code=status.HTTP_204_NO_CONTENT)
