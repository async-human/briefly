"""
briefly_api/stt/streaming.py

Streaming STT via Deepgram live API — partial transcripts and utterance-end
endpointing for the orb WebSocket session.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote, urlencode

from briefly_api.config import get_settings

log = logging.getLogger(__name__)

DEEPGRAM_WS = "wss://api.deepgram.com/v1/listen"


def _keywords_from_prompt(context_prompt: str | None) -> list[str]:
    """Extract vocabulary hints from the Expected vocabulary section."""
    if not context_prompt:
        return []
    text = context_prompt
    marker = "Expected vocabulary:"
    if marker in text:
        text = text.split(marker, 1)[1]

    stop = {
        "expected", "vocabulary", "transcribe", "spoken", "english", "accurately",
        "proper", "punctuation", "conversation", "context", "previous", "utterance",
    }
    terms: list[str] = []
    for chunk in re.split(r"[,.\n;]", text):
        token = chunk.strip()
        if not token or len(token) < 2:
            continue
        if token.lower() in stop:
            continue
        if len(token) > 48:
            token = token[:48]
        if token not in terms:
            terms.append(token)
        if len(terms) >= 12:
            break
    return terms


@dataclass
class StreamTranscriptEvent:
    text: str
    is_final: bool
    speech_final: bool = False
    utterance_end: bool = False


class DeepgramStreamSession:
    """Deepgram live transcription session with an async event queue."""

    def __init__(self, *, language: str = "en-US", context_prompt: str | None = None):
        self._settings = get_settings()
        self._language = language
        self._context_prompt = context_prompt
        self._ws = None
        self._queue: asyncio.Queue[StreamTranscriptEvent | None] = asyncio.Queue()
        self._reader_task: asyncio.Task | None = None

    async def connect(self) -> None:
        if not self._settings.deepgram_api_key:
            raise RuntimeError("DEEPGRAM_API_KEY is required for streaming STT")
        import websockets

        params: list[tuple[str, str]] = [
            ("model", self._settings.stt_model or "nova-2"),
            ("language", self._language),
            ("encoding", "linear16"),
            ("sample_rate", "16000"),
            ("channels", "1"),
            ("punctuate", "true"),
            ("interim_results", "true"),
            ("endpointing", str(max(300, self._settings.deepgram_endpointing_ms))),
            ("utterance_end_ms", str(max(1600, self._settings.deepgram_utterance_end_ms))),
            ("vad_events", "true"),
            ("smart_format", "true"),
        ]
        for term in _keywords_from_prompt(self._context_prompt):
            params.append(("keywords", f"{quote(term, safe='')}:1.5"))
        url = f"{DEEPGRAM_WS}?{urlencode(params)}"
        self._ws = await websockets.connect(
            url,
            additional_headers={"Authorization": f"Token {self._settings.deepgram_api_key}"},
        )
        self._reader_task = asyncio.create_task(self._read_loop())

    async def _read_loop(self) -> None:
        assert self._ws is not None
        try:
            async for raw in self._ws:
                try:
                    payload: dict[str, Any] = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if payload.get("type") == "UtteranceEnd":
                    await self._queue.put(
                        StreamTranscriptEvent(
                            text="",
                            is_final=True,
                            speech_final=False,
                            utterance_end=True,
                        )
                    )
                    continue
                channel = payload.get("channel") or {}
                alts = channel.get("alternatives") or []
                if not alts:
                    continue
                text = str(alts[0].get("transcript") or "").strip()
                if not text:
                    continue
                await self._queue.put(
                    StreamTranscriptEvent(
                        text=text,
                        is_final=bool(payload.get("is_final")),
                        speech_final=bool(payload.get("speech_final")),
                    )
                )
        except Exception:
            log.debug("deepgram read loop ended", exc_info=True)
        finally:
            await self._queue.put(None)

    async def send_audio(self, chunk: bytes) -> None:
        if self._ws is not None and chunk:
            await self._ws.send(chunk)

    async def finalize(self) -> None:
        """Signal end of user utterance so Deepgram emits UtteranceEnd."""
        if self._ws is not None:
            try:
                await self._ws.send(json.dumps({"type": "CloseStream"}))
            except Exception:
                pass

    async def close(self) -> None:
        if self._reader_task is not None:
            self._reader_task.cancel()
            self._reader_task = None
        if self._ws is not None:
            try:
                await self._ws.send(b"")
            except Exception:
                pass
            await self._ws.close()
            self._ws = None

    async def events(self) -> AsyncIterator[StreamTranscriptEvent]:
        while True:
            ev = await self._queue.get()
            if ev is None:
                break
            yield ev


async def open_streaming_stt(*, context_prompt: str | None = None) -> DeepgramStreamSession:
    settings = get_settings()
    if not settings.orb_streaming_stt_enabled:
        raise RuntimeError("Streaming STT is disabled")
    session = DeepgramStreamSession(context_prompt=context_prompt)
    await session.connect()
    return session
