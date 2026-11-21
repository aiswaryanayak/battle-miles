from .schemas import RiskSignal


def build_risk_signals(metrics: dict, checks: list, suspicious_indicators: list[str], duplicate: dict | None = None) -> list[RiskSignal]:
    inconsistency = any(check.result == "fail" and check.name in {"pace_consistency", "impossible_pace", "distance_range", "duration_range"} for check in checks)
    missing = any(check.result == "missing" for check in checks)
    unreadable = bool(metrics.get("_unreadable"))
    suspicious = bool(suspicious_indicators)
    potential_duplicate = bool(duplicate and (duplicate["exact"] or duplicate["visually_similar"]))
    return [
        RiskSignal(name="ocr_data_inconsistency", severity="high" if inconsistency else "low", description="OCR-derived running values do not align mathematically or fall outside plausible ranges.", triggered=inconsistency),
        RiskSignal(name="missing_running_metrics", severity="medium" if missing else "low", description="One or more important running metrics could not be extracted reliably.", triggered=missing),
        RiskSignal(name="unreadable_screenshot", severity="high", description="The screenshot was unreadable or OCR could not extract usable text.", triggered=unreadable),
        RiskSignal(name="suspicious_image_characteristics", severity="medium", description="Basic image characteristics were unusually low-detail or nearly monochrome.", triggered=suspicious),
        RiskSignal(name="potential_duplicate", severity="medium", description="A supplied reference image matches exactly or appears visually similar.", triggered=potential_duplicate),
    ]


def calculate_risk(signals: list[RiskSignal], duplicate: dict | None = None) -> tuple[int, str, list[str]]:
    weights = {"ocr_data_inconsistency": 30, "missing_running_metrics": 15, "unreadable_screenshot": 40, "suspicious_image_characteristics": 12, "potential_duplicate": 25}
    score = 0
    reasons: list[str] = []
    for signal in signals:
        if signal.triggered:
            score += weights[signal.name]
            reasons.append(signal.description)
    score = min(score, 100)
    level = "high" if score >= 60 else "moderate" if score >= 25 else "low"
    return score, level, reasons
