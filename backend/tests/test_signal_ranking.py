from briefly_api.services.signals.ranking import PreferenceProfile, score_signal, source_domain


def _score(profile=None, **overrides):
    values = dict(
        confidence=0.9,
        relevance=0.9,
        evidence_count=2,
        is_material_change=True,
        is_state_change=True,
        is_urgent=False,
        decision_connected=False,
        detector_type="pricing_positioning",
        entity_id="acme",
        source_url="https://www.acme.com/pricing",
        profile=profile,
    )
    values.update(overrides)
    return score_signal(**values)


def test_priority_is_bounded_and_explainable():
    score, factors = _score()
    assert 0 <= score <= 1
    assert factors["version"] == "transparent-v1"
    assert factors["reasons"]


def test_feedback_moves_priority_without_overpowering_evidence():
    liked = PreferenceProfile(detector={"pricing_positioning": (4.0, 4)})
    disliked = PreferenceProfile(detector={"pricing_positioning": (-4.0, 4)})
    high, high_factors = _score(liked)
    low, low_factors = _score(disliked)
    assert high > low
    assert high - low <= 0.15
    assert "adapted from your signal ratings" in high_factors["reasons"]
    assert low_factors["feedback_samples"] == 4


def test_decision_connection_ranks_above_equal_unconnected_signal():
    base, _ = _score(decision_connected=False)
    connected, _ = _score(decision_connected=True)
    assert connected > base


def test_domain_normalization():
    assert source_domain("https://www.example.com/a") == "example.com"
    assert source_domain("not a url") == ""
