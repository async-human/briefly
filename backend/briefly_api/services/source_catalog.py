"""
briefly_api/services/source_catalog.py

Curated RSS feed catalog, organised by topic.
Used to suggest sources to users based on their declared interests.

To add a new feed: add an entry to _CATALOG. Source type is always "rss"
unless explicitly set to "url" for sites that need full-page scraping.
"""
from __future__ import annotations

_CATALOG: list[dict] = [
    # ── AI & Machine Learning ─────────────────────────────────────────────────
    {"name": "The Rundown AI", "url": "https://www.therundown.ai/rss",
     "topic": "ai", "description": "Daily AI news digest with curated highlights"},
    {"name": "Simon Willison's Blog", "url": "https://simonwillison.net/atom/everything/",
     "topic": "ai", "description": "Hands-on AI/LLM engineering by a leading practitioner"},
    {"name": "Lenny's Newsletter", "url": "https://www.lennysnewsletter.com/feed",
     "topic": "product", "description": "Product management, growth, and career advice"},
    {"name": "Hacker News (Best)", "url": "https://news.ycombinator.com/rss",
     "topic": "technology", "description": "Top stories from the tech community"},
    {"name": "MIT Technology Review", "url": "https://www.technologyreview.com/feed/",
     "topic": "ai", "description": "Authoritative AI and tech research coverage"},
    {"name": "The Batch (DeepLearning.AI)", "url": "https://www.deeplearning.ai/the-batch/feed/",
     "topic": "ai", "description": "Andrew Ng's weekly AI news and analysis"},
    {"name": "Interconnects (Nathan Lambert)", "url": "https://www.interconnects.ai/feed",
     "topic": "ai", "description": "Deep dives into AI research and frontier models"},

    # ── Startups & Venture Capital ────────────────────────────────────────────
    {"name": "Paul Graham Essays", "url": "http://www.paulgraham.com/rss.html",
     "topic": "startups", "description": "Essays on startups and life by YC co-founder"},
    {"name": "Both Sides of the Table (Mark Suster)", "url": "https://bothsidesofthetable.com/feed",
     "topic": "startups", "description": "VC perspective on startups, fundraising, and scale"},
    {"name": "SaaStr", "url": "https://www.saastr.com/feed/",
     "topic": "saas", "description": "Scaling SaaS from $0 to $100M ARR"},
    {"name": "The Information (free)", "url": "https://www.theinformation.com/feed",
     "topic": "startups", "description": "Premium tech startup coverage"},
    {"name": "First Round Review", "url": "https://review.firstround.com/feed.xml",
     "topic": "startups", "description": "Tactical advice from First Round portfolio companies"},
    {"name": "a16z Blog", "url": "https://a16z.com/feed/",
     "topic": "venture capital", "description": "Andreessen Horowitz on tech trends and investing"},
    {"name": "YC Blog", "url": "https://www.ycombinator.com/blog/rss.xml",
     "topic": "startups", "description": "Y Combinator founder advice and company news"},

    # ── India Tech & Business ─────────────────────────────────────────────────
    {"name": "Inc42", "url": "https://inc42.com/feed/",
     "topic": "india startups", "description": "India's startup ecosystem — funding, founders, policy"},
    {"name": "YourStory", "url": "https://yourstory.com/feed",
     "topic": "india startups", "description": "Startup stories and funding news from India"},
    {"name": "The Ken", "url": "https://the-ken.com/feed/",
     "topic": "india business", "description": "In-depth business journalism for the Indian market"},
    {"name": "Entrackr", "url": "https://entrackr.com/feed/",
     "topic": "india startups", "description": "India startup funding data and financial analysis"},

    # ── Product & Design ──────────────────────────────────────────────────────
    {"name": "Product Hunt", "url": "https://www.producthunt.com/feed",
     "topic": "product", "description": "The latest product launches every day"},
    {"name": "UX Collective", "url": "https://uxdesign.cc/feed",
     "topic": "design", "description": "UX design thinking, case studies, and tools"},
    {"name": "Nielsen Norman Group", "url": "https://feeds.feedburner.com/nngroup/news",
     "topic": "design", "description": "Evidence-based UX research and best practices"},
    {"name": "Julie Zhuo (The Looking Glass)", "url": "https://joulee.medium.com/feed",
     "topic": "product", "description": "Product leadership from a former Facebook VP of Design"},

    # ── Engineering & Dev ─────────────────────────────────────────────────────
    {"name": "The Pragmatic Engineer", "url": "https://newsletter.pragmaticengineer.com/feed",
     "topic": "engineering", "description": "Inside big tech and high-growth startups — engineering culture and craft"},
    {"name": "Martin Fowler", "url": "https://martinfowler.com/feed.atom",
     "topic": "engineering", "description": "Software design, architecture, and agile from a legend"},
    {"name": "GitHub Blog", "url": "https://github.blog/feed/",
     "topic": "engineering", "description": "GitHub product updates, developer stories, and open source"},
    {"name": "Dev.to", "url": "https://dev.to/feed",
     "topic": "engineering", "description": "Community-driven developer articles and tutorials"},

    # ── Finance & Business ────────────────────────────────────────────────────
    {"name": "Stratechery", "url": "https://stratechery.com/feed/",
     "topic": "business strategy", "description": "Ben Thompson on business and tech strategy"},
    {"name": "Morgan Housel (Collaborative Fund)", "url": "https://collabfund.com/blog/rss/",
     "topic": "finance", "description": "Psychology of money, investing, and long-term thinking"},
    {"name": "Matt Levine (Bloomberg Money Stuff)", "url": "https://feeds.bloomberg.com/authors/Cl4MTfhAlCc/news.rss",
     "topic": "finance", "description": "Financial markets and deals explained with wit"},
    {"name": "The Hustle", "url": "https://thehustle.co/feed/",
     "topic": "business", "description": "Business and tech news explained simply"},

    # ── Health & Science ──────────────────────────────────────────────────────
    {"name": "Nature News", "url": "https://www.nature.com/nature.rss",
     "topic": "science", "description": "Landmark scientific research and discoveries"},
    {"name": "Huberman Lab Podcast Notes", "url": "https://hubermanlab.com/feed/podcast/",
     "topic": "health", "description": "Neuroscience and health protocols from Stanford"},
    {"name": "Ars Technica Science", "url": "https://feeds.arstechnica.com/arstechnica/science",
     "topic": "science", "description": "In-depth science and technology journalism"},

    # ── Global Tech News ──────────────────────────────────────────────────────
    {"name": "TechCrunch", "url": "https://techcrunch.com/feed/",
     "topic": "technology", "description": "Breaking news on startups and big tech"},
    {"name": "Wired", "url": "https://www.wired.com/feed/rss",
     "topic": "technology", "description": "Technology's impact on culture, society, and the future"},
    {"name": "The Verge", "url": "https://www.theverge.com/rss/index.xml",
     "topic": "technology", "description": "Consumer tech, gadgets, and digital culture"},
    {"name": "ArXiv AI (cs.AI)", "url": "https://rss.arxiv.org/rss/cs.AI",
     "topic": "ai research", "description": "Latest AI research papers as they are published"},
]


