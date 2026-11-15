#!/usr/bin/env python3
"""CropLens Phase 1: a small, reproducible educational image-analysis script.

This is a teaching implementation, not CropLens production source. It mirrors
measured Phase 1 operations in plain Python and writes new files only beneath
--output. The input dataset is opened read-only. Values are computed when you
run the script; this file contains no historical ICAR findings.

Expected folder layout (nested directory names are retained as the class label):
    dataset-root/
      Rice/Disease/Bacterial_leaf_blight/image_001.jpg
      Rice/Healthy/image_002.jpg
      Maize/Disease/Common_rust/image_003.jpg

Install (Python 3.10+):
    python -m pip install Pillow numpy ImageHash
Run:
    python phase_1_analysis.py /path/to/icar-rice-maize --output phase1-results

The script analyzes original images only. Preprocessing/augmentation is a
separate CropLens workspace operation that creates a derived dataset version.
Production code adds version-aware storage, guarded decoding, job handling,
atomic artifact persistence and stricter API validation; those safeguards are
intentionally outside this readable example.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
from html import escape
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

import imagehash
import numpy as np
from PIL import Image, ImageFilter, ImageOps, UnidentifiedImageError

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"}


def discover_images(dataset_root: Path) -> list[tuple[Path, str]]:
    """Return sorted image paths and their relative parent-directory labels."""
    found = []
    for path in dataset_root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        if any(part.startswith(".") for part in path.relative_to(dataset_root).parts):
            continue
        found.append((path, path.parent.relative_to(dataset_root).as_posix()))
    return sorted(found, key=lambda row: row[0].as_posix().casefold())


def read_image(path: Path) -> Image.Image:
    """Decode and orient an image, returning an independent RGB image."""
    with Image.open(path) as opened:
        return ImageOps.exif_transpose(opened).convert("RGB").copy()


def image_measurements(path: Path) -> dict[str, object]:
    """Compute simple quality, color, texture and edge measurements."""
    with Image.open(path) as opened:
        source_format, source_mode = opened.format, opened.mode
        width, height = opened.size
        image = ImageOps.exif_transpose(opened).convert("RGB").copy()
    # Production uses a bounded proxy image for feature extraction; max edge 512.
    image.thumbnail((512, 512), Image.Resampling.LANCZOS)
    rgb = np.asarray(image, dtype=np.uint8)
    gray = np.asarray(image.convert("L"), dtype=np.float32)
    hsv = np.asarray(image.convert("HSV"), dtype=np.uint8)
    gx = np.zeros_like(gray); gy = np.zeros_like(gray)
    gx[1:-1, 1:-1] = (-gray[:-2, :-2] + gray[:-2, 2:] - 2*gray[1:-1, :-2] + 2*gray[1:-1, 2:] - gray[2:, :-2] + gray[2:, 2:]) / 8
    gy[1:-1, 1:-1] = (-gray[:-2, :-2] - 2*gray[:-2, 1:-1] - gray[:-2, 2:] + gray[2:, :-2] + 2*gray[2:, 1:-1] + gray[2:, 2:]) / 8
    edge_magnitude = np.hypot(gx, gy)
    # A median-filter residual is a simple noise proxy, not a sensor-noise model.
    median = np.asarray(image.convert("L").filter(ImageFilter.MedianFilter(3)), dtype=np.float32)
    residual = gray - median
    features: dict[str, object] = {
        "width": width, "height": height, "pixel_count": width * height, "aspect_ratio": width / height if height else None,
        "format": source_format, "color_mode": source_mode,
        "file_size_bytes": path.stat().st_size,
        "brightness_mean": float(gray.mean()), "contrast_std": float(gray.std()),
        "laplacian_variance": float(laplacian(gray).var()),
        "noise_mad_estimate": float(np.median(np.abs(residual - np.median(residual))) / 0.6745),
        "sobel_mean_magnitude": float(edge_magnitude.mean()),
        "sobel_edge_density_p90": float((edge_magnitude >= np.percentile(edge_magnitude, 90)).mean()),
    }
    for channel, name in enumerate(("red", "green", "blue")):
        plane = rgb[:, :, channel]
        features[f"{name}_mean"] = float(plane.mean())
        features[f"{name}_std"] = float(plane.std())
        hist, _ = np.histogram(plane, bins=16, range=(0, 256))
        hist = hist / max(hist.sum(), 1)
        for index, value in enumerate(hist): features[f"rgb_{name}_bin_{index:02d}"] = float(value)
    for channel, name, bins, limit in ((0, "hue", 8, 256), (1, "saturation", 8, 256), (2, "value", 8, 256)):
        plane = hsv[:, :, channel]
        features[f"hsv_{name}_mean"] = float(plane.mean())
        features[f"hsv_{name}_std"] = float(plane.std())
        hist, _ = np.histogram(plane, bins=bins, range=(0, limit))
        hist = hist / max(hist.sum(), 1)
        for index, value in enumerate(hist): features[f"hsv_{name}_bin_{index:02d}"] = float(value)
    features.update(glcm_summary(gray))
    features.update(lbp_summary(gray))
    return features


def laplacian(gray: np.ndarray) -> np.ndarray:
    """Four-neighbour discrete Laplacian used as a sharpness proxy."""
    padded = np.pad(gray, 1, mode="edge")
    return padded[:-2, 1:-1] + padded[2:, 1:-1] + padded[1:-1, :-2] + padded[1:-1, 2:] - 4 * gray


def glcm_summary(gray: np.ndarray) -> dict[str, float]:
    """Quantize to 16 levels and average four-direction GLCM descriptors."""
    quantized = (np.clip(gray, 0, 255).astype(np.uint8) // 16)
    summaries = []
    for dy, dx in ((0, 1), (1, 1), (1, 0), (1, -1)):
        y0, y1 = max(0, -dy), min(quantized.shape[0], quantized.shape[0] - dy)
        x0, x1 = max(0, -dx), min(quantized.shape[1], quantized.shape[1] - dx)
        a, b = quantized[y0:y1, x0:x1], quantized[y0+dy:y1+dy, x0+dx:x1+dx]
        counts = np.zeros((16, 16), dtype=np.float64)
        np.add.at(counts, (a.ravel(), b.ravel()), 1)
        counts += counts.T
        total = counts.sum()
        if total == 0: continue
        p = counts / total; i, j = np.indices(p.shape); diff = i-j
        contrast = float((p * diff**2).sum()); homogeneity = float((p / (1 + np.abs(diff))).sum()); energy = float(np.sqrt((p*p).sum()))
        summaries.append((contrast, homogeneity, energy))
    names = ("glcm_contrast", "glcm_homogeneity", "glcm_energy")
    return {name: float(np.mean([row[i] for row in summaries])) if summaries else 0.0 for i, name in enumerate(names)}


def lbp_summary(gray: np.ndarray) -> dict[str, float]:
    """Uniform 8-neighbour LBP histogram (10 bins, radius one)."""
    center = gray[1:-1, 1:-1]
    neighbors = [gray[0:-2,0:-2], gray[0:-2,1:-1], gray[0:-2,2:], gray[1:-1,2:], gray[2:,2:], gray[2:,1:-1], gray[2:,0:-2], gray[1:-1,0:-2]]
    bits = np.stack([neighbor >= center for neighbor in neighbors])
    transitions = np.sum(bits != np.roll(bits, 1, axis=0), axis=0)
    ones = bits.sum(axis=0)
    labels = np.where(transitions <= 2, ones, 9)
    hist = np.bincount(labels.ravel().astype(int), minlength=10).astype(float)
    hist /= max(hist.sum(), 1)
    return {f"lbp_uniform_bin_{index}": float(value) for index, value in enumerate(hist)}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""): digest.update(chunk)
    return digest.hexdigest()


def perceptual_hash_input(image: Image.Image) -> Image.Image:
    """Match production's orientation and transparent-pixel normalization."""
    oriented = ImageOps.exif_transpose(image)
    if oriented.mode in {"RGBA", "LA"} or "transparency" in oriented.info:
        rgba = oriented.convert("RGBA")
        background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        return Image.alpha_composite(background, rgba).convert("RGB")
    return oriented.convert("RGB")


