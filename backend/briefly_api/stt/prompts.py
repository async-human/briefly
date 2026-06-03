"""Build STT prompts with user-specific vocabulary for technical terms."""
from __future__ import annotations

_BASE_PROMPT = (
    "Transcribe spoken English accurately with proper punctuation, capitalization, "
    "paragraph breaks, and bullet points when the speaker lists multiple items. "
    "Preserve technical terms, product names, acronyms, and proper nouns exactly. "
    "Ignore background noise — transcribe only the primary speaker."
)

# Common terms users mis-hear without vocabulary hints (Whisper prompt, max ~224 tokens).
_DEFAULT_VOCAB = (
    "LLM, RAG, API, SaaS, PMF, GPU, Kubernetes, PostgreSQL, Redis, OAuth, "
    "embeddings, fine-tuning, inference, vector database, agentic AI, OpenAI, Anthropic."
)

_MAX_PROMPT_CHARS = 900  # ~224 tokens for Whisper-style prompts


def build_transcription_prompt(
    *,
    role: str | None = None,
    interests: list[str] | None = None,
    topic_clusters: list[dict] | None = None,
    extra_terms: list[str] | None = None,
) -> str:
    """Merge base instructions with user/domain vocabulary for STT spelling hints."""
    terms: list[str] = []

    if role:
        terms.append(role.strip())

    for topic in interests or []:
        t = (topic or "").strip()
        if t and t not in terms:
            terms.append(t)

    if topic_clusters:
        from briefly_api.services.profile_utils import cluster_label

        for cluster in topic_clusters[:8]:
            label = cluster_label(cluster)
            if label and label not in terms:
                terms.append(label)

    for term in extra_terms or []:
        t = (term or "").strip()
        if t and t not in terms:
            terms.append(t)

    if not terms:
        vocab = _DEFAULT_VOCAB
    else:
        vocab = ", ".join(terms[:24])
        if len(vocab) < 400:
            vocab = f"{vocab}, {_DEFAULT_VOCAB}"

    prompt = f"{_BASE_PROMPT} Expected vocabulary: {vocab}."
    return prompt[:_MAX_PROMPT_CHARS]
