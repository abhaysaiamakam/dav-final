"""
Scalable Image Processing & On-Demand Thumbnail Service.

Provides thumbnail generation, disk caching, and bounded memory image inspection
for large image classification and annotation datasets.
"""
from __future__ import annotations

import hashlib
import logging
import os
from threading import get_ident
from pathlib import Path
from typing import Optional, Tuple
from PIL import Image as PILImage, ImageOps

from app.core.config import settings
from app.services.safe_image_decoder import THUMBNAIL_DECODE_SLOTS, draft_for_preview, open_image, source_dimensions

logger = logging.getLogger(__name__)

# Enforce PIL safety limits against decompression bomb images
PILImage.MAX_IMAGE_PIXELS = settings.MAX_IMAGE_DECODE_PIXELS


class ImageThumbnailService:
    """Handles cached thumbnail creation and safe image rendering."""

    def get_or_create_thumbnail(
        self,
        dataset_root: Path,
        relative_image_path: str,
        max_dim: int = 300,
        cache_root: Optional[Path] = None,
    ) -> Tuple[Path, str]:
        """
        Locate or generate a thumbnail image on disk.
        Returns tuple of (thumbnail_abs_path, mime_type).
        """
        clean_rel = relative_image_path.lstrip("/\\")
        image_path = (dataset_root / clean_rel).resolve()

        if not image_path.is_file() or dataset_root.resolve() not in image_path.parents:
            raise FileNotFoundError(f"Image '{relative_image_path}' not found in dataset root.")

        # Keep generated artifacts outside the immutable source version.
        thumb_dir = (cache_root or (dataset_root / ".thumbnails")) / f"dim_{max_dim}"
        thumb_dir.mkdir(parents=True, exist_ok=True)

        cache_key = hashlib.sha256(
            f"{image_path}:{image_path.stat().st_mtime_ns}:{image_path.stat().st_size}:{max_dim}".encode()
        ).hexdigest()
        thumb_filename = f"{cache_key}.jpg"
        thumb_path = thumb_dir / thumb_filename

        if thumb_path.exists() and thumb_path.stat().st_size > 0:
            return thumb_path, "image/jpeg"

        # Generate thumbnail
        temp_path = thumb_dir / f".{cache_key}.{os.getpid()}.{get_ident()}.tmp.jpg"
        try:
            with THUMBNAIL_DECODE_SLOTS:
                with open_image(image_path) as source:
                    source_dimensions(source)
                    draft_for_preview(source, max_dim)
                    oriented = ImageOps.exif_transpose(source)
                    thumb = oriented.convert("RGB")
                    thumb.thumbnail((max_dim, max_dim), PILImage.Resampling.LANCZOS)
                    thumb.save(temp_path, format="JPEG", quality=85, optimize=True)
                    thumb.close()
                os.replace(temp_path, thumb_path)
            return thumb_path, "image/jpeg"
        except Exception as e:
            try:
                temp_path.unlink(missing_ok=True)
            except OSError:
                pass
            logger.error(f"Failed to generate thumbnail for '{relative_image_path}': {type(e).__name__}: {e}")
            raise ValueError(f"Thumbnail decoding failed ({type(e).__name__}): {e}") from e

    def inspect_image_metadata_safe(self, image_path: Path) -> Optional[dict]:
        """Header-only image inspection without decoding full pixel array into memory."""
        if not image_path.is_file():
            return None
        try:
            with open_image(image_path) as img:
                width, height = img.size
                source_dimensions(img)
                format_name = img.format or "UNKNOWN"
                mode = img.mode
                file_bytes = image_path.stat().st_size
                return {
                    "width": width,
                    "height": height,
                    "format": format_name,
                    "mode": mode,
                    "file_size": file_bytes,
                    "aspect_ratio": round(width / max(height, 1), 4),
                }
        except Exception:
            return None


image_thumbnail_service = ImageThumbnailService()
