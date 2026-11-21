from io import BytesIO

from PIL import Image

from app.duplicate import compare_hashes, generate_image_hash


def make_bytes(color=(100, 100, 100)):
    buffer = BytesIO()
    Image.new("RGB", (100, 100), color=color).save(buffer, "PNG")
    return buffer.getvalue()


def test_exact_duplicate():
    raw = make_bytes()
    left = generate_image_hash(raw)
    right = generate_image_hash(raw)
    result = compare_hashes(left, right)
    assert result["exact"] is True


def test_different_duplicate():
    left = generate_image_hash(make_bytes((100, 100, 100)))
    right = generate_image_hash(make_bytes((220, 220, 220)))
    result = compare_hashes(left, right)
    assert isinstance(result["hamming_distance"], int)
