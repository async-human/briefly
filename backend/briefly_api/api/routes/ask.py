from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, status

from briefly_api.api.deps.rate_limit import rate_limit_ask_dep, rate_limit_ask_stream_dep
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.auth.deps import get_current_user
from briefly_api.db.engine import get_db
from briefly_api.db.models import User
from briefly_api.services.ask_briefly import (
    ask_briefly,
    delete_thread,
    get_thread,
    list_threads,
    stream_ask_briefly,
)

log = logging.getLogger(__name__)

router = APIRouter(tags=["ask"])


class AskIn(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    thread_id: str | None = Field(default=None, max_length=36)
    content_id: str | None = Field(default=None, max_length=36)
    digest_item_id: str | None = Field(default=None, max_length=36)


@router.post("/ask", dependencies=[Depends(rate_limit_ask_dep)])
async def post_ask(
    body: AskIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    try:
        return await ask_briefly(
            db,
            user,
            body.message,
            thread_id=body.thread_id,
            content_id=body.content_id,
            digest_item_id=body.digest_item_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/ask/stream", dependencies=[Depends(rate_limit_ask_stream_dep)])
async def post_ask_stream(
    body: AskIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    async def event_generator():
        try:
            async for chunk in stream_ask_briefly(
                db,
                user,
                body.message,
                thread_id=body.thread_id,
                content_id=body.content_id,
                digest_item_id=body.digest_item_id,
            ):
                yield chunk
        except ValueError as exc:
            # Expected, user-facing validation errors — surface the message.
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
        except Exception:
            # Anything else would otherwise kill the stream mid-flight and show
            # the browser a bare "Failed to fetch". Log it and send a clean error
            # event so the UI can recover gracefully.
            log.exception("ask stream failed for user %s", getattr(user, "id", "?"))
            yield (
                "data: "
                + json.dumps(
                    {
                        "type": "error",
                        "message": "Sorry — I hit an error answering that. Please try again.",
                    }
                )
                + "\n\n"
            )

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/ask/threads")
async def get_ask_threads(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    threads = await list_threads(db, user.id)
    return {"threads": threads}


@router.get("/ask/threads/{thread_id}")
async def get_ask_thread(
    thread_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    thread = await get_thread(db, user.id, thread_id)
    if not thread:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found.")
    return {"thread": thread}


@router.delete("/ask/threads/{thread_id}")
async def delete_ask_thread(
    thread_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    deleted = await delete_thread(db, user.id, thread_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found.")
    return {"ok": True}
