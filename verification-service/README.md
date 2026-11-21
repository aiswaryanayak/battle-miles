# BATTLE MILES Screenshot Analysis Service

This local FastAPI service performs heuristic, non-fraudulent analysis of running screenshots. It does not definitively detect fraud or use a paid AI API.

## Windows setup

```powershell
cd verification-service
py -3.10 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Install Tesseract OCR for Windows from the official UB Mannheim build or another trusted Tesseract 5 installer. Add `tesseract.exe` to `PATH`, or set `TESSERACT_CMD`.

PowerShell example:

```powershell
$env:TESSERACT_CMD="C:\Program Files\Tesseract-OCR\tesseract.exe"
```

## Run

```powershell
uvicorn app.main:app --reload --host 127.0.0.1 --port 8002
```

Health:

```powershell
Invoke-RestMethod http://127.0.0.1:8002/health
```

Analysis:

```powershell
curl.exe -F "file=@C:\path\proof.png" http://127.0.0.1:8002/analyze
```

## Tests

```powershell
python -m pytest -q
```

## API

`POST /analyze` accepts JPEG, PNG, or WebP multipart image data. The response includes OCR text, normalized metrics, image metadata, consistency checks, independent risk signals, a heuristic risk score, and limitations.

`GET /health` reports service readiness.

## Limitations

- OCR quality depends on screenshot clarity and local Tesseract availability.
- Extracted values can be uncertain or missing.
- The risk score is a transparent heuristic, not a probability of fraud.
- No AI, definitive screenshot-authenticity, or fraud verdict is provided.
- Duplicate detection is hash-based and can miss edits or changes.
