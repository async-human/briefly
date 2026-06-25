"""Spoken persona helpers — consistent Briefly voice across tools and RAG."""
from __future__ import annotations

import re

VOICE_CONVERSATION_SUFFIX = (
    " Sound like a thoughtful colleague in a live conversation — warm, natural, not robotic. "
    "If the user's request is ambiguous or missing a key detail, ask ONE short clarifying "
    "question instead of guessing. The user already heard a brief acknowledgment — do not "
    "repeat 'sure' or 'got it'; go straight to the answer or your question."
)


def polish_spoken_answer(text: str, *, max_chars: int = 2400) -> str:
    """Normalize tool output for TTS."""
    out = (text or "").strip()
    if not out:
        return out
    out = re.sub(r"\*\*(.+?)\*\*", r"\1", out)
    out = re.sub(r"`([^`]+)`", r"\1", out)
    out = re.sub(r"^\s*[-*]\s+", "", out, flags=re.MULTILINE)
    out = re.sub(r"\n{3,}", "\n\n", out)
    if len(out) > max_chars:
        out = out[: max_chars - 1].rsplit(" ", 1)[0] + "…"
    return out.strip()


def chunk_for_streaming(text: str, *, chunk_size: int = 48) -> list[str]:
    """Split spoken text into small deltas so TTS can start early."""
    polished = polish_spoken_answer(text)
    if not polished:
        return []
    if len(polished) <= chunk_size * 2:
        return [polished]
    parts: list[str] = []
    for sentence in re.split(r"(?<=[.!?])\s+", polished):
        s = sentence.strip()
        if not s:
            continue
        if len(s) <= chunk_size * 3:
            parts.append(s + (" " if not s.endswith((".", "!", "?")) else ""))
        else:
            words = s.split()
            buf: list[str] = []
            for w in words:
                buf.append(w)
                if len(" ".join(buf)) >= chunk_size:
                    parts.append(" ".join(buf) + " ")
                    buf = []
            if buf:
                parts.append(" ".join(buf))
    merged: list[str] = []
    for p in parts:
        if merged and len(p) < 12:
            merged[-1] = merged[-1] + p
        else:
            merged.append(p)
    return merged if merged else [polished]
