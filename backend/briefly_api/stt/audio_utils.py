"""
briefly_api/stt/audio_utils.py

Normalize browser-uploaded audio for STT providers.
"""
from __future__ import annotations

import logging
import shutil
import subprocess
import tempfile
from pathlib import Path

log = logging.getLogger(__name__)

MIME_TO_EXT = {
    "audio/webm": ".webm",
    "video/webm": ".webm",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/mp4": ".m4a",
    "audio/m4a": ".m4a",
    "audio/ogg": ".ogg",
    "audio/opus": ".ogg",
}


def normalize_upload(content_type: str, filename: str) -> tuple[str, str]:
    """Map browser MIME quirks to STT-friendly type + filename."""
    ct = (content_type or "audio/webm").split(";")[0].strip().lower()
    if ct == "video/webm":
        ct = "audio/webm"
    ext = MIME_TO_EXT.get(ct, Path(filename).suffix or ".webm")
    name = filename if filename and Path(filename).suffix else f"recording{ext}"
    if ct == "audio/webm" and not name.endswith(".webm"):
        name = f"{Path(name).stem}.webm"
    return ct, name


def convert_to_wav(audio_bytes: bytes, *, input_suffix: str = ".webm") -> bytes | None:
    """
    Convert arbitrary audio to 16kHz mono WAV via ffmpeg.
    Returns None if ffmpeg is unavailable or conversion fails.
    """
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return None

    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / f"input{input_suffix}"
        dst = Path(tmp) / "output.wav"
        src.write_bytes(audio_bytes)
        try:
            proc = subprocess.run(
                [
                    ffmpeg,
                    "-y",
                    "-i", str(src),
                    "-af", "highpass=f=80,lowpass=f=8000,volume=1.2",
                    "-ac", "1",
                    "-ar", "16000",
                    "-f", "wav",
                    str(dst),
                ],
                capture_output=True,
                timeout=120,
                check=False,
            )
            if proc.returncode != 0 or not dst.exists():
                log.warning(
                    "ffmpeg conversion failed (code=%s): %s",
                    proc.returncode,
                    proc.stderr.decode("utf-8", errors="replace")[:500],
                )
                return None
            return dst.read_bytes()
        except (subprocess.TimeoutExpired, OSError) as exc:
            log.warning("ffmpeg conversion error: %s", exc)
            return None