def get_suggestions(
    user_interests: list[str],
    already_added_urls: set[str],
    limit: int = 8,
) -> list[dict]:
    """
    Return up to `limit` suggested sources that:
    1. Haven't already been added by the user.
    2. Are ranked by relevance to the user's declared interests (simple keyword match).
    3. Fall back to a curated default mix if interests are empty.
    """
    already_lower = {u.lower() for u in already_added_urls}
    interest_text = " ".join(user_interests).lower()

    def _score(entry: dict) -> int:
        if entry["url"].lower() in already_lower:
            return -1
        if not interest_text:
            return 0
        score = 0
        topic = entry["topic"].lower()
        name = entry["name"].lower()
        desc = entry["description"].lower()
        for word in interest_text.split():
            if len(word) < 3:
                continue
            if word in topic:
                score += 3
            if word in name:
                score += 2
            if word in desc:
                score += 1
        return score

    scored = [
        (entry, _score(entry))
        for entry in _CATALOG
        if _score(entry) >= 0
    ]
    scored.sort(key=lambda x: x[1], reverse=True)

    results = []
    for entry, _ in scored[:limit]:
        results.append({
            "name": entry["name"],
            "url": entry["url"],
            "source_type": "rss",
            "topic": entry["topic"],
            "description": entry["description"],
        })
    return results
