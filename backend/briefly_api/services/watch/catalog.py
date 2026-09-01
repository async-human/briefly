"""Curated watch sources + alias / keyword expansion."""
from __future__ import annotations

from urllib.parse import quote_plus

# Official-ish feeds for companies founders actually watch. Google News is
# always added as a fallback so unknown names (Cummins, Sarvam, …) still work.
COMPANY_CATALOG: dict[str, dict] = {
    "openai": {
        "name": "OpenAI",
        "aliases": ["Open AI", "openai.com"],
        "blog": "https://openai.com/news/rss.xml",
        "github": "openai",
        "pages": {
            "pricing": "https://openai.com/api/pricing/",
        },
    },
    "anthropic": {
        "name": "Anthropic",
        "aliases": ["AnthropicAI", "Claude"],
        "github": "anthropics",
        "pages": {
            "pricing": "https://claude.com/pricing",
            "docs": "https://platform.claude.com/docs/en/about-claude/models/overview",
            "changelog": "https://platform.claude.com/docs/en/release-notes/overview",
        },
    },
    "google deepmind": {
        "name": "Google DeepMind",
        "aliases": ["DeepMind", "Google AI"],
        "blog": "https://deepmind.google/blog/rss.xml",
        "github": "google-deepmind",
        "pages": {
            "pricing": "https://ai.google.dev/gemini-api/docs/pricing",
        },
    },
    "meta ai": {
        "name": "Meta AI",
        "aliases": ["Meta AI", "Facebook AI", "Llama"],
        "github": "meta-llama",
    },
    "mistral": {
        "name": "Mistral",
        "aliases": ["Mistral AI"],
        "blog": "https://mistral.ai/news/rss.xml",
        "github": "mistralai",
        "pages": {
            "pricing": "https://mistral.ai/pricing",
        },
    },
    "cohere": {
        "name": "Cohere",
        "aliases": ["Cohere AI"],
        "github": "cohere-ai",
        "pages": {
            "pricing": "https://cohere.com/pricing",
        },
    },
    "xai": {
        "name": "xAI",
        "aliases": ["xAI", "Grok"],
        "github": "xai-org",
        "pages": {
            "pricing": "https://x.ai/api",
        },
    },
    "perplexity": {
        "name": "Perplexity",
        "aliases": ["Perplexity AI"],
        "pages": {
            "pricing": "https://docs.perplexity.ai/guides/pricing",
        },
    },
    "hugging face": {
        "name": "Hugging Face",
        "aliases": ["HuggingFace", "HF"],
        "blog": "https://huggingface.co/blog/feed.xml",
        "github": "huggingface",
        "pages": {
            "pricing": "https://huggingface.co/pricing",
        },
    },
    "stability ai": {
        "name": "Stability AI",
        "aliases": ["StabilityAI", "Stable Diffusion"],
        "github": "Stability-AI",
    },
    "nvidia": {
        "name": "NVIDIA",
        "aliases": ["Nvidia", "NVDA"],
        "blog": "https://blogs.nvidia.com/feed/",
    },
    "microsoft": {
        "name": "Microsoft",
        "aliases": ["MSFT", "Azure AI"],
        "blog": "https://blogs.microsoft.com/ai/feed/",
        "github": "microsoft",
    },
    "stripe": {
        "name": "Stripe",
        "blog": "https://stripe.com/blog/feed.rss",
        "github": "stripe",
        "pages": {
            "pricing": "https://stripe.com/pricing",
            "changelog": "https://docs.stripe.com/changelog",
        },
    },
    "vercel": {
        "name": "Vercel",
        "blog": "https://vercel.com/atom",
        "github": "vercel",
        "pages": {
            "pricing": "https://vercel.com/pricing",
            "changelog": "https://vercel.com/changelog",
        },
    },
    "cursor": {
        "name": "Cursor",
        "aliases": ["Cursor.sh", "Anysphere"],
        "blog": "https://cursor.com/blog/rss.xml",
        "pages": {
            "pricing": "https://cursor.com/pricing",
            "changelog": "https://cursor.com/changelog",
        },
    },
    "linear": {
        "name": "Linear",
        "blog": "https://linear.app/blog/rss.xml",
        "github": "linear",
        "pages": {
            "pricing": "https://linear.app/pricing",
            "changelog": "https://linear.app/changelog",
        },
    },
    "notion": {
        "name": "Notion",
        "blog": "https://www.notion.com/blog/rss.xml",
        "pages": {
            "pricing": "https://www.notion.com/pricing",
            "changelog": "https://www.notion.com/releases",
        },
    },
    "sarvam": {
        "name": "Sarvam",
        "aliases": ["Sarvam AI", "sarvam.ai"],
    },
    "cummins": {
        "name": "Cummins",
        "aliases": ["Cummins Inc", "Cummins Engine"],
    },
    "groq": {
        "name": "Groq",
        "github": "groq",
        "pages": {
            "pricing": "https://groq.com/pricing",
        },
    },
    "together ai": {
        "name": "Together AI",
        "aliases": ["TogetherAI"],
        "github": "togethercomputer",
        "pages": {
            "pricing": "https://www.together.ai/pricing",
        },
    },
    "fireworks": {
        "name": "Fireworks",
        "aliases": ["Fireworks AI"],
        "github": "fw-ai",
        "pages": {
            "pricing": "https://fireworks.ai/pricing",
        },
    },
    "openrouter": {
        "name": "OpenRouter",
        "aliases": ["Open Router"],
    },
}

