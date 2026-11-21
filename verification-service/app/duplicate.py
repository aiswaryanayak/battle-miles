from hashlib import sha256
from io import BytesIO

from PIL import Image, ImageOps


def generate_image_hash(raw: bytes) -> dict[str, str]:
    image = Image.open(BytesIO(raw)).convert("L")
    image = ImageOps.fit(image, (32, 32), method=Image.Resampling.LANCZOS)
    pixels = list(image.getdata())
    threshold = sum(pixels) / len(pixels)
    bits = "".join("1" if pixel >= threshold else "0" for pixel in pixels)
    perceptual = f"{int(bits, 2):064x}" if len(bits) == 1024 else "".join(f"{int(bits[i:i+4], 2):x}" for i in range(0, len(bits), 4))
    return {"sha256": sha256(raw).hexdigest(), "perceptual": perceptual}


def hamming_distance(left: str, right: str) -> int:
    if len(left) != len(right):
        return max(len(left), len(right))
    return sum(left_char != right_char for left_char, right_char in zip(left, right))


def compare_hashes(left: dict[str, str], right: dict[str, str]) -> dict:
    exact = left["sha256"] == right["sha256"]
    left_perceptual = f"{int(left['perceptual'], 16):01024b}"[-1024:]
    right_perceptual = f"{int(right['perceptual'], 16):01024b}"[-1024:]
    distance = hamming_distance(left_perceptual, right_perceptual)
    return {
        "exact": exact,
        "visually_similar": not exact and distance <= 12,
        "hamming_distance": distance,
    }
