"""Shared guarded image-opening and bounded JPEG decoding helpers."""
from __future__ import annotations

from pathlib import Path
from threading import BoundedSemaphore
from PIL import Image

from app.core.config import settings

# Keep Pillow's warning/error guards enabled, with the documented application cap.
Image.MAX_IMAGE_PIXELS = settings.MAX_IMAGE_DECODE_PIXELS
THUMBNAIL_DECODE_SLOTS = BoundedSemaphore(2)


def open_image(path: Path) -> Image.Image:
    """Open a header after Pillow's global decompression-bomb guard has run.

    MAX_IMAGE_PIXELS is configured once at application startup. The returned
    image must still be checked against the explicit application ceiling before
    pixel decoding.
    """
    return Image.open(path)


def source_dimensions(image: Image.Image) -> tuple[int, int]:
    width, height = image.size
    if width <= 0 or height <= 0:
        raise ValueError(f"Invalid image dimensions: {width} × {height}")
    pixels = width * height
    image_format = (image.format or "").upper()
    pixel_limit = settings.MAX_IMAGE_DECODE_PIXELS if image_format in {"JPEG", "MPO"} else min(settings.MAX_IMAGE_DECODE_PIXELS, 25_000_000)
    if pixels > pixel_limit:
        raise Image.DecompressionBombError(
            f"Image has {pixels:,} pixels; configured safe limit is "
            f"{pixel_limit:,} pixels for {image_format or 'unknown format'}"
        )
    return width, height


def draft_for_preview(image: Image.Image, max_edge: int) -> tuple[int, int]:
    """Ask JPEG decoders to subsample before decode; keep source dimensions."""
    width, height = source_dimensions(image)
    if (image.format or "").upper() in {"JPEG", "MPO"}:
        image.draft("RGB", (max_edge, max_edge))
    return width, height
