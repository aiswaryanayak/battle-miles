from typing import Literal
from pydantic import BaseModel, Field


class RunningMetrics(BaseModel):
    distance_km: float | None = None
    duration_seconds: int | None = None
    pace_seconds_per_km: int | None = None
    activity_date: str | None = None
    source: str | None = None


class ImageMetadata(BaseModel):
    format: str
    width: int
    height: int
    mode: str
    size_bytes: int
    mean_rgb: list[float]
    edge_density: float
    sha256: str
    perceptual_hash: str


class ConsistencyCheck(BaseModel):
    name: str
    result: Literal["pass", "warning", "fail", "missing"]
    explanation: str
    severity: Literal["low", "medium", "high"]


class RiskSignal(BaseModel):
    name: str
    severity: Literal["low", "medium", "high"]
    description: str
    triggered: bool


class AnalysisResponse(BaseModel):
    status: Literal["analyzed"]
    ocr_text: str
    extracted_metrics: RunningMetrics
    image_metadata: ImageMetadata
    consistency_checks: list[ConsistencyCheck]
    risk_signals: list[RiskSignal]
    risk_score: int = Field(ge=0, le=100)
    risk_level: Literal["low", "moderate", "high"]
    reasons: list[str]
    limitations: list[str]
