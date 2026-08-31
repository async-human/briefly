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

_WAV_OUTPUT_ARGS = [
    "-af", "highpass=f=80,lowpass=f=8000,volume=1.2",
    "-ac", "1",
    "-ar", "16000",
    "-f", "wav",
]

# Browser MediaRecorder often yields truncated WebM — try several decode strategies.
_FFMPEG_INPUT_STRATEGIES: list[list[str]] = [
    ["-fflags", "+genpts+discardcorrupt", "-err_detect", "ignore_err"],
    ["-probesize", "32M", "-analyzeduration", "32M", "-fflags", "+discardcorrupt"],
    ["-f", "webm", "-fflags", "+discardcorrupt"],
    ["-f", "matroska,webm", "-fflags", "+discardcorrupt"],
    ["-f", "ogg", "-fflags", "+discardcorrupt"],
    ["-f", "mp4", "-fflags", "+discardcorrupt"],
    ["-err_detect", "ignore_err"],
]


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


def input_suffix_for(content_type: str, filename: str) -> str:
    ct, name = normalize_upload(content_type, filename)
    ext = MIME_TO_EXT.get(ct) or Path(name).suffix or ".webm"
    return ext if ext.startswith(".") else f".{ext}"


def _looks_like_webm(audio_bytes: bytes) -> bool:
    return len(audio_bytes) >= 4 and audio_bytes[:4] == b"\x1aE\xdf\xa3"


def _suffixes_to_try(audio_bytes: bytes, declared: str) -> list[str]:
    """Prefer a matching container, then fall back when the browser lied about MIME."""
    if _looks_like_webm(audio_bytes):
        return [".webm"]
    if len(audio_bytes) >= 4 and audio_bytes[:4] == b"OggS":
        return [".ogg"]
    if len(audio_bytes) >= 4 and audio_bytes[:4] == b"RIFF":
        return [".wav"]
    if len(audio_bytes) >= 8 and audio_bytes[4:8] == b"ftyp":
        return [".mp4", ".m4a"]

    ordered = [declared]
    for alt in (".webm", ".ogg", ".opus", ".mp4", ".m4a", ".wav"):
        if alt not in ordered:
            ordered.append(alt)
    return ordered


def _ffmpeg_to_wav(
    ffmpeg: str,
    src: Path,
    dst: Path,
    input_args: list[str],
) -> bytes | None:
    try:
        proc = subprocess.run(
            [ffmpeg, "-y", *input_args, "-i", str(src), *_WAV_OUTPUT_ARGS, str(dst)],
            capture_output=True,
            timeout=120,
            check=False,
        )
        if proc.returncode != 0 or not dst.exists():
            return None
        out = dst.read_bytes()
        # WAV header is 44 bytes; require some PCM payload.
        if len(out) < 128:
            return None
        return out
    except (subprocess.TimeoutExpired, OSError) as exc:
        log.debug("ffmpeg attempt failed: %s", exc)
        return None


def convert_to_wav(audio_bytes: bytes, *, input_suffix: str = ".webm") -> bytes | None:
    """
    Convert arbitrary audio to 16kHz mono WAV via ffmpeg.
    Returns None if ffmpeg is unavailable or conversion fails.
    """
    if len(audio_bytes) < 400:
        log.debug("convert_to_wav: input too small (%d bytes)", len(audio_bytes))
        return None

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return None

    suffix = input_suffix if input_suffix.startswith(".") else f".{input_suffix}"
    if suffix == ".webm" and not _looks_like_webm(audio_bytes):
        log.warning(
            "convert_to_wav: missing WebM header (bytes=%d, head=%r) — trying other containers",
            len(audio_bytes),
            audio_bytes[:8],
        )

    with tempfile.TemporaryDirectory() as tmp:
        dst = Path(tmp) / "output.wav"
        last_code: int | None = None
        last_stderr = ""
        for try_suffix in _suffixes_to_try(audio_bytes, suffix):
            src = Path(tmp) / f"input{try_suffix}"
            src.write_bytes(audio_bytes)
            for input_args in _FFMPEG_INPUT_STRATEGIES:
                dst.unlink(missing_ok=True)
                try:
                    proc = subprocess.run(
                        [ffmpeg, "-y", *input_args, "-i", str(src), *_WAV_OUTPUT_ARGS, str(dst)],
                        capture_output=True,
                        timeout=120,
                        check=False,
                    )
                    last_code = proc.returncode
                    last_stderr = proc.stderr.decode("utf-8", errors="replace")
                    if proc.returncode == 0 and dst.exists():
                        out = dst.read_bytes()
                        if len(out) >= 128:
                            return out
                except (subprocess.TimeoutExpired, OSError) as exc:
                    log.debug("ffmpeg strategy %s error: %s", input_args[:2], exc)
            src.unlink(missing_ok=True)

        log.warning(
            "ffmpeg conversion failed (code=%s, bytes=%d): %s",
            last_code,
            len(audio_bytes),
            last_stderr[:500],
        )
        return None


def convert_to_ogg_opus(audio_bytes: bytes, *, input_suffix: str = ".mp3") -> bytes | None:
    """
    Convert arbitrary audio to OGG/Opus — the format Telegram `sendVoice` needs to
    render a native voice-message bubble. Returns None if ffmpeg is unavailable or
    conversion fails (caller falls back to a text reply).
    """
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return None

    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / f"input{input_suffix}"
        dst = Path(tmp) / "output.ogg"
        src.write_bytes(audio_bytes)
        try:
            proc = subprocess.run(
                [
                    ffmpeg,
                    "-y",
                    "-i", str(src),
                    "-ac", "1",
                    "-c:a", "libopus",
                    "-b:a", "32k",
                    "-f", "ogg",
                    str(dst),
                ],
                capture_output=True,
                timeout=120,
                check=False,
            )
            if proc.returncode != 0 or not dst.exists():
                log.warning(
                    "ffmpeg ogg/opus conversion failed (code=%s): %s",
                    proc.returncode,
                    proc.stderr.decode("utf-8", errors="replace")[:500],
                )
                return None
            return dst.read_bytes()
        except (subprocess.TimeoutExpired, OSError) as exc:
            log.warning("ffmpeg ogg/opus conversion error: %s", exc)
            return None
