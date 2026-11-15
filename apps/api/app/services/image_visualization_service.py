"""Small, version-bound visual transforms used as analytical image previews."""
from __future__ import annotations

from io import BytesIO

import numpy as np
from PIL import Image, ImageOps

from app.services.image_explorer_service import image_explorer_service
from app.services.safe_image_decoder import draft_for_preview, open_image


def _canny(gray: np.ndarray) -> np.ndarray:
    padded = np.pad(gray.astype(np.float32), 1, mode="edge")
    gx = (padded[:-2, 2:] + 2 * padded[1:-1, 2:] + padded[2:, 2:] - padded[:-2, :-2] - 2 * padded[1:-1, :-2] - padded[2:, :-2]) / 8
    gy = (padded[2:, :-2] + 2 * padded[2:, 1:-1] + padded[2:, 2:] - padded[:-2, :-2] - 2 * padded[:-2, 1:-1] - padded[:-2, 2:]) / 8
    magnitude = np.hypot(gx, gy)
    angle = (np.rad2deg(np.arctan2(gy, gx)) + 180) % 180
    direction = np.select([(angle < 22.5) | (angle >= 157.5), (angle >= 22.5) & (angle < 67.5), (angle >= 67.5) & (angle < 112.5)], [0, 45, 90], default=135)
    padded_mag = np.pad(magnitude, 1, mode="constant")
    center = padded_mag[1:-1, 1:-1]
    neighbors = [((padded_mag[1:-1, :-2], padded_mag[1:-1, 2:])), ((padded_mag[:-2, 2:], padded_mag[2:, :-2])), ((padded_mag[:-2, 1:-1], padded_mag[2:, 1:-1])), ((padded_mag[:-2, :-2], padded_mag[2:, 2:]))]
    thinned = np.zeros_like(center)
    for index, direction_value in enumerate((0, 45, 90, 135)):
        first, second = neighbors[index]
        keep = (direction == direction_value) & (center >= first) & (center >= second)
        thinned[keep] = center[keep]
    high = max(float(np.percentile(thinned[thinned > 0], 85)) if np.any(thinned > 0) else 0, 35)
    low = high * 0.4
    strong = thinned >= high
    weak = (thinned >= low) & ~strong
    edges = strong.copy()
    # Hysteresis links weak pixels to strong edges using 8-neighborhood propagation.
    for _ in range(16):
        expanded = np.zeros_like(edges)
        expanded[1:, :] |= edges[:-1, :]; expanded[:-1, :] |= edges[1:, :]
        expanded[:, 1:] |= edges[:, :-1]; expanded[:, :-1] |= edges[:, 1:]
        expanded[1:, 1:] |= edges[:-1, :-1]; expanded[:-1, :-1] |= edges[1:, 1:]
        expanded[:-1, 1:] |= edges[1:, :-1]; expanded[1:, :-1] |= edges[:-1, 1:]
        updated = edges | (weak & expanded)
        if np.array_equal(updated, edges):
            break
        edges = updated
    return edges.astype(np.uint8) * 255


def render_image_preview(dataset_id: str, version_id: str, image_id: str, operation: str) -> bytes:
    if operation not in {"grayscale", "sobel", "canny", "segmentation"}:
        raise ValueError("operation must be grayscale, sobel, canny, or segmentation")
    source = image_explorer_service.image_path(dataset_id, version_id, image_id)
    with open_image(source) as opened:
        draft_for_preview(opened, 768)
        image = ImageOps.exif_transpose(opened).convert("RGB")
        image.thumbnail((768, 768), Image.Resampling.LANCZOS)
        rgb = np.asarray(image, dtype=np.uint8)
    gray = np.clip(rgb[..., 0] * .299 + rgb[..., 1] * .587 + rgb[..., 2] * .114, 0, 255).astype(np.uint8)
    if operation == "grayscale":
        output = Image.fromarray(gray, mode="L")
    elif operation == "segmentation":
        # Otsu foreground/background threshold preview; not a leaf mask or semantic segmentation.
        hist = np.bincount(gray.ravel(), minlength=256).astype(np.float64)
        prob = hist / hist.sum(); omega = np.cumsum(prob); means = np.cumsum(prob * np.arange(256)); total_mean = means[-1]
        between = (total_mean * omega - means) ** 2 / np.maximum(omega * (1 - omega), 1e-12)
        threshold = int(np.argmax(between))
        output = Image.fromarray((gray > threshold).astype(np.uint8) * 255, mode="L")
    else:
        padded = np.pad(gray.astype(np.float32), 1, mode="edge")
        gx = (padded[:-2, 2:] + 2*padded[1:-1, 2:] + padded[2:, 2:] - padded[:-2, :-2] - 2*padded[1:-1, :-2] - padded[2:, :-2]) / 8
        gy = (padded[2:, :-2] + 2*padded[2:, 1:-1] + padded[2:, 2:] - padded[:-2, :-2] - 2*padded[:-2, 1:-1] - padded[:-2, 2:]) / 8
        magnitude = np.hypot(gx, gy)
        if operation == "canny":
            output = Image.fromarray(_canny(gray), mode="L")
        else:
            scale = float(np.percentile(magnitude, 99.5)) or 1
            output = Image.fromarray(np.clip(magnitude / scale * 255, 0, 255).astype(np.uint8), mode="L")
    buffer = BytesIO(); output.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()
