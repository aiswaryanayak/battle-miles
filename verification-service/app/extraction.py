import re
from datetime import datetime


def parse_duration(value: str) -> int | None:
    value = value.strip().lower()
    colon = re.findall(r"\d+", value)
    if ":" in value and 2 <= len(colon) <= 3:
        numbers = [int(part) for part in colon]
        if len(numbers) == 2:
            minutes, seconds = numbers
            if seconds < 60:
                return minutes * 60 + seconds
        if len(numbers) == 3:
            hours, minutes, seconds = numbers
            if minutes < 60 and seconds < 60:
                return hours * 3600 + minutes * 60 + seconds

    hours = re.search(r"(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour)", value)
    minutes = re.search(r"(\d+(?:\.\d+)?)\s*(?:m|min|mins)", value)
    seconds = re.search(r"(\d+(?:\.\d+)?)\s*(?:s|sec|secs)", value)
    if hours or minutes or seconds:
        total = 0
        if hours:
            total += int(float(hours.group(1)) * 3600)
        if minutes:
            total += int(float(minutes.group(1)) * 60)
        if seconds:
            total += int(float(seconds.group(1)))
        return total or None
    return None


def parse_pace(value: str) -> int | None:
    match = re.search(r"(\d{1,2})[:.](\d{2})(?:\s*(?:/|\bper\b)?\s*(?:km|k\b))?", value.lower())
    if not match:
        return None
    minutes, seconds = int(match.group(1)), int(match.group(2))
    if seconds >= 60:
        return None
    return minutes * 60 + seconds


def parse_date(text: str) -> str | None:
    patterns = (
        "%d %b %Y", "%d %B %Y", "%b %d, %Y", "%B %d, %Y",
        "%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y"
    )
    candidates = re.findall(
        r"\b(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|(?:\d{1,2}\s+\w+\s+\d{4}|\w+\s+\d{1,2},\s+\d{4}))\b",
        text,
    )
    for candidate in candidates:
        for pattern in patterns:
            try:
                return datetime.strptime(candidate.replace("/", "-") if "/" in candidate and pattern.endswith("%Y") and candidate.count("/") == 1 else candidate, pattern).date().isoformat()
            except ValueError:
                continue
    return None


def extract_running_metrics(text: str) -> dict:
    normalized = text.lower().replace(",", ".")

    distance: float | None = None
    distance_match = re.search(r"(\d+(?:[.]\d+)?)\s*(km|kilometers?|miles?|mi)\b", normalized)
    if distance_match:
        value = float(distance_match.group(1))
        unit = distance_match.group(2)
        if unit.startswith("mile") or unit in {"mi"}:
            value *= 1.609344
        distance = round(value, 3)

    duration: int | None = None
    duration_match = re.search(
        r"(?:duration|time|elapsed)[^\n\d]*([0-9]{1,2}:[0-5]\d(?::[0-5]\d)?|\d+\s*(?:h(?:ours?|rs?)?|m(?:in(?:utes?|s)?|in)?|s(?:ec(?:onds?|s)?)))",
        normalized,
    )
    if duration_match:
        duration = parse_duration(duration_match.group(1))

    pace_match = re.search(r"(\d{1,2}[:.]\d{2})\s*(?:/|\bper\b)?\s*(?:km|k\b)", normalized)
    pace = parse_pace(pace_match.group(1)) if pace_match else None
    source = None
    for candidate in ("strava", "garmin", "nike run", "adidas", "runkeeper", "apple fitness", "fitbit"):
        if candidate in normalized:
            source = candidate
            break

    return {
        "distance_km": distance,
        "duration_seconds": duration,
        "pace_seconds_per_km": pace,
        "activity_date": parse_date(text),
        "source": source,
    }
