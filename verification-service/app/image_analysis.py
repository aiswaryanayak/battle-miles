from hashlib import sha256
from io import BytesIO

import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError


MAX_IMAGE_BYTES = 10 * 1024 * 1024
SUPPORTED_FORMATS = {"JPEG", "PNG", "WEBP"}


def validate_and_open(raw: bytes) -> tuple[Image.Image, str]:
    if len(raw) > MAX_IMAGE_BYTES:
        raise ValueError("Image exceeds 10 MB")
    if not raw:
        raise ValueError("Image is empty")
    try:
        image = Image.open(BytesIO(raw))
        image.verify()
        image = Image.open(BytesIO(raw))
        image.load()
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError("Corrupted or unreadable image") from exc
    if image.format not in SUPPORTED_FORMATS:
        raise ValueError("Unsupported image format")
    if image.width < 16 or image.height < 16:
        raise ValueError("Image dimensions are too small")
    if image.width > 20000 or image.height > 20000:
        raise ValueError("Image dimensions are too large")
    return image, image.format.lower().replace("jpeg", "jpg")


def analyze_image(image: Image.Image, raw: bytes) -> dict:
    rgb = ImageOps.exif_transpose(image).convert("RGB")
    array = np.asarray(rgb)
    mean_rgb = [round(float(value), 2) for value in array.mean(axis=(0, 1))]
    grayscale = cv2.cvtColor(array, cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(grayscale, 100, 200)
    edge_density = round(float(np.count_nonzero(edges) / edges.size), 4)

    small = rgb.resize((32, 32), Image.Resampling.LANCZOS).convert("L")
    pixels = list(small.getdata())
    threshold = sum(pixels) / len(pixels)
    perceptual_hash = "".join("1" if pixel >= threshold else "0" for pixel in pixels)
    perceptual_hex = "".join(f"{int(perceptual_hash[i:i+4], 2):x}" for i in range(0, 1024, 4))

    suspicious: list[str] = []
    if edge_density < 0.005:
        suspicious.append("Very low edge/detail density")
    if max(mean_rgb) - min(mean_rgb) < 5:
        suspicious.append("Near-monochrome image")

    return {
        "format": image.format or "unknown",
        "width": image.width,
        "height": image.height,
        "mode": image.mode,
        "size_bytes": len(raw),
        "mean_rgb": mean_rgb,
        "edge_density": edge_density,
        "sha256": sha256(raw).hexdigest(),
        "perceptual_hash": perceptual_hex,
        "suspicious_indicators": suspicious,
    }
