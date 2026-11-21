from io import BytesIO
import os

import pytesseract
from PIL import Image


def configure_tesseract() -> None:
    configured = os.getenv("TESSERACT_CMD")
    if configured:
        pytesseract.pytesseract.tesseract_cmd = configured


def extract_text(image: Image.Image) -> str:
    configure_tesseract()
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return pytesseract.image_to_string(Image.open(buffer), config="--psm 6").strip()
