from app.extraction import extract_running_metrics, parse_duration, parse_pace


def test_duration_parser():
    assert parse_duration("1:23:45") == 5025
    assert parse_duration("45 min") == 2700
    assert parse_duration("1 hr 30 min") == 5400


def test_pace_parser():
    assert parse_pace("6:30 /km") == 390
    assert parse_pace("no pace") is None


def test_mixed_ocr_extraction():
    text = "Strava\nRunning\n10.5 km\nDuration 1:05:30\nPace 6:14 /km\nDate 2025-02-14"
    metrics = extract_running_metrics(text)
    assert metrics["distance_km"] == 10.5
    assert metrics["duration_seconds"] == 3930
    assert metrics["pace_seconds_per_km"] == 374
    assert metrics["activity_date"] == "2025-02-14"
    assert metrics["source"] == "strava"


def test_missing_metrics_return_none():
    metrics = extract_running_metrics("Running app screenshot")
    assert metrics["distance_km"] is None
    assert metrics["duration_seconds"] is None
    assert metrics["pace_seconds_per_km"] is None
