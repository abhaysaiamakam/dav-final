#!/usr/bin/env python3
"""Build safe, single-image CropLens Phase 1 preprocessing examples from curated ICAR data."""
from __future__ import annotations

import hashlib
import json
import sys
import platform
from importlib.metadata import version
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance, ImageOps

ROOT = Path(__file__).resolve().parents[1]
API = ROOT / "apps/api"
SOURCE_ROOT = API / "storage_data/curated/icar-rice-maize"
RELATIVE = Path("Maize/Disease/01_maydis_leaf_blight/01ab80b5-a414-45de-98a6-21cf505ba257.Jpg")
OUT = ROOT / "apps/web/public/phase1-evidence/preprocessing/icar-rice-maize"
VERSION_ID = "ver-icar-rice-maize-1-3fe79d16"
FINGERPRINT = "3fe79d16489da4538a1bfb6c65b19391c3f9e5d1645e136f72fce5cada88ac35"

sys.path.insert(0, str(API))
from app.services.image_intelligence_service import _image_features  # noqa: E402
from app.services.preprocessing.image_preprocessing import AugmentImagesOperation  # noqa: E402


def main() -> None:
    source = SOURCE_ROOT / RELATIVE
    if not source.is_file():
        raise SystemExit(f"Missing source image: {source}")
    OUT.mkdir(parents=True, exist_ok=True)
    source_bytes = source.read_bytes()
    source_sha = hashlib.sha256(source_bytes).hexdigest()
    with Image.open(source) as opened:
        opened.load()
        rgb = ImageOps.exif_transpose(opened).convert("RGB")
    original_size = list(rgb.size)

    max_edge = 512
    resized = rgb.copy()
    resized.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
    resized.save(OUT / "resize-512.png", optimize=True)

    gray = resized.convert("L")
    gray.save(OUT / "grayscale.png", optimize=True)

    hsv = resized.convert("HSV")
    h, s, v = hsv.split()
    h.save(OUT / "hue-channel.png", optimize=True)
    s.save(OUT / "saturation-channel.png", optimize=True)
    v.save(OUT / "value-channel.png", optimize=True)

    normalized = np.asarray(resized, dtype=np.float32) / 255.0
    # Display-only inverse scaling for PNG preview: the normalized array itself is [0, 1].
    normalized_display = Image.fromarray(np.clip(normalized * 255.0, 0, 255).round().astype(np.uint8), "RGB")
    normalized_display.save(OUT / "normalized-display.png", optimize=True)

    brightness = ImageEnhance.Brightness(resized).enhance(1.2)
    contrast = ImageEnhance.Contrast(brightness).enhance(1.2)
    contrast.save(OUT / "brightness-contrast.png", optimize=True)

    augmented = AugmentImagesOperation._transform(
        resized,
        [{"type": "horizontal_flip"}, {"type": "rotate", "degrees": 15}],
        np.random.default_rng(42),
    )
    augmented.save(OUT / "augmentation-flip-rotate.png", optimize=True)

    _, feature_metadata = _image_features(source, 512)
    del feature_metadata
    features, _ = _image_features(source, 512)
    with Image.open(source) as opened:
        oriented = ImageOps.exif_transpose(opened).convert("RGB")
        oriented.thumbnail((512, 512), Image.Resampling.LANCZOS)
        gray_array = np.asarray(oriented.convert("L"), dtype=np.float64)
    padded = np.pad(gray_array, 1, mode="edge")
    gx = (padded[:-2, 2:] + 2 * padded[1:-1, 2:] + padded[2:, 2:] - padded[:-2, :-2] - 2 * padded[1:-1, :-2] - padded[2:, :-2]) / 8
    gy = (padded[2:, :-2] + 2 * padded[2:, 1:-1] + padded[2:, 2:] - padded[:-2, :-2] - 2 * padded[:-2, 1:-1] - padded[:-2, 2:]) / 8
    magnitude = np.hypot(gx, gy)
    edge = Image.fromarray(np.clip(magnitude / max(float(np.percentile(magnitude, 99)), 1e-9) * 255, 0, 255).astype(np.uint8), "L")
    edge.save(OUT / "sobel-edge.png", optimize=True)

    manifest = {
        "dataset_id": "icar-rice-maize", "version_id": VERSION_ID, "source_fingerprint": FINGERPRINT,
        "analysis_id": "img-d55d4d88b6f2", "analysis_methodology": "image-intelligence-v1.0",
        "source_path": RELATIVE.as_posix(), "source_sha256": source_sha,
        "source_dimensions": original_size, "preview_dimensions": list(resized.size), "dataset_image_count": 852,
        "dependency_versions": {"python": platform.python_version(), "pillow": version("Pillow"), "numpy": version("numpy")},
        "created_at": datetime.now(timezone.utc).isoformat(),
        "provenance": {"resize": "Pillow LANCZOS, max edge 512", "grayscale": "Pillow RGB-to-L conversion", "hsv": "Pillow HSV channel split; H/S/V shown as channel intensity images", "normalization": "float32 RGB / 255.0; numeric array min/max are included, PNG is inverse-scaled solely for display", "brightness_contrast": "Pillow ImageEnhance brightness 1.2 then contrast 1.2", "augmentation": "CropLens AugmentImagesOperation._transform; seed 42; horizontal_flip then rotate 15 degrees, bicubic", "sobel": "CropLens image_intelligence_service._image_features; 3x3 Sobel gradient kernels with edge padding; display normalized to its 99th percentile", "limitations": "One actual source image is used to illustrate transforms. This is not a dataset-wide preprocessed version or a training result. The original curated image is read only and is never written."},
        "normalization_range": {"min": float(normalized.min()), "max": float(normalized.max()), "dtype": str(normalized.dtype)},
        "sobel_measurements": {"mean_magnitude": features["sobel_magnitude_mean"], "p90_edge_density": features["sobel_edge_density_p90"]},
        "artifacts": [
            {"id": "original", "label": "Original selected-version image", "path": "/phase1-evidence/preprocessing/icar-rice-maize/original.png", "method": "display-sized copy for side-by-side comparison"},
            {"id": "resize", "label": "Resize (max edge 512 px)", "path": "/phase1-evidence/preprocessing/icar-rice-maize/resize-512.png", "method": "LANCZOS, aspect ratio preserved"},
            {"id": "grayscale", "label": "Grayscale", "path": "/phase1-evidence/preprocessing/icar-rice-maize/grayscale.png", "method": "RGB to luminance (L)"},
            {"id": "hue", "label": "HSV hue channel", "path": "/phase1-evidence/preprocessing/icar-rice-maize/hue-channel.png", "method": "Actual HSV H channel, grayscale display"},
            {"id": "saturation", "label": "HSV saturation channel", "path": "/phase1-evidence/preprocessing/icar-rice-maize/saturation-channel.png", "method": "Actual HSV S channel, grayscale display"},
            {"id": "value", "label": "HSV value channel", "path": "/phase1-evidence/preprocessing/icar-rice-maize/value-channel.png", "method": "Actual HSV V channel, grayscale display"},
            {"id": "normalized", "label": "Normalized RGB tensor preview", "path": "/phase1-evidence/preprocessing/icar-rice-maize/normalized-display.png", "method": "float32 RGB / 255; display remapped to 8-bit for PNG"},
            {"id": "brightness-contrast", "label": "Brightness + contrast", "path": "/phase1-evidence/preprocessing/icar-rice-maize/brightness-contrast.png", "method": "brightness 1.2, then contrast 1.2"},
            {"id": "augmentation", "label": "Deterministic augmentation", "path": "/phase1-evidence/preprocessing/icar-rice-maize/augmentation-flip-rotate.png", "method": "horizontal flip then 15 degree bicubic rotation; seed 42"},
            {"id": "sobel", "label": "Sobel edge magnitude", "path": "/phase1-evidence/preprocessing/icar-rice-maize/sobel-edge.png", "method": "Production Sobel kernels; percentile display scaling"},
        ],
    }
    # Save a display copy of the selected source, never touch source bytes.
    rgb.thumbnail((512, 512), Image.Resampling.LANCZOS)
    rgb.save(OUT / "original.png", optimize=True)
    (ROOT / "apps/web/public/phase1-evidence/analysis/preprocessing_manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Wrote {len(manifest['artifacts'])} display derivatives; source SHA-256 {source_sha}")


if __name__ == "__main__":
    main()