TOPIC_KEYWORDS: dict[str, list[str]] = {
    "llm fine-tuning": ["fine-tuning", "lora", "qlora", "instruction tuning", "sft", "dpo"],
    "ai regulation": ["ai act", "ai safety", "ai governance", "ai policy", "eu ai act"],
    "ai infrastructure": ["gpu cluster", "inference", "vllm", "cuda", "h100", "b200"],
    "foundation models": ["foundation model", "frontier model", "llm release", "weights"],
    "evals": ["eval", "benchmark", "lmsys", "arena", "swe-bench"],
}

HIGH_AUTHORITY_DOMAINS = frozenset({
    "openai.com",
    "anthropic.com",
    "claude.com",
    "platform.claude.com",
    "deepmind.google",
    "ai.google",
    "ai.google.dev",
    "huggingface.co",
    "arxiv.org",
    "nature.com",
    "science.org",
    "techcrunch.com",
    "theverge.com",
    "bloomberg.com",
    "reuters.com",
    "nytimes.com",
    "wsj.com",
    "ft.com",
    "github.com",
    "nvidia.com",
    "microsoft.com",
    "stripe.com",
    "vercel.com",
})

MEDIUM_AUTHORITY_DOMAINS = frozenset({
    "wired.com",
    "arstechnica.com",
    "theinformation.com",
    "semafor.com",
    "axios.com",
    "forbes.com",
    "medium.com",
    "substack.com",
    "news.ycombinator.com",
})


def normalize_name(name: str) -> str:
    return " ".join((name or "").lower().replace("&", " and ").split())


def generate_aliases(name: str, extra: list[str] | None = None) -> list[str]:
    raw = (name or "").strip()
    out: list[str] = []
    seen: set[str] = set()

    def add(value: str) -> None:
        v = " ".join(value.split())
        if not v:
            return
        key = v.lower()
        if key in seen:
            return
        seen.add(key)
        out.append(v)

    add(raw)
    compact = raw.replace(" ", "")
    if compact.lower() != raw.lower():
        add(compact)
    dotted = raw.replace(" ", "").lower()
    if len(dotted) > 2:
        add(f"{dotted}.com")
        add(f"{dotted}.ai")
    for item in extra or []:
        add(item)
    return out


def catalog_match(name: str) -> dict | None:
    key = normalize_name(name)
    if key in COMPANY_CATALOG:
        return COMPANY_CATALOG[key]
    for entry in COMPANY_CATALOG.values():
        aliases = [entry["name"], *(entry.get("aliases") or [])]
        if any(normalize_name(a) == key for a in aliases):
            return entry
        cname = normalize_name(entry["name"])
        if len(key) >= 6 and (key == cname or key.startswith(cname) or cname.startswith(key)):
            return entry
    return None


PAGE_KINDS = ("pricing", "docs", "changelog")


def catalog_pages(name: str) -> list[tuple[str, str]]:
    """Pinned official pages for a catalog company. Never guessed."""
    entry = catalog_match(name)
    if not entry:
        return []
    pages = entry.get("pages") or {}
    out: list[tuple[str, str]] = []
    for kind in PAGE_KINDS:
        url = str(pages.get(kind) or "").strip()
        if url:
            out.append((kind, url))
    return out[:3]


def topic_terms(name: str, extra: list[str] | None = None) -> list[str]:
    key = normalize_name(name)
    terms = list(TOPIC_KEYWORDS.get(key) or [])
    for stored_key, stored_terms in TOPIC_KEYWORDS.items():
        if stored_key in key or key in stored_key:
            terms.extend(stored_terms)
    terms.extend(extra or [])
    seen: set[str] = set()
    out: list[str] = []
    for t in terms:
        low = t.lower().strip()
        if low and low not in seen:
            seen.add(low)
            out.append(t)
    return out


def google_news_url(query: str) -> str:
    q = quote_plus(f'"{query.strip()}"')
    return f"https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"


def github_atom_url(org: str) -> str:
    return f"https://github.com/{org.strip().strip('/')}.atom"


def match_terms_for(name: str, kind: str, keywords: list[str], aliases: list[str]) -> list[str]:
    terms = generate_aliases(name, aliases)
    if kind == "topic":
        terms.extend(topic_terms(name, keywords))
    else:
        terms.extend(keywords or [])
    catalog = catalog_match(name)
    if catalog:
        terms.extend(catalog.get("aliases") or [])
    seen: set[str] = set()
    out: list[str] = []
    for t in terms:
        low = t.lower().strip()
        if low and low not in seen:
            seen.add(low)
            out.append(t)
    return out