def near_duplicate_groups(rows: list[dict[str, object]], exact_paths: set[str], threshold: int = 8) -> list[dict[str, object]]:
    """Group non-exact copies with the production-style greedy complete-link rule."""
    hashes = []
    for row in rows:
        try:
            with Image.open(row["path"]) as image: hashes.append((row, imagehash.phash(perceptual_hash_input(image))))
        except (OSError, ValueError, UnidentifiedImageError): continue
    by_path = {row["relative_path"]: value for row, value in hashes if row["relative_path"] not in exact_paths}
    remaining = sorted(by_path)
    groups = []
    while remaining:
        representative = remaining.pop(0)
        group = [representative]
        for candidate in list(remaining):
            if all(by_path[member] - by_path[candidate] <= threshold for member in group):
                group.append(candidate)
                remaining.remove(candidate)
        if len(group) > 1:
            groups.append({"representative_path": representative, "members": [
                {"relative_path": path, "hamming_distance_to_representative": int(by_path[representative] - by_path[path]),
                 "hash_bit_agreement_percent": round((1 - (by_path[representative] - by_path[path]) / 64) * 100, 2)} for path in group],
                "pairwise_distances": [{"path_a": a, "path_b": b, "hamming_distance": int(by_path[a] - by_path[b])}
                                       for i, a in enumerate(group) for b in group[i+1:]],
                "group_strategy": "greedy complete-link; every member pair is within threshold"})
    return groups


