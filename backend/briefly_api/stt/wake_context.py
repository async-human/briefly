"""STT prompts and tuning for wake-word and barge-in listening modes."""

from __future__ import annotations

WAKE_STT_PROMPT = (
    'Wake phrase detection only. The user says "hey briefly" or "hi briefly" '
    "to wake a voice assistant named Briefly. "
    "Expected vocabulary: hey briefly, hi briefly, hay briefly, hey brief, hi brief, briefly"
)

BARGE_IN_STT_PROMPT = (
    "The user is interrupting a speaking voice assistant. "
    "Transcribe only clear human speech directed at the assistant. "
    "Ignore background noise and echo of the assistant's own voice."
)

WAKE_KEYTERMS: tuple[str, ...] = (
    "hey briefly",
    "hi briefly",
    "hay briefly",
    "hey brief",
    "hi brief",
    "briefly",
    "brieflee",
    "breifly",
)

# Faster endpointing for wake / barge-in (ms).
WAKE_ENDPOINTING_MS = 240
WAKE_UTTERANCE_END_MS = 880
BARGE_IN_ENDPOINTING_MS = 220
BARGE_IN_UTTERANCE_END_MS = 720
