"""Tests for Ask Briefly retrieval helpers."""
from __future__ import annotations

from briefly_api.services.ask_briefly import (
    _extract_citations,
    _format_context_pack,
    _split_article_passages,
    is_saved_unread_query,
    rank_by_similarity,
    ContextChunk,
)


def test_rank_by_similarity_orders_results():
    query = [1.0, 0.0, 0.0]
    candidates = [
        ("a", [1.0, 0.0, 0.0]),
        ("b", [0.0, 1.0, 0.0]),
        ("c", [0.9, 0.1, 0.0]),
    ]
    ranked = rank_by_similarity(query, candidates, limit=2)
    assert ranked[0][0] == "a"
    assert ranked[1][0] == "c"


def test_rank_by_similarity_excludes_ids():
    query = [1.0, 0.0]
    candidates = [("a", [1.0, 0.0]), ("b", [1.0, 0.0])]
    ranked = rank_by_similarity(query, candidates, limit=5, exclude_ids={"a"})
    assert ranked[0][0] == "b"


def test_extract_citations_from_answer():
    chunks = [
        ContextChunk("S1", "c1", "Title A", None, None, "snippet", "article"),
        ContextChunk("S2", "c2", "Title B", None, None, "snippet", "article"),
    ]
    answer = "You read about this in [S1] and also [S2]."
    cites = _extract_citations(answer, chunks)
    assert len(cites) == 2
    assert cites[0]["ref"] == "S1"
    assert cites[1]["content_id"] == "c2"


def test_extract_citations_falls_back_to_context_chunks():
    chunks = [
        ContextChunk("S1", "c1", "Title A", None, None, "snippet", "article"),
    ]
    answer = "Here is a summary without inline citation markers."
    cites = _extract_citations(answer, chunks)
    assert len(cites) == 1
    assert cites[0]["ref"] == "S1"
    assert cites[0]["title"] == "Title A"


def test_is_saved_unread_query_detects_backlog_questions():
    assert is_saved_unread_query("What did I save recently that I haven't read yet?")
    assert is_saved_unread_query("show my unread saves")
    assert not is_saved_unread_query("Summarize my active story threads.")


def test_split_article_passages_splits_long_body():
    intro = "Nine Indian startups joined the WEF cohort."
    names = "The companies are AlphaTech, BetaLabs, GammaAI, DeltaBio, EpsilonPay, ZetaCloud, EtaHealth, ThetaMobility, and IotaEnergy."
    filler = " ".join(["context"] * 120)
    body = f"{intro}\n\n{filler}\n\n{names}"
    passages = _split_article_passages(body)
    assert len(passages) >= 2
    joined = "\n".join(passages)
    assert "AlphaTech" in joined
    assert "Nine Indian startups" in joined


def test_split_article_passages_keeps_short_body_intact():
    text = "Short article with two names: FooCorp and BarInc."
    assert _split_article_passages(text) == [text]


def test_format_context_pack_includes_ref():
    chunks = [
        ContextChunk("S1", "c1", "Hello", "https://x.com", "Src", "Body", "article"),
    ]
    pack = _format_context_pack(chunks)
    assert "[S1]" in pack
    assert "Hello" in pack
