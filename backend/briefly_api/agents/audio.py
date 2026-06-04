"""
briefly_api/agents/audio.py

AudioAgent: converts the written digest into a spoken audio file using
Supertonic TTS. Runs after CitationVerifierAgent so the text is clean
and verified before synthesis.

The generated WAV is saved to disk and a public URL is stored in ctx
so DeliveryAgent can include a "Listen to your briefing" link in the email.

Disabled by default — set AUDIO_ENABLED=true in .env to activate.
"""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from briefly_api.agents.context import PipelineContext
from briefly_api.config import get_settings

log = logging.getLogger(__name__)


def _build_script(ctx: PipelineContext) -> str:
    """Build clean spoken text from digest items — no markdown, no URLs."""
    name = ctx.user.name or "there"
    lines = [f"Good morning {name}. Here's your Briefly for {ctx.run_date}."]

    for i, item in enumerate(ctx.digest_items, 1):
        lines.append(f"Story {i}. {item.headline}.")
        lines.append(item.summary.rstrip(".") + ".")
        if item.why_it_matters:
            lines.append(item.why_it_matters.rstrip(".") + ".")

    lines.append("That's your Briefly for today. Have a great day.")
    return " ".join(lines)


def _synthesize(script: str, output_path: str, voice_name: str) -> bool:
    """Run Supertonic TTS synchronously — called via asyncio.to_thread."""
    try:
        # Supertonic occasionally logs strings with bare % — guard the handler.
        for logger_name in ("supertonic", "supertonic.pipeline"):
            logging.getLogger(logger_name).propagate = True

        from supertonic import TTS  # noqa: PLC0415

        tts = TTS(auto_download=True)
        style = tts.get_voice_style(voice_name=voice_name)
        wav, duration = tts.synthesize(script, voice_style=style, lang="en")
        tts.save_audio(wav, output_path)
        log.info("AudioAgent: synthesized %.1fs of audio -> %s", duration, output_path)
        return True
    except ImportError:
        log.error("AudioAgent: supertonic not installed — run: pip install supertonic")
        return False
    except Exception:
        log.exception("AudioAgent: TTS synthesis failed")
        return False


async def run(ctx: PipelineContext) -> PipelineContext:
    s = get_settings()

    if not s.audio_enabled:
        return ctx

    if not ctx.digest_items:
        log.warning("AudioAgent: no digest items — skipping audio generation")
        return ctx

    script = _build_script(ctx)

    audio_dir = Path(s.audio_storage_path)
    audio_dir.mkdir(parents=True, exist_ok=True)

    # Deterministic filename — safe to regenerate
    filename = f"{ctx.user.user_id}_{ctx.run_date}.wav"
    output_path = str(audio_dir / filename)

    success = await asyncio.to_thread(_synthesize, script, output_path, s.audio_voice_name)

    if success:
        ctx.__dict__["audio_url"] = f"{s.backend_url}/audio/{filename}"
        log.info("AudioAgent: audio ready for user %s -> %s", ctx.user.user_id, filename)
    else:
        log.warning("AudioAgent: TTS synthesis failed — digest will be text-only")

    return ctx
