"""Tests for knowledge graph user actions."""
from __future__ import annotations

import asyncio

from briefly_api.db.models import UserProfile
from briefly_api.services.graph_actions import boost_topic, mute_topic


def test_boost_topic_creates_cluster():
    profile = UserProfile(user_id="u1", topic_clusters=[])
    result = asyncio.run(boost_topic(profile, "Agentic AI"))
    assert result["action"] == "boost"
    assert result["strength"] == 0.55
    assert any(c.get("cluster") == "Agentic AI" for c in profile.topic_clusters)


def test_boost_topic_increases_existing():
    profile = UserProfile(
        user_id="u1",
        topic_clusters=[{"cluster": "Agentic AI", "strength": 0.5, "item_count": 3}],
    )
    result = asyncio.run(boost_topic(profile, "Agentic AI"))
    assert result["strength"] == 0.65


def test_mute_topic_adds_never_show():
    profile = UserProfile(
        user_id="u1",
        topic_clusters=[{"cluster": "Sports", "strength": 0.4, "item_count": 2}],
        never_show=[],
    )
    result = asyncio.run(mute_topic(profile, "Sports"))
    assert result["action"] == "mute"
    assert "sports" in profile.never_show
