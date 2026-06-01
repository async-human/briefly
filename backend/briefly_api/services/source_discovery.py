"""
Unified dynamic source discovery — confirm-before-add. No static catalogs.

Layer 1: Inbound email footprint (Gmail metadata → RSS / email sources)
Layer 2: Deep link hydration (newsletter HTML → outbound article URLs)
Layer 3: Connected accounts (YouTube / Reddit OAuth subscriptions)
Layer 4: Interest-driven external feeds (Google News RSS, Medium tags, Reddit/YouTube search)

All candidates pass through Personal Relevance Vector scoring before display.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone

import httpx
import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.auth.gmail import get_gmail_connection, refresh_gmail_access_token
from briefly_api.auth.reddit import get_reddit_connection, refresh_reddit_access_token
from briefly_api.auth.youtube import get_youtube_connection, refresh_youtube_access_token
from briefly_api.config import Settings, get_settings
from briefly_api.db.models import Source, UserProfile
from briefly_api.embeddings.adapter import get_embedding_adapter
from briefly_api.services.external_feed_discovery import discover_all_external
from briefly_api.services.gmail_discovery import discover_newsletter_senders
from briefly_api.services.newsletter_link_extractor import extract_outbound_links, merge_link_candidates
from briefly_api.services.profile_utils import cluster_label
from briefly_api.services.url_scraper import discover_rss_feed

log = logging.getLogger(__name__)

GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me"

RELEVANCE_AUTO_SELECT = 0.75
RELEVANCE_SHOW_LINK = 0.45

_PLATFORM_DOMAINS = frozenset({
    "substack.com", "beehiiv.com", "mailchimp.com", "convertkit.com",
    "buttondown.email", "ghost.io", "medium.com", "gmail.com",
})


def _domain_from_email(email: str) -> str:
    return email.split("@")[-1].lower().strip() if "@" in email else ""


def _is_substack_publication(domain: str) -> bool:
    parts = domain.split(".")
    return len(parts) == 3 and parts[-2] == "substack" and parts[-1] == "com"


async def _rss_for_sender(sender_email: str) -> str | None:
    domain = _domain_from_email(sender_email)
    if not domain:
        return None
    if _is_substack_publication(domain):
        return f"https://{domain}/feed"
    if domain in _PLATFORM_DOMAINS:
        return None
    try:
        return await discover_rss_feed(f"https://{domain}")
    except Exception:
        return None


def _keyword_set(profile: dict) -> set[str]:
    keywords: set[str] = set()
    for interest in profile.get("interests") or []:
        topic = (interest.get("topic") or "").lower()
        if topic:
            keywords.add(topic)
            for word in topic.split():
                if len(word) > 3:
                    keywords.add(word)
    for entry in profile.get("topic_clusters") or []:
        label = cluster_label(entry)
        if label:
            keywords.add(label.lower())
    role = (profile.get("role") or "").lower()
    goal = (profile.get("goal") or "").lower()
    if role:
        keywords.add(role)
    if goal:
        for word in goal.split():
            if len(word) > 4:
                keywords.add(word)
    return keywords


def _topic_score(text: str, keywords: set[str]) -> float:
    if not keywords:
        return 0.5
    lower = text.lower()
    matched = sum(1 for kw in keywords if kw in lower)
    if matched == 0:
        return 0.25
    return min(1.0, 0.35 + 0.15 * matched)


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    va = np.array(a)
    vb = np.array(b)
    na, nb = np.linalg.norm(va), np.linalg.norm(vb)
    if na == 0 or nb == 0:
        return 0.5
    return float((np.dot(va, vb) / (na * nb) + 1) / 2)


async def _score_text(
    text: str,
    profile: dict,
    profile_embedding: list[float] | None,
) -> float:
    keywords = _keyword_set(profile)
    topic = _topic_score(text, keywords)
    semantic = 0.5
    if profile_embedding:
        try:
            embedder = get_embedding_adapter()
            emb = await embedder.embed(text[:500])
            semantic = _cosine_similarity(profile_embedding, emb)
        except Exception as exc:
            log.debug("Discovery embed failed: %s", exc)
    final = 0.55 * semantic + 0.45 * topic
    return round(min(1.0, max(0.0, final)), 3)


def _candidate_id() -> str:
    return str(uuid.uuid4())


async def _fetch_newsletter_html_links(
    access_token: str,
    senders: list[dict],
    *,
    max_senders: int = 5,
    max_messages: int = 3,
) -> list[tuple[str, str]]:
    """Fetch recent newsletter bodies and extract outbound links."""
    headers = {"Authorization": f"Bearer {access_token}"}
    all_links: list[tuple[str, str]] = []

    async with httpx.AsyncClient(timeout=45.0, headers=headers) as client:
        for sender in senders[:max_senders]:
            email = sender.get("email", "")
            name = sender.get("name", email)
            domain = _domain_from_email(email)
            if not email:
                continue
            try:
                resp = await client.get(
                    f"{GMAIL_API}/messages",
                    params={"q": f"from:{email}", "maxResults": str(max_messages)},
                )
                resp.raise_for_status()
                msg_ids = [m["id"] for m in resp.json().get("messages", [])]
            except Exception:
                continue

            for msg_id in msg_ids:
                try:
                    msg_resp = await client.get(
                        f"{GMAIL_API}/messages/{msg_id}",
                        params={"format": "full"},
                    )
                    msg_resp.raise_for_status()
                    payload = msg_resp.json().get("payload", {})
                    html = _extract_html(payload)
                    if not html:
                        continue
                    for url in extract_outbound_links(html, sender_domain=domain):
                        all_links.append((url, name))
                except Exception:
                    continue

    return all_links


def _extract_html(payload: dict) -> str | None:
    import base64

    def decode(data: str) -> str:
        padding = "=" * (-len(data) % 4)
        return base64.urlsafe_b64decode(data + padding).decode("utf-8", errors="replace")

    mime = payload.get("mimeType", "")
    body_data = payload.get("body", {}).get("data")
    if body_data and "html" in mime:
        return decode(body_data)
    for part in payload.get("parts", []):
        if part.get("mimeType") == "text/html":
            data = part.get("body", {}).get("data")
            if data:
                return decode(data)
        if part.get("mimeType", "").startswith("multipart/"):
            nested = _extract_html(part)
            if nested:
                return nested
    return None


async def run_source_discovery(
    session: AsyncSession,
    user_id: str,
    *,
    settings: Settings | None = None,
) -> dict:
    """
    Run all discovery layers and persist candidates on the user profile.
    Returns summary with candidates list.
    """
    s = settings or get_settings()
    started = datetime.now(timezone.utc)

    profile_row = await session.execute(
        select(UserProfile).where(UserProfile.user_id == user_id)
    )
    profile = profile_row.scalar_one_or_none()
    if not profile:
        return {"success": False, "error": "Profile not found", "candidates": []}

    existing_result = await session.execute(
        select(Source.identifier, Source.source_type).where(Source.user_id == user_id)
    )
    existing_ids = {row[0].lower() for row in existing_result}
    already_emails = {
        row[0].lower() for row in existing_result if row[1] == "email"
    }

    profile_dict = {
        "role": profile.role,
        "goal": profile.goal,
        "interests": profile.interests or [],
        "topic_clusters": profile.topic_clusters or [],
        "never_show": profile.never_show or [],
    }
    profile_embedding = (
        list(profile.profile_embedding) if profile.profile_embedding is not None else None
    )

    candidates: list[dict] = []
    seen_keys: set[str] = set()

    def _add(candidate: dict) -> None:
        key = f"{candidate['source_type']}:{candidate['identifier'].lower()}"
        if key in seen_keys:
            return
        if candidate["identifier"].lower() in existing_ids:
            return
        seen_keys.add(key)
        candidates.append(candidate)

    # ── Layer 1: Inbound email footprint ────────────────────────────────────
    gmail_connection = await get_gmail_connection(session, user_id)
    senders: list[dict] = []
    access_token: str | None = None

    if gmail_connection:
        try:
            access_token = await refresh_gmail_access_token(gmail_connection, s)
            senders = await discover_newsletter_senders(access_token, already_emails)
        except Exception as exc:
            log.warning("Discovery layer 1 failed for %s: %s", user_id, exc)

    sem = asyncio.Semaphore(3)

    async def _probe_sender(sender: dict) -> None:
        email = sender.get("email", "")
        name = sender.get("name", email)
        count = sender.get("count", 1)
        async with sem:
            rss_url = await _rss_for_sender(email)
        score_text = f"{name} {email} newsletter"
        relevance = await _score_text(score_text, profile_dict, profile_embedding)
        confidence = min(0.95, 0.55 + 0.03 * min(count, 12))

        if rss_url:
            _add({
                "id": _candidate_id(),
                "name": name,
                "identifier": rss_url,
                "source_type": "rss",
                "layer": "inbound_footprint",
                "confidence": round(confidence, 3),
                "relevance_score": relevance,
                "selected": relevance >= RELEVANCE_AUTO_SELECT or count >= 4,
                "reason": f"You receive ~{count} emails from this sender — RSS feed found",
                "meta": {"sender_email": email, "email_count": count},
            })
        else:
            _add({
                "id": _candidate_id(),
                "name": name,
                "identifier": email,
                "source_type": "email",
                "layer": "inbound_footprint",
                "confidence": round(confidence, 3),
                "relevance_score": relevance,
                "selected": count >= 3,
                "reason": f"You receive ~{count} emails/month from this newsletter",
                "meta": {"sender_email": email, "email_count": count},
            })

    if senders:
        await asyncio.gather(*[_probe_sender(s) for s in senders[:25]], return_exceptions=True)

    # ── Layer 2: Deep link hydration ────────────────────────────────────────
    if access_token and senders:
        try:
            raw_links = await _fetch_newsletter_html_links(access_token, senders)
            for item in merge_link_candidates(raw_links):
                url = item["url"]
                title_text = f"{item['name']} {url} linked from {item['from_newsletter']}"
                relevance = await _score_text(title_text, profile_dict, profile_embedding)
                if relevance < RELEVANCE_SHOW_LINK:
                    continue
                rss = None
                try:
                    rss = await discover_rss_feed(url)
                except Exception:
                    pass
                identifier = rss or url
                stype = "rss" if rss else "url"
                _add({
                    "id": _candidate_id(),
                    "name": item["name"],
                    "identifier": identifier,
                    "source_type": stype,
                    "layer": "deep_link",
                    "confidence": min(0.9, 0.5 + 0.1 * item["link_count"]),
                    "relevance_score": relevance,
                    "selected": relevance >= RELEVANCE_AUTO_SELECT,
                    "reason": (
                        f"Linked {item['link_count']}× in {item['from_newsletter']} "
                        "— matches your interests" if relevance >= RELEVANCE_AUTO_SELECT
                        else f"Found in {item['from_newsletter']} (lower relevance — review optional)"
                    ),
                    "meta": {
                        "original_url": url,
                        "from_newsletter": item["from_newsletter"],
                        "link_count": item["link_count"],
                    },
                })
        except Exception as exc:
            log.warning("Discovery layer 2 failed for %s: %s", user_id, exc)

    # ── Layer 3 & 4: OAuth subscriptions + interest-driven external feeds ───
    yt_token: str | None = None
    reddit_token: str | None = None
    yt = await get_youtube_connection(session, user_id)
    reddit = await get_reddit_connection(session, user_id)
    if yt:
        try:
            yt_token = await refresh_youtube_access_token(yt, s)
            await session.commit()
        except Exception as exc:
            log.warning("YouTube token refresh for discovery failed: %s", exc)
    if reddit:
        try:
            reddit_token = await refresh_reddit_access_token(reddit, s)
            await session.commit()
        except Exception as exc:
            log.warning("Reddit token refresh for discovery failed: %s", exc)

    external_raw = await discover_all_external(
        profile_dict,
        s,
        youtube_token=yt_token,
        reddit_token=reddit_token,
    )
    for item in external_raw:
        score_text = f"{item.get('name', '')} {item.get('reason', '')}"
        relevance = await _score_text(score_text, profile_dict, profile_embedding)
        layer = item.get("layer", "interest_feed")
        # OAuth subscriptions are high-trust — always show if relevance passes bar
        min_show = 0.35 if layer in {"youtube_subscription", "reddit_subscription"} else RELEVANCE_SHOW_LINK
        if relevance < min_show:
            continue
        base_confidence = float(item.get("confidence", 0.65))
        _add({
            "id": _candidate_id(),
            "name": item["name"],
            "identifier": item["identifier"],
            "source_type": item.get("source_type", "rss"),
            "layer": layer,
            "confidence": base_confidence,
            "relevance_score": relevance,
            "selected": relevance >= RELEVANCE_AUTO_SELECT or layer in {"youtube_subscription", "reddit_subscription"},
            "reason": item.get("reason", "Discovered from your profile"),
            "meta": item.get("meta", {}),
        })

    connected_accounts = []
    if yt:
        connected_accounts.append("YouTube")
    if reddit:
        connected_accounts.append("Reddit")
    if gmail_connection:
        connected_accounts.append("Gmail")

    # Sort: selected first, then by relevance
    candidates.sort(
        key=lambda c: (not c.get("selected"), -c.get("relevance_score", 0), -c.get("confidence", 0)),
    )

    now = started
    profile.pending_source_discoveries = candidates
    profile.discovery_last_run_at = now
    profile.discovery_meta = {
        "last_run_at": now.isoformat(),
        "layer_counts": {
            "inbound_footprint": sum(1 for c in candidates if c["layer"] == "inbound_footprint"),
            "deep_link": sum(1 for c in candidates if c["layer"] == "deep_link"),
            "youtube_subscription": sum(1 for c in candidates if c["layer"] == "youtube_subscription"),
            "reddit_subscription": sum(1 for c in candidates if c["layer"] == "reddit_subscription"),
            "interest_feed": sum(1 for c in candidates if c["layer"] == "interest_feed"),
        },
        "connected_accounts": connected_accounts,
        "duration_ms": int((datetime.now(timezone.utc) - started).total_seconds() * 1000),
    }
    await session.commit()

    log.info(
        "Source discovery user=%s candidates=%d (footprint=%d links=%d yt=%d reddit=%d interest=%d)",
        user_id,
        len(candidates),
        profile.discovery_meta["layer_counts"]["inbound_footprint"],
        profile.discovery_meta["layer_counts"]["deep_link"],
        profile.discovery_meta["layer_counts"]["youtube_subscription"],
        profile.discovery_meta["layer_counts"]["reddit_subscription"],
        profile.discovery_meta["layer_counts"]["interest_feed"],
    )

    return {
        "success": True,
        "candidates": candidates,
        "connected_accounts": connected_accounts,
        "meta": profile.discovery_meta,
    }


async def confirm_discoveries(
    session: AsyncSession,
    user_id: str,
    candidate_ids: list[str],
    *,
    settings: Settings | None = None,
) -> dict:
    """Add selected candidates as sources and mark discovery confirmed."""
    _ = settings
    profile_row = await session.execute(
        select(UserProfile).where(UserProfile.user_id == user_id)
    )
    profile = profile_row.scalar_one_or_none()
    if not profile:
        return {"success": False, "error": "Profile not found", "added": []}

    pending = list(profile.pending_source_discoveries or [])
    selected = [c for c in pending if c.get("id") in candidate_ids]

    added: list[Source] = []
    for cand in selected:
        try:
            async with session.begin_nested():
                source = Source(
                    user_id=user_id,
                    source_type=cand.get("source_type", "rss"),
                    identifier=cand["identifier"],
                    name=cand.get("name"),
                    meta={
                        "discovery_layer": cand.get("layer"),
                        "discovery_confidence": cand.get("confidence"),
                        "discovery_relevance": cand.get("relevance_score"),
                        "user_confirmed": True,
                        **(cand.get("meta") or {}),
                    },
                )
                session.add(source)
                await session.flush()
                added.append(source)
        except Exception as exc:
            log.warning("confirm_discoveries: skip %s — %s", cand.get("identifier"), exc)

    now = datetime.now(timezone.utc)
    profile.sources_discovery_confirmed_at = now
    profile.pending_source_discoveries = []
    profile.discovery_meta = {
        **(profile.discovery_meta or {}),
        "confirmed_at": now.isoformat(),
        "confirmed_count": len(added),
    }

    await session.commit()
    for src in added:
        await session.refresh(src)

    return {
        "success": True,
        "added": added,
        "added_count": len(added),
    }
