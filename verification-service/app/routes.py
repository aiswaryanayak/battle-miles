from fastapi import APIRouter, File, HTTPException, UploadFile

from .consistency import check_consistency
from .duplicate import compare_hashes, generate_image_hash
from .extraction import extract_running_metrics
from .image_analysis import MAX_IMAGE_BYTES, analyze_image, validate_and_open
from .ocr import extract_text
from .risk import build_risk_signals, calculate_risk
from .schemas import AnalysisResponse, RunningMetrics


router = APIRouter()


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "verification"}


@router.post("/analyze", response_model=AnalysisResponse)
async def analyze(file: UploadFile = File(...)) -> AnalysisResponse:
    raw = await file.read(MAX_IMAGE_BYTES + 1)
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image exceeds 10 MB")
    try:
        image, _ = validate_and_open(raw)
        metadata = analyze_image(image, raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        ocr_text = extract_text(image)
    except Exception:
        ocr_text = ""
    metrics = extract_running_metrics(ocr_text)
    metrics["_unreadable"] = not bool(ocr_text.strip())
    checks = check_consistency(metrics, metadata["suspicious_indicators"])
    signals = build_risk_signals(metrics, checks, metadata["suspicious_indicators"])
    score, level, reasons = calculate_risk(signals)
    metrics.pop("_unreadable", None)

    limitations = [
        "OCR quality varies with screenshot clarity and Tesseract availability.",
        "Extracted values are uncertain and require human review.",
        "Risk score is a transparent heuristic, not a fraud probability.",
        "Suspicious image characteristics are basic indicators only.",
    ]
    return AnalysisResponse(
        status="analyzed",
        ocr_text=ocr_text,
        extracted_metrics=RunningMetrics(**metrics),
        image_metadata={
            key: value
            for key, value in metadata.items()
            if key != "suspicious_indicators"
        },
        consistency_checks=checks,
        risk_signals=signals,
        risk_score=score,
        risk_level=level,
        reasons=reasons,
        limitations=limitations,
    )


@router.post("/duplicate/compare")
def compare_duplicate(payload: dict) -> dict:
    left = payload.get("left")
    right = payload.get("right")
    if not isinstance(left, dict) or not isinstance(right, dict):
        raise HTTPException(status_code=400, detail="Two image hashes are required")
    if "sha256" not in left or "perceptual" not in left or "sha256" not in right or "perceptual" not in right:
        raise HTTPException(status_code=400, detail="Invalid image hash structure")
    return compare_hashes(left, right)