def write_csv(path: Path, rows: list[dict[str, object]]) -> None:
    if not rows: path.write_text("", encoding="utf-8"); return
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0])); writer.writeheader(); writer.writerows(rows)


def export_pca(rows: list[dict[str, object]], output: Path) -> dict[str, object]:
    """Standardize scalar descriptors, project with SVD, and export coordinates."""
    excluded = {"relative_path", "class_name", "format", "color_mode"}
    names = [key for key in rows[0] if key not in excluded and isinstance(rows[0][key], (int, float))] if rows else []
    matrix = np.asarray([[float(row[name]) for name in names] for row in rows], dtype=np.float64) if rows else np.empty((0, 0))
    if len(rows) < 2 or matrix.shape[1] == 0:
        return {"feature_names": names, "explained_variance_ratio": [], "note": "At least two measurable images are needed."}
    means = matrix.mean(axis=0); scales = matrix.std(axis=0); scales[scales == 0] = 1
    standardized = (matrix - means) / scales
    _, singular, vt = np.linalg.svd(standardized, full_matrices=False)
    variance = singular**2 / max(len(rows)-1, 1); ratio = variance / variance.sum() if variance.sum() else variance
    coords = standardized @ vt[:min(2, len(vt))].T
    projected = [{"relative_path": row["relative_path"], "class_name": row["class_name"], "PC1": float(coords[i,0]), "PC2": float(coords[i,1]) if coords.shape[1] > 1 else 0.0} for i,row in enumerate(rows)]
    write_csv(output / "pca_coordinates.csv", projected)
    write_pca_plots(output, projected, ratio)
    return {"feature_names": names, "explained_variance_ratio": ratio[:10].tolist(), "cumulative_explained_variance": np.cumsum(ratio[:10]).tolist(), "coordinates_file": "pca_coordinates.csv", "plots": ["pca_scree.svg", "pca_scatter.svg"], "standardized": True}


def write_class_distribution_svg(output: Path, classes: list[dict[str, object]]) -> None:
    """Write a dependency-free SVG bar chart from freshly counted folders."""
    row_height = 30; width = 1000; height = max(140, 90 + row_height * len(classes)); max_count = max((int(row["image_count"]) for row in classes), default=1)
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}"><rect width="100%" height="100%" fill="#ffffff"/><text x="24" y="32" font-family="sans-serif" font-size="20" font-weight="bold">Image count by observed folder</text>']
    for index, row in enumerate(classes):
        y = 62 + row_height * index; name = escape(str(row["class_name"])); count = int(row["image_count"]); share = float(row["percentage"])
        parts.append(f'<text x="24" y="{y+16}" font-family="sans-serif" font-size="12">{name}</text><rect x="430" y="{y}" width="{500*count/max_count:.1f}" height="20" rx="4" fill="#16845b"/><text x="940" y="{y+15}" font-family="sans-serif" font-size="12">{count} · {share:.2f}%</text>')
    parts.append('</svg>'); (output / "class_distribution.svg").write_text("".join(parts), encoding="utf-8")


