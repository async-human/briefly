"""
briefly_api/stt/streaming.py

Streaming STT via Deepgram live API — partial transcripts and utterance-end
endpointing for the orb WebSocket session.
"""
from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

from briefly_api.config import get_settings

log = logging.getLogger(__name__)

DEEPGRAM_WS = "wss://api.deepgram.com/v1/listen"


@dataclass
class StreamTranscriptEvent:
    text: str
    is_final: bool
    speech_final: bool = False


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

        params = {
            "model": self._settings.stt_model or "nova-2",
            "language": self._language,
            "punctuate": "true",
            "interim_results": "true",
            "endpointing": str(self._settings.deepgram_endpointing_ms),
            "utterance_end_ms": str(max(1000, self._settings.deepgram_endpointing_ms)),
            "smart_format": "true",
        }
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
                    await self._queue.put(StreamTranscriptEvent(text="", is_final=True, speech_final=True))
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
