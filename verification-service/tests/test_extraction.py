from app.extraction import extract_running_metrics, parse_duration, parse_pace


def test_duration_parser():
    assert parse_duration("1:23:45") == 5025
    assert parse_duration("25:30") == 1530
    assert parse_duration("25m 30s") == 1530
    assert parse_duration("1h 25m 30s") == 5130
    assert parse_duration("45 min") == 2700
    assert parse_duration("1 hr 30 min") == 5400
    assert parse_duration("25 minutes 30 seconds") == 1530


def test_pace_parser():
    assert parse_pace("6:30 /km") == 390
    assert parse_pace("5:06 /km") == 306
    assert parse_pace("6:45/km") == 405
    assert parse_pace("05:06 min/km") == 306
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


def test_real_strava_ocr_regression():
    text = "Evening Run\nDistance Time\n5.00km 25m 30s\nPace\n5:06 /km STRAVA"
    metrics = extract_running_metrics(text)
    assert metrics["distance_km"] == 5.0
    assert metrics["duration_seconds"] == 1530
    assert metrics["pace_seconds_per_km"] == 306
    assert metrics["source"] == "strava"


def test_distance_formats():
    assert extract_running_metrics("5 km")["distance_km"] == 5.0
    assert extract_running_metrics("5.00km")["distance_km"] == 5.0
    miles = extract_running_metrics("3.10 mi")["distance_km"]
    assert miles is not None
    assert round(miles, 2) == 4.99


def test_colon_duration_does_not_confuse_pace():
    text = "Running\n25:30\nPace 5:06 /km"
    metrics = extract_running_metrics(text)
    assert metrics["duration_seconds"] == 1530
    assert metrics["pace_seconds_per_km"] == 306