def write_pca_plots(output: Path, points: list[dict[str, object]], variance: np.ndarray) -> None:
    """Write a scree chart and class-colored PCA scatter as standalone SVGs."""
    width, height, pad = 760, 360, 44
    bars = []
    for index, value in enumerate(variance[:12]):
        bar_h = float(value) * 250; x = pad + index * 52
        bars.append(f'<rect x="{x}" y="{height-pad-bar_h}" width="30" height="{bar_h:.2f}" fill="#16845b"/><text x="{x+15}" y="{height-pad+18}" text-anchor="middle" font-size="10">PC{index+1}</text>')
    (output / "pca_scree.svg").write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}"><rect width="100%" height="100%" fill="white"/><text x="24" y="28" font-family="sans-serif" font-size="18" font-weight="bold">PCA explained variance</text>{"".join(bars)}<text x="{pad}" y="{height-pad-260}" font-size="10">Explained variance ratio</text></svg>', encoding="utf-8")
    if not points:
        return
    xs = [float(point["PC1"]) for point in points]; ys = [float(point["PC2"]) for point in points]
    min_x, max_x = min(xs), max(xs); min_y, max_y = min(ys), max(ys); span_x = max(max_x-min_x, 1e-9); span_y = max(max_y-min_y, 1e-9)
    classes = sorted({str(point["class_name"]) for point in points}); circles = []
    for point in points:
        x = pad + (float(point["PC1"])-min_x)/span_x*(width-2*pad); y = height-pad-(float(point["PC2"])-min_y)/span_y*(height-2*pad); hue = classes.index(str(point["class_name"]))*360/max(len(classes),1)
        circles.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="3" fill="hsl({hue:.1f},60%,38%)" fill-opacity=".7"><title>{escape(str(point["relative_path"]))} · {escape(str(point["class_name"]))}</title></circle>')
    legend = " · ".join(escape(name) for name in classes)
    (output / "pca_scatter.svg").write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}"><rect width="100%" height="100%" fill="white"/><text x="24" y="28" font-family="sans-serif" font-size="18" font-weight="bold">PCA projection · colored by observed folder</text><text x="{width/2}" y="{height-8}" text-anchor="middle" font-size="12">PC1</text><text x="20" y="{height/2}" transform="rotate(-90 20 {height/2})" text-anchor="middle" font-size="12">PC2</text>{"".join(circles)}<text x="{pad}" y="{height-25}" font-size="9">{legend[:600]}</text></svg>', encoding="utf-8")


def average_ranks(values: np.ndarray) -> np.ndarray:
    order = np.argsort(values, kind="mergesort"); sorted_values = values[order]; ranks = np.empty(len(values), dtype=np.float64); start = 0
    while start < len(values):
        end = start + 1
        while end < len(values) and sorted_values[end] == sorted_values[start]: end += 1
        ranks[order[start:end]] = (start + end - 1) / 2 + 1; start = end
    return ranks


