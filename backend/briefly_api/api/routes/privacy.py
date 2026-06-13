from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.auth.deps import get_current_user
from briefly_api.auth.gmail import get_gmail_connection
from briefly_api.config import Settings, get_settings
from briefly_api.db.engine import get_db
from briefly_api.db.models import User
from briefly_api.services.privacy_gmail import delete_user_account, list_gmail_access_log

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
    settings: Settings = Depends(get_settings),
) -> Response:
    if body.confirm_email.strip().lower() != user.email.strip().lower():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Confirmation email does not match your account.",
        )
    try:
        await delete_user_account(db, user, settings)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
