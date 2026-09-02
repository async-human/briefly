from briefly_api.services.intelligence_gates import gate_metric


def test_gate_refuses_to_pass_without_sample():
    metric = gate_metric(
        value=1.0, target=0.75, direction="at_least",
        numerator=2, denominator=2, minimum_sample=20,
    )
    assert metric["status"] == "insufficient_data"


def test_at_least_gate():
    assert gate_metric(
        value=0.8, target=0.75, direction="at_least",
        numerator=16, denominator=20, minimum_sample=20,
    )["status"] == "pass"


def test_at_most_gate():
    assert gate_metric(
        value=0.2, target=0.15, direction="at_most",
        numerator=4, denominator=20, minimum_sample=20,
    )["status"] == "fail"