def main() -> None:
    parser = argparse.ArgumentParser(description="Compute a readable CropLens-style Phase 1 image inventory and features.")
    parser.add_argument("dataset", type=Path, help="Read-only dataset directory")
    parser.add_argument("--output", type=Path, default=Path("phase1-analysis-output"), help="New output directory")
    args = parser.parse_args(); root = args.dataset.expanduser().resolve(); output = args.output.expanduser().resolve()
    if not root.is_dir(): parser.error(f"Dataset directory not found: {root}")
    if output == root or root in output.parents: parser.error("Choose an output directory outside the source dataset.")
    output.mkdir(parents=True, exist_ok=True)
    discovered = discover_images(root); inventory = []; features = []; failures = []
    for path, label in discovered:
        relative = path.relative_to(root).as_posix()
        try:
            with Image.open(path) as image: image.verify()
            measured = image_measurements(path)
            measured["file_size_bytes"] = path.stat().st_size
            inventory.append({"relative_path": relative, "class_name": label, "file_size_bytes": path.stat().st_size, "extension": path.suffix.lower(), "decoded_format": measured["format"], "width": measured["width"], "height": measured["height"], "color_mode": measured["color_mode"]})
            features.append({"relative_path": relative, "class_name": label, "quality_flags": {}, **measured})
        except Exception as error:
            failures.append({"relative_path": relative, "error": f"{type(error).__name__}: {error}"})
    class_counts = Counter(row["class_name"] for row in inventory)
    class_rows = [{"class_name": name, "image_count": count, "percentage": 100*count/max(len(inventory),1)} for name,count in sorted(class_counts.items())]
    write_class_distribution_svg(output, class_rows)
    # Dataset-relative Tukey fences match production's candidate-review rule.
    for metric in ("brightness_mean", "contrast_std", "laplacian_variance", "noise_mad_estimate", "pixel_count", "file_size_bytes"):
        values = np.asarray([float(row[metric]) for row in features], dtype=np.float64)
        if not len(values):
            continue
        lower_q, upper_q = np.quantile(values, [0.25, 0.75]); spread = upper_q - lower_q
        lower, upper = lower_q - 1.5 * spread, upper_q + 1.5 * spread
        for row in features:
            value = float(row[metric])
            if value < lower or value > upper:
                row["quality_flags"][metric] = {"value": value, "lower_fence": float(lower), "upper_fence": float(upper), "rule": "Tukey 1.5×IQR; review candidate only"}
    exact = defaultdict(list)
    valid_paths = {row["relative_path"] for row in inventory}
    for path, label in discovered:
        relative = path.relative_to(root).as_posix()
        if relative not in valid_paths:
            continue
        try: exact[sha256_file(path)].append(relative)
        except OSError: pass
    exact_rows = [{"sha256": digest, "paths": " | ".join(paths), "group_size": len(paths)} for digest,paths in exact.items() if len(paths)>1]
    exact_paths = {path for paths in exact.values() if len(paths)>1 for path in paths}
    near_groups = near_duplicate_groups([{"path": path, "relative_path": path.relative_to(root).as_posix()} for path,_ in discovered if path.relative_to(root).as_posix() in valid_paths], exact_paths)
    pca = export_pca(features, output)
    # Pearson correlations mirror the production display's numeric descriptors.
    excluded = {"relative_path", "class_name", "format", "color_mode"}
    numeric_names = [key for key in features[0] if key not in excluded and not key.startswith(("rgb_", "hsv_", "lbp_")) and isinstance(features[0][key], (int, float))] if features else []
    if len(features) > 1 and numeric_names:
        matrix = np.asarray([[float(row[name]) for name in numeric_names] for row in features])
        matrix = np.nan_to_num(matrix)
        correlation = np.corrcoef(matrix, rowvar=False)
        ranks = np.column_stack([average_ranks(matrix[:, index]) for index in range(matrix.shape[1])])
        spearman = np.corrcoef(ranks, rowvar=False)
        correlation_rows = [{"feature_a": numeric_names[i], "feature_b": numeric_names[j], "pearson": float(correlation[i,j]), "spearman": float(spearman[i,j])}
                            for i in range(len(numeric_names)) for j in range(i+1, len(numeric_names)) if np.isfinite(correlation[i,j]) and np.isfinite(spearman[i,j])]
        correlation_rows.sort(key=lambda row: abs(row["pearson"]), reverse=True)
    else:
        correlation_rows = []
    write_csv(output/"image_inventory.csv", inventory); write_csv(output/"class_distribution.csv", class_rows); write_csv(output/"image_features.csv", features); write_csv(output/"feature_correlations.csv", correlation_rows); write_csv(output/"exact_duplicates.csv", exact_rows); write_csv(output/"near_duplicate_groups.csv", [{"representative_path": group["representative_path"], "members": json.dumps(group["members"]), "pairwise_distances": json.dumps(group["pairwise_distances"]), "threshold": 8} for group in near_groups]); write_csv(output/"decode_failures.csv", failures)
    report = {"dataset_root": str(root), "discovered_candidates": len(discovered), "decoded_images": len(inventory), "decode_failures": len(failures), "observed_classes": len(class_rows), "format_counts": dict(Counter(row["decoded_format"] for row in inventory)), "color_mode_counts": dict(Counter(row["color_mode"] for row in inventory)), "exact_duplicate_groups": len(exact_rows), "near_duplicate_groups_at_hamming_8": len(near_groups), "near_duplicate_group_details": near_groups, "strongest_correlations": correlation_rows[:20], "pca": pca, "method_note": "Folder-derived labels and image descriptors are exploratory evidence, not semantic disease validation."}
    (output/"dataset_summary.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2)); print(f"\nWrote fresh results to: {output}")


if __name__ == "__main__":
    main()
