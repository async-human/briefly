"""Tests for embedding-based + collaborative source recommendation."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

from briefly_api.db.models import SourceStatus
from briefly_api.services import source_recommendation as sr


# ── Vector helpers ──────────────────────────────────────────────────────────────

def test_cosine():
    assert round(sr._cosine([1, 2, 3], [1, 2, 3]), 3) == 1.0
    assert round(sr._cosine([1, 0], [0, 1]), 3) == 0.0
    assert sr._cosine([], [1]) == 0.0


def test_mean():
    assert sr._mean([[2, 4], [4, 8]]) == [3.0, 6.0]
    assert sr._mean([]) is None


# ── Fakes ────────────────────────────────────────────────────────────────────────

class _Result:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows

    def scalars(self):
        return SimpleNamespace(all=lambda: [r[0] if isinstance(r, tuple) else r for r in self._rows])


class _Session:
    """Returns queued results in call order."""
    def __init__(self, results):
        self._results = list(results)

    async def execute(self, *_a, **_k):
        return self._results.pop(0)


def _src(uid, stype, ident, name=None):
    return SimpleNamespace(id=ident, user_id=uid, source_type=stype, identifier=ident, name=name or ident, status=SourceStatus.active)


# ── Collaborative filtering ──────────────────────────────────────────────────────

def test_collaborative_recommends_shared_neighbor_sources():
    me = "u1"
    mine = [_src(me, "rss", "feedA"), _src(me, "rss", "feedB")]
    # neighbours u2,u3 both share feedA with me
    shared = [("u2", "rss", "feedA"), ("u3", "rss", "feedA")]
    # neighbour sources: both follow feedC (the recommendation), u2 also has a unique feedD
    neighbour_sources = [
        _src("u2", "rss", "feedC", "Feed C"),
        _src("u3", "rss", "feedC", "Feed C"),
        _src("u2", "rss", "feedD", "Feed D"),
        _src("u2", "rss", "feedA"),  # already mine — must be filtered
    ]
    session = _Session([_Result(mine), _Result(shared), _Result(neighbour_sources)])

    recs = asyncio.run(sr.collaborative_recommendations(session, me, min_neighbors=2))
    urls = [r["url"] for r in recs]
    # feedC shared by 2 neighbours -> recommended; feedD only 1 -> excluded (k-anon); feedA mine -> excluded
    assert "feedC" in urls
    assert "feedD" not in urls
    assert "feedA" not in urls
    assert recs[0]["method"] == "readers_like_you"
    assert recs[0]["neighbours"] == 2


def test_collaborative_empty_without_sources():
    session = _Session([_Result([])])
    assert asyncio.run(sr.collaborative_recommendations(session, "u1")) == []


# ── Content similarity ───────────────────────────────────────────────────────────

def test_attach_content_similarity(monkeypatch):
    candidates = [
        {"name": "AI Weekly", "topic": "ai", "url": "x"},
        {"name": "Garden Tips", "topic": "gardening", "url": "y"},
    ]
    taste = [1.0, 0.0]

    class _Emb:
        async def embed_batch(self, texts):
            # First candidate aligns with taste vector, second is orthogonal.
            return [[1.0, 0.0], [0.0, 1.0]]

    monkeypatch.setattr(sr, "get_embedding_adapter", lambda *_a, **_k: _Emb())
    ranked = asyncio.run(sr.attach_content_similarity(candidates, taste, settings=None))
    assert ranked[0]["similarity"] == 1.0
    assert ranked[1]["similarity"] == 0.0


def test_attach_similarity_no_taste_vector():
    candidates = [{"name": "X", "url": "x"}]
    out = asyncio.run(sr.attach_content_similarity(candidates, None, settings=None))
    assert out[0]["similarity"] == 0.0


# ── Orchestration ────────────────────────────────────────────────────────────────

def test_recommend_sources_blends_and_dedups(monkeypatch):
    async def _fake_collab(session, user_id, **kw):
        return [{"name": "Feed C", "url": "feedC", "source_type": "rss",
                 "method": "readers_like_you", "collab_score": 3.0, "neighbours": 3,
                 "reason": "readers like you"}]

    async def _fake_interest(profile, settings, **kw):
        return [
            {"name": "Feed C", "url": "feedC", "source_type": "rss", "topic": "ai",
             "description": "dup", "method": "interest"},  # duplicate of collab
            {"name": "Feed E", "url": "feedE", "source_type": "rss", "topic": "ml",
             "description": "interest pick", "method": "interest"},
            {"name": "Owned", "url": "feedOwned", "source_type": "rss", "topic": "x",
             "description": "already added", "method": "interest"},
        ]

    async def _fake_taste(session, user_id, profile):
        return [1.0, 0.0]

    async def _fake_attach(candidates, taste, settings):
        for c in candidates:
            c["similarity"] = 0.9 if c["url"] == "feedE" else 0.1
        return candidates

    import briefly_api.services.external_feed_discovery as efd
    monkeypatch.setattr(efd, "discover_interest_suggestions_light", _fake_interest)
    monkeypatch.setattr(sr, "collaborative_recommendations", _fake_collab)
    monkeypatch.setattr(sr, "user_taste_vector", _fake_taste)
    monkeypatch.setattr(sr, "attach_content_similarity", _fake_attach)

    recs = asyncio.run(sr.recommend_sources(
        session=None, user_id="u1", settings=None, profile={},
        already_added={"feedowned"},
    ))
    urls = [r["url"] for r in recs]
    assert "feedOwned" not in urls         # already-added filtered
    assert urls.count("feedC") == 1        # deduped
    assert "feedE" in urls
    assert all("score" in r for r in recs)  # blended score attached
