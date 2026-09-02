from briefly_api.services.decisions.outcomes import VALID_OUTCOMES, VALID_SOURCES


def test_outcome_contract_covers_decision_and_action_moments():
    assert {"changed", "confirmed", "action_planned", "acted", "no_change"} == VALID_OUTCOMES
    assert {"glance", "read", "ask", "timeline"} == VALID_SOURCES
