#!/usr/bin/env python3
"""Build a small, reproducible presentation bundle from the supplied image ZIP.

The original archive is read only. Full numeric inventories and charts come from
phase1-image-analysis.py; this script adds representative and exact-duplicate
thumbnails plus a concrete resize preview for the Phase 1 web workspace.
"""
from __future__ import annotations

import argparse
import csv
import json
import subprocess
import sys
import zipfile
from collections import defaultdict
from pathlib import Path, PurePosixPath

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ANALYZER = ROOT / "apps/web/public/phase1-image-analysis.py"


def save_preview(archive: zipfile.ZipFile, member: str, destination: Path, max_edge: int = 420) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with archive.open(member) as source, Image.open(source) as image:
        image = image.convert("RGB")
        image.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
        image.save(destination, "WEBP", quality=76, method=6)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path, help="Original dataset ZIP; read-only")
    parser.add_argument("--output", type=Path, default=ROOT / "apps/web/public/phase1-evidence")
    args = parser.parse_args()
    archive_path = args.archive.expanduser().resolve()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    analysis_dir = output / "analysis"
    subprocess.run([sys.executable, str(ANALYZER), str(archive_path), "--output", str(analysis_dir)], check=True)
    inventory = json.loads((analysis_dir / "dataset_inventory.json").read_text(encoding="utf-8"))
    with (analysis_dir / "image_inventory.csv").open(encoding="utf-8", newline="") as source:
        records = list(csv.DictReader(source))

    # Select three deterministic examples per observed class, retaining source paths.
    by_class: dict[str, list[dict[str, str]]] = defaultdict(list)
    for record in records:
        if record["status"] == "valid":
            by_class[record["class_path"]].append(record)
    samples = []
    wanted: set[str] = set()
    for class_path, class_records in sorted(by_class.items()):
        chosen = class_records[:3]
        for row in chosen:
            wanted.add(row["relative_path"])
            samples.append({"class_path": class_path, "relative_path": row["relative_path"], "width": int(row["width"]), "height": int(row["height"]), "file_size_bytes": int(row["file_size_bytes"]), "format": row["format"], "mode": row["mode"], "preview": None})

    # Every exact duplicate member is included, so the UI can show actual groups.
    duplicate_groups = []
    for index, group in enumerate(inventory["exact_duplicate_groups"], start=1):
        duplicate_groups.append({
            "group": index,
            "sha256": group["sha256"],
            "members": [{"relative_path": member, "preview": None} for member in group["files"]],
        })
        wanted.update(group["files"])

    # Include an actual input/output pair for a conservative, non-destructive resize preview.
    resize_source = next(row["relative_path"] for row in records if row["status"] == "valid")
    wanted.add(resize_source)
    preview_map = {}
    with zipfile.ZipFile(archive_path) as archive:
        for member in sorted(wanted):
            # Stable filename is derived from the archive path, not user-controlled traversal.
            import hashlib
            key = hashlib.sha256(member.encode("utf-8")).hexdigest()[:20]
            rel = f"images/{key}.webp"
            save_preview(archive, member, output / rel)
            preview_map[member] = "/phase1-evidence/" + rel
        # Resize the selected real image in memory. It does not create or mutate a dataset version.
        source_record = next(row for row in records if row["relative_path"] == resize_source)
        original_dimensions = [int(source_record["width"]), int(source_record["height"])]
        with archive.open(resize_source) as source, Image.open(source) as image:
            original_mode = image.mode
            resized = image.convert("RGB")
            resized.thumbnail((512, 512), Image.Resampling.LANCZOS)
            resized_dimensions = list(resized.size)
            resized.save(output / "resize-preview.webp", "WEBP", quality=82, method=6)

    for sample in samples:
        sample["preview"] = preview_map[sample["relative_path"]]
    for group in duplicate_groups:
        for member in group["members"]:
            member["preview"] = preview_map[member["relative_path"]]

    # Record archive-level facts and non-image members from the ZIP itself.
    with zipfile.ZipFile(archive_path) as archive:
        files = [item for item in archive.infolist() if not item.is_dir()]
        sidecars = [item.filename for item in files if PurePosixPath(item.filename).suffix.lower() not in {".jpg", ".jpeg", ".png", ".bmp", ".gif", ".tif", ".tiff", ".webp", ".jfif"}]
    report = {
        "title": "ICAR Rice and Maize Disease Dataset",
        "source_archive": archive_path.name,
        "archive_size_bytes": archive_path.stat().st_size,
        "archive_member_count": len(files),
        "uncompressed_member_bytes": sum(item.file_size for item in files),
        "sidecar_files": sidecars,
        "analysis": inventory,
        "representative_images_per_class": 3,
        "representative_images": samples,
        "exact_duplicate_groups_with_evidence": duplicate_groups,
        "resize_preview": {
            "source_path": resize_source,
            "source_dimensions": original_dimensions,
            "source_mode": original_mode,
            "operation": "Resize proportionally so the longest edge is at most 512 pixels; convert the preview to RGB.",
            "result_dimensions": resized_dimensions,
            "preview": "/phase1-evidence/resize-preview.webp",
            "note": "Preview only. Original archive is unchanged and no derived dataset version was created.",
        },
        "provenance": "Computed locally from the named source ZIP. The archive was read without extraction or modification. Thumbnails are display derivatives of actual source images.",
    }
    (output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), "archive_bytes": report["archive_size_bytes"], "images": inventory["supported_image_count"], "valid": inventory["valid_image_count"], "classes": len(inventory["observed_class_path_counts"]), "duplicate_groups": len(duplicate_groups), "preview_assets": len(wanted) + 1}, indent=2))


if __name__ == "__main__":
    main()
