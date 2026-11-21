from app.risk import build_risk_signals, calculate_risk


def test_missing_metrics_risk():
    checks = type("Checks", (), {})()
    checks = [
        type("Check", (), {"name": "pace_available", "result": "missing", "severity": "medium"})()
    ]
    signals = build_risk_signals(
        {"distance_km": None, "duration_seconds": None, "pace_seconds_per_km": None},
        checks,
        [],
    )
    score, level, reasons = calculate_risk(signals)
    assert score >= 15
    assert level in {"low", "moderate", "high"}
    assert reasons


def test_duplicate_risk():
    signals = build_risk_signals(
        {"distance_km": 5, "duration_seconds": 1800, "pace_seconds_per_km": 360},
        [],
        [],
        duplicate={"exact": True, "visually_similar": True},
    )
    signal = next(signal for signal in signals if signal.name == "potential_duplicate")
    assert signal.triggered is True
