from fastapi import FastAPI, UploadFile, File, HTTPException
from PIL import Image
from io import BytesIO
import hashlib

app = FastAPI(title="Building Marathon Verification", version="0.1.0")

@app.get("/health")
def health():
    return {"status": "ok", "service": "verification"}

@app.post("/analyze")
async def analyze(file: UploadFile = File(...)):
    allowed = {"image/jpeg", "image/png", "image/webp"}
    if file.content_type not in allowed:
        raise HTTPException(status_code=415, detail="Unsupported image type")
    raw = await file.read()
    if len(raw) > 8 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image exceeds 8 MB")
    try:
        image = Image.open(BytesIO(raw))
        image.verify()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid image file")
    # Deliberately no authenticity verdict: OCR and forensic models must be integrated,
    # evaluated on representative data, and treated as non-conclusive signals.
    return {
        "sha256": hashlib.sha256(raw).hexdigest(),
        "image_format": image.format,
        "dimensions": list(image.size),
        "risk_level": "unknown",
        "findings": ["Image decoded successfully", "OCR and forensic analysis not yet configured"],
        "requires_human_review": True
    }
