"""Tests for Gmail search query building."""
from __future__ import annotations

from briefly_api.services.gmail_read import _clean_gmail_query, extract_gmail_search_query


def test_extract_emails_from_sender():
    q = extract_gmail_search_query("So any emails from, briefly?", None)
    assert "briefly" in q.lower()


def test_clean_strips_filler_and_adds_from_prefix():
    assert _clean_gmail_query("Mitralabs maybe") == "from:Mitralabs"
    assert _clean_gmail_query("from:mitralabs") == "from:mitralabs"


def test_extract_mitralabs_phrase():
    q = extract_gmail_search_query("Got it. Any emails from Mitralabs maybe?", None)
    assert "mitralabs" in q.lower()
