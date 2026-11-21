from .schemas import ConsistencyCheck


def check_consistency(metrics: dict, suspicious_indicators: list[str]) -> list[ConsistencyCheck]:
    checks: list[ConsistencyCheck] = []
    distance = metrics.get("distance_km")
    duration = metrics.get("duration_seconds")
    pace = metrics.get("pace_seconds_per_km")

    if distance is None or duration is None:
        checks.append(ConsistencyCheck(
            name="distance_duration_available",
            result="missing",
            explanation="Distance or duration was not reliably extracted.",
            severity="medium",
        ))
    else:
        if distance <= 0 or distance > 500:
            checks.append(ConsistencyCheck(
                name="distance_range",
                result="fail",
                explanation="The extracted distance is outside the plausible running range.",
                severity="high",
            ))
        elif duration <= 0 or duration > 24 * 3600:
            checks.append(ConsistencyCheck(
                name="duration_range",
                result="fail",
                explanation="The extracted duration is outside the plausible running range.",
                severity="high",
            ))
        else:
            derived_pace = int(duration / distance)
            checks.append(ConsistencyCheck(
                name="distance_duration_pace",
                result="pass",
                explanation=f"Distance and duration imply approximately {derived_pace // 60}:{derived_pace % 60:02d} per km.",
                severity="low",
            ))

    if pace is not None and distance is not None and duration is not None:
        derived_pace = int(duration / distance)
        difference = abs(derived_pace - pace)
        if difference <= 30:
            result = "pass"
            severity = "low"
            explanation = "Extracted pace agrees with distance and duration within 30 seconds per km."
        else:
            result = "fail"
            severity = "high"
            explanation = f"Extracted pace differs from distance and duration by {difference} seconds per km."
        checks.append(ConsistencyCheck(
            name="pace_consistency",
            result=result,
            explanation=explanation,
            severity=severity,
        ))
    elif pace is None:
        checks.append(ConsistencyCheck(
            name="pace_available",
            result="missing",
            explanation="Pace was not reliably extracted.",
            severity="medium",
        ))

    if distance is not None and duration is not None and distance > 0:
        pace = int(duration / distance)
        if pace < 90:
            checks.append(ConsistencyCheck(
                name="impossible_pace",
                result="fail",
                explanation="The implied pace is faster than an obviously plausible running pace.",
                severity="high",
            ))
        elif pace > 3600:
            checks.append(ConsistencyCheck(
                name="impossible_pace",
                result="fail",
                explanation="The implied pace is unusually slow.",
                severity="medium",
            ))

    if suspicious_indicators:
        checks.append(ConsistencyCheck(
            name="image_characteristics",
            result="warning",
            explanation="; ".join(suspicious_indicators),
            severity="medium",
        ))
    return checks
