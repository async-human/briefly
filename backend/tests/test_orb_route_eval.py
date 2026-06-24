"""Eval: orb intent routing matches expected tools for common spoken phrases."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from briefly_api.services.orb_intent import classify_orb_intent

EVAL_PATH = Path(__file__).parent / "eval" / "orb_route_eval.json"


def _cases():
    raw = json.loads(EVAL_PATH.read_text(encoding="utf-8"))
    return [(c["transcript"], c) for c in raw]


@pytest.mark.parametrize("transcript,case", _cases())
def test_orb_route_eval(transcript, case):
    decision = asyncio.run(
        classify_orb_intent(
            transcript,
            thread_message_count=0,
            session=None,
            session_has_prior_turn=False,
        )
    )
    if "expect_tool" in case:
        names = [t.name for t in decision.tools]
        assert case["expect_tool"] in names or (
            decision.kind == "direct" and names == [case["expect_tool"]]
        ), f"{transcript!r} → {decision.kind} {names} ({decision.reason})"
    if "expect_kind" in case:
        assert decision.kind == case["expect_kind"], (
            f"{transcript!r} → {decision.kind} ({decision.reason})"
        )
