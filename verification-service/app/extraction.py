import re
from datetime import datetime


def parse_duration(value: str) -> int | None:
    value = value.strip().lower()
    colon_match = re.fullmatch(r"\s*(\d{1,3}):(\d{2})(?::(\d{2}))?\s*", value)
    if colon_match:
        parts = [int(part) for part in colon_match.groups() if part is not None]
        if len(parts) == 2:
            minutes, seconds = parts
            if seconds < 60:
                return minutes * 60 + seconds
        elif len(parts) == 3:
            hours, minutes, seconds = parts
            if minutes < 60 and seconds < 60:
                return hours * 3600 + minutes * 60 + seconds

    hours = re.search(r"\b(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b", value)
    minutes = re.search(r"\b(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b", value)
    seconds = re.search(r"\b(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)\b", value)
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
    match = re.search(
        r"(\d{1,2})[:.](\d{2})\s*(?:(?:min\s*)?/|per)?\s*(?:km|kilometer)",
        value.lower(),
    )
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
    compound_duration_match = re.search(
        r"\b(\d+\s*(?:h|hr|hrs|hours?)\s*)?"
        r"(\d+\s*(?:m|min|mins|minutes?)\s*)"
        r"(\d+\s*(?:s|sec|secs|seconds?)\s*)?\b",
        normalized,
    )
    if compound_duration_match:
        duration_text = compound_duration_match.group(0).strip()
        duration = parse_duration(duration_text)

    if duration is None:
        colon_duration_match = re.search(
            r"\b(\d{1,3}:\d{2}(?::\d{2})?)\b"
            r"(?!\s*(?:(?:min\s*)?/|per)\s*(?:km|kilometer))",
            normalized,
        )
        if colon_duration_match:
            duration = parse_duration(colon_duration_match.group(1))

    pace_match = re.search(
        r"\b(\d{1,2}[:.]\d{2})\s*(?:(?:min\s*)?/|per)\s*(?:km|kilometer)",
        normalized,
    )
    pace = parse_pace(pace_match.group(1) + " /km") if pace_match else None
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
