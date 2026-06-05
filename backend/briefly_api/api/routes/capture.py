from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.agents.proactive.enrich_item import (
    count_thread_captures_this_week,
    enrich_content_item,
)
from briefly_api.api.plan_limits import require_pro
from briefly_api.api.schemas import (
    BrainDumpOut,
    BrainDumpTextIn,
    BrainDumpTranscribeOut,
    UrlCaptureFeedbackOut,
    UrlCaptureIn,
    UrlCaptureOut,
)
from briefly_api.auth.deps import get_current_user
from briefly_api.config import Settings, get_settings
from briefly_api.db.engine import get_db
from briefly_api.db.models import User
from briefly_api.services import brain_dump as brain_dump_service
from briefly_api.services import browser_capture as browser_capture_service

log = logging.getLogger(__name__)

router = APIRouter(tags=["capture"])

CAPTURE_ENRICH_TIMEOUT_SEC = 10.0

ALLOWED_AUDIO_TYPES = {
    "audio/webm",
    "audio/wav",
    "audio/x-wav",
    "audio/mpeg",
    "audio/mp3",
    "audio/mp4",
    "audio/m4a",
    "audio/ogg",
    "video/webm",  # some browsers report webm recordings as video/webm
}


def _to_out(result: brain_dump_service.BrainDumpResult) -> BrainDumpOut:
    return BrainDumpOut(
        id=result.id,
        title=result.title,
        clean_summary=result.clean_summary,
        intent_type=result.intent_type,
        action_items=result.action_items,
        relevance_keywords=result.relevance_keywords,
        should_inject_into_morning_brief=result.should_inject_into_morning_brief,
        tomorrow_brief_preview=result.tomorrow_brief_preview,
        raw_transcript=result.raw_transcript,
        input_mode=result.input_mode,
        created_at=result.created_at,
        injected_at=result.injected_at,
        injected_digest_id=result.injected_digest_id,
    )


@router.get("/brain-dumps", response_model=list[BrainDumpOut])
async def list_brain_dumps(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[BrainDumpOut]:
    results = await brain_dump_service.list_recent_dumps(db, user.id)
    return [_to_out(r) for r in results]


@router.post("/brain-dumps", response_model=BrainDumpOut, status_code=status.HTTP_201_CREATED)
async def create_text_brain_dump(
    body: BrainDumpTextIn,
    user: User = Depends(require_pro),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> BrainDumpOut:
    try:
        result = await brain_dump_service.process_text_dump(
            db, user.id, body.text, settings=settings,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    return _to_out(result)


@router.post("/capture/url", response_model=UrlCaptureOut, status_code=status.HTTP_201_CREATED)
async def capture_page_url(
    body: UrlCaptureIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> UrlCaptureOut:
    """
    Save an article from the browser extension.
    Scrapes the URL, persists to the content pool, and runs immediate enrichment
    for connection feedback in the extension popup (10s timeout).
    """
    try:
        result = await browser_capture_service.capture_url(
            db,
            user.id,
            body.url,
            page_title=body.title,
            user_note=body.note,
            settings=settings,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    enrichment_status = "pending"
    feedback = UrlCaptureFeedbackOut()

    try:
        force_enrich = result.already_saved and bool(result.user_note)
        cache = await asyncio.wait_for(
            enrich_content_item(
                db,
                user.id,
                result.id,
                user_note=result.user_note,
                force=force_enrich,
            ),
            timeout=CAPTURE_ENRICH_TIMEOUT_SEC,
        )
        await db.commit()

        thread_count = 0
        if cache.thread_key:
            thread_count = await count_thread_captures_this_week(db, user.id, cache.thread_key)

        from sqlalchemy import select
        from briefly_api.db.models import RawContent

        row_result = await db.execute(select(RawContent).where(RawContent.id == result.id))
        row = row_result.scalar_one()

        feedback_data = browser_capture_service.build_capture_feedback(
            row,
            cache,
            thread_item_count=thread_count,
        )
        feedback = UrlCaptureFeedbackOut(**feedback_data)
        enrichment_status = (
            "complete" if feedback.connection_sentence or feedback.why_relevant else "partial"
        )
    except asyncio.TimeoutError:
        log.warning("Capture enrichment timed out for user %s content %s", user.id, result.id)
        enrichment_status = "partial"
        feedback = UrlCaptureFeedbackOut(
            briefing_message=(
                "Added to Briefly. Connection analysis is still running — "
                "check tomorrow's briefing."
            ),
        )
        await db.commit()
    except Exception:
        log.exception("Capture enrichment failed for user %s content %s", user.id, result.id)
        enrichment_status = "partial"
        feedback = UrlCaptureFeedbackOut(
            briefing_message="Added to Briefly. Will appear in tomorrow's briefing.",
        )
        try:
            await db.commit()
        except Exception:
            await db.rollback()

    return UrlCaptureOut(
        id=result.id,
        title=result.title,
        url=result.url,
        summary=result.summary,
        user_note=result.user_note,
        created_at=result.created_at,
        already_saved=result.already_saved,
        enrichment_status=enrichment_status,  # type: ignore[arg-type]
        enrichment=feedback,
    )


@router.post("/brain-dumps/transcribe-preview", response_model=BrainDumpTranscribeOut)
async def transcribe_brain_dump_preview(
    file: UploadFile = File(...),
    user: User = Depends(require_pro),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> BrainDumpTranscribeOut:
    """Live transcription of in-progress recording (audio is source of truth)."""
    content_type = (file.content_type or "audio/webm").split(";")[0].strip().lower()
    if content_type not in ALLOWED_AUDIO_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported audio type: {content_type}.",
        )

    audio_bytes = await file.read()
    filename = file.filename or "recording.webm"
    if content_type == "video/webm":
        content_type = "audio/webm"
        if not filename.endswith(".webm"):
            filename = "recording.webm"

    if len(audio_bytes) < 1000:
        return BrainDumpTranscribeOut(text="")

    try:
        text = await brain_dump_service.transcribe_audio_preview(
            audio_bytes,
            filename=filename,
            content_type=content_type,
            settings=settings,
            db=db,
            user_id=user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    except Exception as exc:
        log.exception("Transcribe preview failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Live transcription failed. Recording continues — try again when you stop.",
        ) from exc

    return BrainDumpTranscribeOut(text=text.strip())


@router.post("/brain-dumps/audio", response_model=BrainDumpOut, status_code=status.HTTP_201_CREATED)
async def create_audio_brain_dump(
    file: UploadFile = File(...),
    user: User = Depends(require_pro),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> BrainDumpOut:
    content_type = (file.content_type or "audio/webm").split(";")[0].strip().lower()
    if content_type not in ALLOWED_AUDIO_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported audio type: {content_type}. Use webm, wav, mp3, or m4a.",
        )

    audio_bytes = await file.read()
    filename = file.filename or "recording.webm"
    if content_type == "video/webm":
        content_type = "audio/webm"
        if not filename.endswith(".webm"):
            filename = "recording.webm"

    if len(audio_bytes) < 500:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Recording too short or empty. Please record for at least one second.",
        )

    try:
        result = await brain_dump_service.process_audio_dump(
            db,
            user.id,
            audio_bytes,
            filename=filename,
            content_type=content_type,
            settings=settings,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    except Exception as exc:
        log.exception("Audio brain dump failed for user %s", user.id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to transcribe voice note. Try typing your thoughts instead.",
        ) from exc

    return _to_out(result)
