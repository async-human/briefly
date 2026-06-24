"""
Detect questions about the user's full article library / saved corpus.

Used by orb routing (force ask_briefly) and RAG prep (wider retrieval, no bad anchors).
"""
from __future__ import annotations

import re

# Questions about content in the user's library — not today's brief or unread queue only.
_CORPUS_LIBRARY_RE = re.compile(
    r"(?:"
    r"(?:my|our|the|your)\s+(?:library|collection|corpus|knowledge\s+base|sources|content|articles|reads|saves)|"
    r"(?:articles?|content|pieces?|reads?|sources?|items?|stuff)\s+(?:we|i|you)\s+(?:have|saved|got|keep)|"
    r"(?:what|which|any|show|list|tell\s+me\s+about|find|give\s+me).{0,48}"
    r"(?:articles?|content|pieces?|reads?|sources?|items?)|"
    r"(?:interesting|best|top|good|great|relevant|related|latest|recent).{0,32}"
    r"(?:articles?|content|reads?|pieces?)|"
    r"(?:articles?|content|reads?|pieces?|sources?).{0,24}(?:about|on|regarding|related\s+to|for)\s+\w|"
    r"what\s+do\s+i\s+have\s+(?:on|about)|"
    r"anything\s+(?:on|about).{0,40}(?:in|from)\s+(?:my|our|the)?\s*(?:library|articles|content|sources|saves)|"
    r"(?:in|from|across)\s+(?:my|our|the)\s+(?:library|articles|content|sources|saved)|"
    r"do\s+(?:we|i)\s+have\s+(?:any|anything).{0,30}(?:about|on|regarding)"
    r")",
    re.IGNORECASE,
)

# Narrow queue/list intent — handled by saved_queue tool or saved-unread RAG mode.
_SAVED_QUEUE_ONLY_RE = re.compile(
    r"(?:"
    r"(?:saved|unread)\s+(?:queue|list|backlog)|"
    r"reading\s+list|read(?:ing)?\s+(?:list|queue|backlog)|"
    r"haven'?t\s+read|have\s+not\s+read|not\s+read\s+yet|"
    r"what(?:'s| is)?\s+(?:in\s+)?(?:my\s+)?(?:saved|unread)\s+(?:queue|list|backlog)"
    r")",
    re.IGNORECASE,
)

_TOPIC_STOP = frozenset(
    {
        "a", "an", "the", "any", "some", "what", "which", "who", "how", "when", "where",
        "why", "is", "are", "was", "were", "do", "does", "did", "have", "has", "had",
        "i", "we", "you", "my", "our", "your", "me", "about", "on", "for", "of", "in",
        "to", "and", "or", "with", "from", "at", "it", "this", "that", "there", "be",
        "can", "could", "would", "should", "tell", "give", "show", "list", "find",
        "articles", "article", "content", "reads", "read", "sources", "source", "items",
        "item", "stuff", "things", "interesting", "best", "top", "latest", "recent",
        "related", "regarding", "library", "saved", "have", "got", "keep", "most",
        "really", "please", "briefly", "hey", "chance", "anything", "something",
    }
)


def is_saved_queue_only_query(message: str) -> bool:
    """True for unread/saved-queue listing — not broad corpus Q&A."""
    return bool(_SAVED_QUEUE_ONLY_RE.search((message or "").strip()))


def is_corpus_library_query(message: str) -> bool:
    """True when the user is asking about their saved articles/content overall."""
    text = (message or "").strip()
    if not text:
        return False
    if is_saved_queue_only_query(text):
        return False
    return bool(_CORPUS_LIBRARY_RE.search(text))


def extract_topic_terms(message: str, *, max_terms: int = 6) -> list[str]:
    """Extract likely topic keywords from a library question (e.g. 'ai' from 'articles about AI')."""
    text = (message or "").lower()
    tokens = re.findall(r"[a-z0-9][a-z0-9\-\+]{1,}", text)
    out: list[str] = []
    for tok in tokens:
        if tok in _TOPIC_STOP or len(tok) < 2:
            continue
        if tok not in out:
            out.append(tok)
        if len(out) >= max_terms:
            break
    return out
