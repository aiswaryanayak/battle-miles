from io import BytesIO

import pytest
from PIL import Image

from app.image_analysis import MAX_IMAGE_BYTES, analyze_image, validate_and_open


def make_image(format_name="PNG", size=(100, 100), mode="RGB"):
    image = Image.new(mode, size, color=(128, 128, 128))
    buffer = BytesIO()
    image.save(buffer, format=format_name)
    return buffer.getvalue()


def test_valid_png():
    raw = make_image("PNG")
    image, normalized_format = validate_and_open(raw)
    assert normalized_format == "png"
    metadata = analyze_image(image, raw)
    assert metadata["width"] == 100
    assert metadata["height"] == 100
    assert len(metadata["sha256"]) == 64


def test_valid_jpeg_and_webp():
    for format_name in ("JPEG", "WEBP"):
        raw = make_image(format_name)
        image, _ = validate_and_open(raw)
        assert image.format == format_name


@pytest.mark.parametrize("raw", [b"not an image", b"\x89PNG\r\n\x1a\nbroken"])
def test_invalid_image(raw):
    with pytest.raises(ValueError):
        validate_and_open(raw)


def test_unsupported_format():
    raw = make_image("BMP")
    with pytest.raises(ValueError, match="Unsupported"):
        validate_and_open(raw)


def test_oversized_image():
    raw = b"x" * (MAX_IMAGE_BYTES + 1)
    with pytest.raises(ValueError, match="10 MB"):
        validate_and_open(raw)


def test_too_small_dimension():
    with pytest.raises(ValueError, match="dimensions"):
        validate_and_open(make_image("PNG", size=(8, 8)))
