from app.consistency import check_consistency


def test_consistent_metrics():
    checks = check_consistency(
        {"distance_km": 10.0, "duration_seconds": 3600, "pace_seconds_per_km": 360},
        [],
    )
    assert any(check.name == "pace_consistency" and check.result == "pass" for check in checks)


def test_inconsistent_pace():
    checks = check_consistency(
        {"distance_km": 10.0, "duration_seconds": 3600, "pace_seconds_per_km": 600},
        [],
    )
    pace_check = next(check for check in checks if check.name == "pace_consistency")
    assert pace_check.result == "fail"
    assert pace_check.severity == "high"


def test_missing_metrics():
    checks = check_consistency(
        {"distance_km": None, "duration_seconds": None, "pace_seconds_per_km": None},
        [],
    )
    assert any(check.result == "missing" for check in checks)
