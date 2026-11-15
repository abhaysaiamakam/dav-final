"""Deterministic, version-scoped image measurements and classical feature analysis."""
from __future__ import annotations

import hashlib
import math
import platform
import uuid
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import PIL
from PIL import Image, ImageFilter, ImageOps

from app.schemas.image_intelligence import ImageIntelligenceRequest, ImageIntelligenceResponse
from app.services.image_explorer_service import image_explorer_service
from app.services.perceptual_hash_service import perceptual_hash_service
from app.schemas.dataset import PerceptualHashAlgorithm
from app.storage.local import storage_backend
from app.services.safe_image_decoder import draft_for_preview, open_image


ALGORITHM_VERSION = "image-intelligence-v1.0"
FAMILY_NAMES = {"rgb", "hsv", "statistics", "glcm", "lbp", "edge"}


def _gray(arr: np.ndarray) -> np.ndarray:
    return arr[..., 0] * 0.299 + arr[..., 1] * 0.587 + arr[..., 2] * 0.114


def _glcm_features(gray: np.ndarray, levels: int = 16) -> dict[str, float]:
    """Mean GLCM descriptors across four symmetric unit-offset directions."""
    quantized = np.minimum((gray.astype(np.uint16) * levels) // 256, levels - 1)
    directions = [(0, 1), (-1, 1), (-1, 0), (-1, -1)]
    values: dict[str, list[float]] = {"contrast": [], "homogeneity": [], "energy": [], "correlation": []}
    for dy, dx in directions:
        y0, y1 = max(0, -dy), min(quantized.shape[0], quantized.shape[0] - dy)
        x0, x1 = max(0, -dx), min(quantized.shape[1], quantized.shape[1] - dx)
        left = quantized[y0:y1, x0:x1].ravel()
        right = quantized[y0 + dy:y1 + dy, x0 + dx:x1 + dx].ravel()
        matrix = np.zeros((levels, levels), dtype=np.float64)
        np.add.at(matrix, (left, right), 1)
        matrix += matrix.T
        total = matrix.sum()
        if total == 0:
            continue
        matrix /= total
        i, j = np.indices(matrix.shape)
        px, py = (matrix * i).sum(), (matrix * j).sum()
        sx = math.sqrt(float((matrix * (i - px) ** 2).sum()))
        sy = math.sqrt(float((matrix * (j - py) ** 2).sum()))
        values["contrast"].append(float((matrix * (i - j) ** 2).sum()))
        values["homogeneity"].append(float((matrix / (1 + (i - j) ** 2)).sum()))
        values["energy"].append(float(np.sqrt((matrix**2).sum())))
        correlation = float((matrix * (i - px) * (j - py)).sum() / (sx * sy)) if sx and sy else 0.0
        values["correlation"].append(correlation)
    return {f"glcm_{key}": float(np.mean(items)) if items else 0.0 for key, items in values.items()}


def _lbp_histogram(gray: np.ndarray) -> dict[str, float]:
    """Rotation-invariant 8-neighbour uniform LBP histogram (nine bins + non-uniform)."""
    center = gray[1:-1, 1:-1]
    neighbors = [gray[1 + dy:gray.shape[0] - 1 + dy, 1 + dx:gray.shape[1] - 1 + dx] for dy, dx in
                 [(-1, -1), (-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1)]]
    codes = np.zeros(center.shape, dtype=np.uint8)
    bits = []
    for index, neighbor in enumerate(neighbors):
        bit = neighbor >= center
        bits.append(bit)
        codes |= bit.astype(np.uint8) << index
    transitions = np.zeros(center.shape, dtype=np.uint8)
    for i in range(8):
        transitions += bits[i] != bits[(i + 1) % 8]
    ones = np.zeros(center.shape, dtype=np.uint8)
    for bit in bits:
        ones += bit
    bins = np.where(transitions <= 2, ones, 9)
    hist = np.bincount(bins.ravel(), minlength=10).astype(np.float64)
    hist /= hist.sum() or 1.0
    return {f"lbp_bin_{index}": float(value) for index, value in enumerate(hist)}


def _image_features(path: Path, max_edge: int) -> tuple[dict[str, float], dict[str, Any]]:
    with open_image(path) as opened:
        source_format, source_mode, width, height = opened.format, opened.mode, opened.size[0], opened.size[1]
        draft_for_preview(opened, max_edge)
        oriented = ImageOps.exif_transpose(opened)
        proxy = oriented.convert("RGB")
        proxy.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
        rgb = np.asarray(proxy, dtype=np.uint8)
        gray = _gray(rgb)
        features: dict[str, float] = {
            "width": float(width), "height": float(height), "aspect_ratio": width / height if height else 0.0,
            "pixel_count": float(width * height),
            "brightness_mean": float(gray.mean()), "brightness_median": float(np.median(gray)),
            "contrast_std": float(gray.std()),
        }
        # Discrete Laplacian variance is a sharpness/blur proxy, not a universal quality score.
        if gray.shape[0] >= 3 and gray.shape[1] >= 3:
            core = gray[1:-1, 1:-1]
            laplace = gray[:-2, 1:-1] + gray[2:, 1:-1] + gray[1:-1, :-2] + gray[1:-1, 2:] - 4 * core
            features["laplacian_variance"] = float(laplace.var())
        else:
            features["laplacian_variance"] = 0.0
        # Robust high-frequency residual estimate; texture and edges also contribute.
        median = np.asarray(Image.fromarray(np.uint8(np.clip(gray, 0, 255))).filter(ImageFilter.MedianFilter(3)), dtype=np.float64)
        residual = gray - median
        features["noise_mad_estimate"] = float(np.median(np.abs(residual - np.median(residual))) / 0.6745)
        padded = np.pad(gray, 1, mode="edge")
        gx = (padded[:-2, 2:] + 2 * padded[1:-1, 2:] + padded[2:, 2:]
              - padded[:-2, :-2] - 2 * padded[1:-1, :-2] - padded[2:, :-2]) / 8
        gy = (padded[2:, :-2] + 2 * padded[2:, 1:-1] + padded[2:, 2:]
              - padded[:-2, :-2] - 2 * padded[:-2, 1:-1] - padded[:-2, 2:]) / 8
        magnitude = np.hypot(gx, gy)
        features["sobel_magnitude_mean"] = float(magnitude.mean())
        features["sobel_edge_density_p90"] = float((magnitude >= np.percentile(magnitude, 90)).mean())
        for channel, name in enumerate(("r", "g", "b")):
            plane = rgb[..., channel]
            features[f"{name}_mean"] = float(plane.mean())
            features[f"{name}_std"] = float(plane.std())
            hist = np.histogram(plane, bins=16, range=(0, 256))[0].astype(np.float64)
            hist /= hist.sum() or 1.0
            features.update({f"rgb_{name}_hist_{i}": float(value) for i, value in enumerate(hist)})
        hsv = np.asarray(proxy.convert("HSV"), dtype=np.uint8)
        for channel, name in enumerate(("h", "s", "v")):
            plane = hsv[..., channel]
            features[f"hsv_{name}_mean"] = float(plane.mean())
            features[f"hsv_{name}_std"] = float(plane.std())
            hist = np.histogram(plane, bins=8, range=(0, 256))[0].astype(np.float64)
            hist /= hist.sum() or 1.0
            features.update({f"hsv_{name}_hist_{i}": float(value) for i, value in enumerate(hist)})
        features.update(_glcm_features(gray))
        features.update(_lbp_histogram(gray))
        metadata = {"format": source_format or "unknown", "mode": source_mode, "proxy_width": rgb.shape[1], "proxy_height": rgb.shape[0]}
        return features, metadata


def _distribution(values: list[float]) -> dict[str, Any]:
    a = np.asarray(values, dtype=np.float64)
    if not len(a):
        return {"count": 0}
    q1, median, q3 = np.quantile(a, [0.25, 0.5, 0.75])
    variance = float(a.var())
    centered = a - a.mean()
    skew = float(np.mean(centered**3) / variance**1.5) if variance else 0.0
    kurtosis = float(np.mean(centered**4) / variance**2 - 3) if variance else 0.0
    return {"count": int(len(a)), "mean": float(a.mean()), "median": float(median), "min": float(a.min()), "max": float(a.max()),
            "std": float(a.std()), "variance": variance, "q1": float(q1), "q3": float(q3), "iqr": float(q3-q1), "skewness": skew, "excess_kurtosis": kurtosis}


def _rank(values: np.ndarray) -> np.ndarray:
    order = np.argsort(values, kind="mergesort")
    sorted_values = values[order]
    ranks = np.empty(len(values), dtype=np.float64)
    start = 0
    while start < len(values):
        end = start + 1
        while end < len(values) and sorted_values[end] == sorted_values[start]:
            end += 1
        ranks[order[start:end]] = (start + end - 1) / 2 + 1
        start = end
    return ranks


def _correlation(rows: list[dict[str, Any]], feature_names: list[str]) -> dict[str, Any]:
    if len(rows) < 2:
        return {"pearson": {}, "spearman": {}, "top_pairs": [], "note": "At least two images are required."}
    matrix = np.asarray([[row["features"].get(key, 0.0) for key in feature_names] for row in rows], dtype=np.float64)
    def corr(data: np.ndarray) -> np.ndarray:
        std = data.std(axis=0)
        safe = np.where(std > 0, std, 1)
        standardized = (data - data.mean(axis=0)) / safe
        # Constant features remain zero columns and therefore correlate as zero.
        return (standardized.T @ standardized) / len(data)
    pearson = corr(matrix)
    spearman = corr(np.column_stack([_rank(matrix[:, i]) for i in range(matrix.shape[1])]))
    pairs = []
    for i in range(len(feature_names)):
        for j in range(i + 1, len(feature_names)):
            value = float(pearson[i, j])
            if abs(value) >= 0.8:
                pairs.append({"feature_a": feature_names[i], "feature_b": feature_names[j], "pearson": value, "spearman": float(spearman[i, j])})
    pairs.sort(key=lambda item: (-abs(item["pearson"]), item["feature_a"], item["feature_b"]))
    matrix_json = lambda m: {name: {other: float(m[i, j]) for j, other in enumerate(feature_names)} for i, name in enumerate(feature_names)}
    return {"pearson": matrix_json(pearson), "spearman": matrix_json(spearman), "top_pairs": pairs[:100],
            "note": "Correlations are descriptive associations among numeric image measurements; they do not establish causality. Constant columns have zero correlations by convention."}


def _complete_link_groups(paths: list[str], hashes: dict[str, str], threshold: int) -> tuple[list[dict[str, Any]], int]:
    """Deterministic greedy complete-link grouping; prevents connected-chain inflation."""
    remaining = set(paths)
    groups: list[dict[str, Any]] = []
    candidate_pairs = 0
    for seed in paths:
        if seed not in remaining:
            continue
        group = [seed]
        remaining.remove(seed)
        for candidate in sorted(remaining):
            distances = [perceptual_hash_service.compute_hamming_distance(hashes[candidate], hashes[member]) for member in group]
            candidate_pairs += len(distances)
            if distances and max(distances) <= threshold:
                group.append(candidate)
                remaining.remove(candidate)
        if len(group) > 1:
            representative = group[0]
            members = []
            for path in group:
                distance = perceptual_hash_service.compute_hamming_distance(hashes[representative], hashes[path])
                members.append({"relative_path": path, "perceptual_hash": hashes[path], "hamming_distance_to_representative": distance,
                                "hash_bit_agreement_percent": round((1 - distance / 64) * 100, 2)})
            pairwise = [{"path_a": a, "path_b": b, "hamming_distance": perceptual_hash_service.compute_hamming_distance(hashes[a], hashes[b])}
                        for i, a in enumerate(group) for b in group[i + 1:]]
            groups.append({"representative_path": representative, "members": members, "pairwise_distances": pairwise, "group_strategy": "greedy complete-link; every member pair is within threshold"})
        else:
            remaining.add(seed)
    return groups, candidate_pairs


class ImageIntelligenceService:
    """Computes version-bound visual measurements without mutating source files."""

    @staticmethod
    def _result_path(dataset_id: str, version_id: str) -> Path:
        key = hashlib.sha256(f"{dataset_id}:{version_id}".encode()).hexdigest()
        return storage_backend.results_dir / "image-intelligence" / key / "latest.json"

    def get_result(self, dataset_id: str, version_id: str) -> ImageIntelligenceResponse:
        # Validate that the referenced dataset version still exists before serving a cached result.
        image_explorer_service._version_root(dataset_id, version_id)
        path = self._result_path(dataset_id, version_id)
        if not path.is_file():
            raise FileNotFoundError("No image intelligence result exists for this version")
        return ImageIntelligenceResponse.model_validate_json(path.read_text(encoding="utf-8"))

    def analyze(self, dataset_id: str, version_id: str, config: ImageIntelligenceRequest) -> ImageIntelligenceResponse:
        unknown = set(config.feature_families) - FAMILY_NAMES
        if unknown:
            raise ValueError(f"Unsupported feature families: {', '.join(sorted(unknown))}")
        root = image_explorer_service._version_root(dataset_id, version_id)
        records = image_explorer_service._records(root)
        measurements: list[dict[str, Any]] = []
        failures: list[str] = []
        phashes: dict[str, str] = {}
        sha_groups: dict[str, list[str]] = {}
        extensions: Counter[str] = Counter()
        extension_formats: Counter[str] = Counter()
        modes: Counter[str] = Counter()
        basename_counts = Counter(Path(item[0]).name.casefold() for item in records)
        duplicate_basenames = sorted(name for name, count in basename_counts.items() if count > 1)

        for relative, class_name, size, path in records:
            extensions[path.suffix.lower() or "[none]"] += 1
            try:
                features, meta = _image_features(path, config.analysis_max_edge)
                features["file_size_bytes"] = float(size)
                # Keep core quality statistics available; optional visual families can be selected.
                def included(feature: str) -> bool:
                    if feature in {"width", "height", "aspect_ratio", "pixel_count", "file_size_bytes", "brightness_mean", "brightness_median", "contrast_std", "laplacian_variance", "noise_mad_estimate"}:
                        return True
                    if feature.startswith(("rgb_", "r_mean", "r_std", "g_mean", "g_std", "b_mean", "b_std")):
                        return "rgb" in config.feature_families
                    if feature.startswith(("hsv_", "h_mean", "h_std", "s_mean", "s_std", "v_mean", "v_std")):
                        return "hsv" in config.feature_families
                    if feature.startswith("glcm_"):
                        return "glcm" in config.feature_families
                    if feature.startswith("lbp_"):
                        return "lbp" in config.feature_families
                    if feature.startswith("sobel_"):
                        return "edge" in config.feature_families
                    return "statistics" in config.feature_families
                features = {key: value for key, value in features.items() if included(key)}
                measurements.append({"image_id": image_explorer_service._id(relative), "relative_path": relative, "class_name": class_name, "file_size_bytes": size,
                                     "format": meta["format"], "mode": meta["mode"], "features": features})
                extension_formats[f"{path.suffix.lower() or '[none]'} → {meta['format']}"] += 1
                modes[meta["mode"]] += 1
                digest = hashlib.sha256()
                with path.open("rb") as source:
                    for block in iter(lambda: source.read(1024 * 1024), b""):
                        digest.update(block)
                sha_groups.setdefault(digest.hexdigest(), []).append(relative)
                phashes[relative] = perceptual_hash_service.compute_hash(path, PerceptualHashAlgorithm.PHASH, 8)
            except Exception as exc:
                failures.append(relative)

        classes = Counter(row["class_name"] for row in measurements)
        class_counts = list(classes.values())
        maximum = max(class_counts, default=0)
        minimum = min(class_counts, default=0)
        total = len(measurements)
        probs = [count / total for count in class_counts] if total else []
        entropy = -sum(p * math.log2(p) for p in probs if p)
        class_balance = {"class_count": len(classes), "minimum_count": minimum, "maximum_count": maximum,
                         "majority_minority_ratio": maximum / minimum if minimum else None,
                         "entropy_bits": entropy, "normalized_entropy": entropy / math.log2(len(classes)) if len(classes) > 1 else (0.0 if classes else None),
                         "interpretation": "Observed directory class frequencies only; folder labels are not independently verified."}

        all_feature_names = sorted({key for row in measurements for key in row["features"]})
        distributions = {name: _distribution([row["features"][name] for row in measurements if name in row["features"]]) for name in all_feature_names}
        # Keep the matrix compact by correlating interpretable scalar measurements, not histogram bins.
        correlation_features = [name for name in all_feature_names if not ("hist_" in name or "lbp_bin_" in name)]
        correlations = _correlation(measurements, correlation_features)

        # Candidate outliers are dataset-relative Tukey fences; this is not a universal quality cutoff.
        flags: dict[str, dict[str, Any]] = {}
        feature_names = ["brightness_mean", "contrast_std", "laplacian_variance", "noise_mad_estimate", "pixel_count", "file_size_bytes"]
        limits: dict[str, tuple[float, float]] = {}
        for name in feature_names:
            values = np.asarray([row["features"][name] for row in measurements], dtype=np.float64)
            if not len(values):
                continue
            q1, q3 = np.quantile(values, [0.25, 0.75]); iqr = q3 - q1
            low, high = float(q1 - 1.5 * iqr), float(q3 + 1.5 * iqr)
            limits[name] = (low, high)
            for row in measurements:
                value = row["features"][name]
                if value < low or value > high:
                    flags.setdefault(row["relative_path"], {})[name] = {"value": value, "lower_fence": low, "upper_fence": high, "rule": "Tukey 1.5×IQR; dataset-relative candidate only"}
        for row in measurements:
            row["quality_flags"] = flags.get(row["relative_path"], {})

        # Selected feature matrix PCA; family-prefixed feature names keep definitions traceable.
        family_prefixes = {"rgb": ("rgb_",), "hsv": ("hsv_",), "statistics": ("width", "height", "aspect_ratio", "pixel_count", "file_size_bytes", "brightness_", "contrast_", "laplacian_", "noise_"),
                           "glcm": ("glcm_",), "lbp": ("lbp_",), "edge": ("sobel_",)}
        selected_features = [name for name in all_feature_names if any(name.startswith(prefix) for family in config.feature_families for prefix in family_prefixes[family])]
        pca: dict[str, Any] = {"status": "not_assessed", "feature_names": selected_features, "components": [], "explained_variance_ratio": [], "cumulative_explained_variance": [], "coordinates": []}
        if len(measurements) >= 2 and selected_features:
            matrix = np.asarray([[row["features"].get(name, 0) for name in selected_features] for row in measurements], dtype=np.float64)
            means = matrix.mean(axis=0)
            scales = matrix.std(axis=0) if config.standardize_features else np.ones(matrix.shape[1])
            scales = np.where(scales > 0, scales, 1)
            centered = (matrix - means) / scales
            _, singular, vt = np.linalg.svd(centered, full_matrices=False)
            variance = singular**2
            ratio = variance / variance.sum() if variance.sum() else np.zeros(len(variance))
            pca = {"status": "computed", "feature_names": selected_features, "standardized": config.standardize_features,
                   "explained_variance_ratio": [float(x) for x in ratio], "cumulative_explained_variance": [float(x) for x in np.cumsum(ratio)],
                   "components": [{"component": f"PC{i+1}", "loadings": [{"feature": selected_features[j], "loading": float(vt[i, j])} for j in np.argsort(np.abs(vt[i]))[::-1][:20]]} for i in range(min(2, vt.shape[0]))],
                   "coordinates": [{"relative_path": row["relative_path"], "class_name": row["class_name"], "PC1": float(point[0]), "PC2": float(point[1]) if len(point)>1 else 0.0} for row, point in zip(measurements, centered @ vt[:2].T)],
                   "limitation": "PCA describes variance in the selected numeric features; 2D separation is exploratory and is not a disease classifier."}

        exact_paths = {path for paths in sha_groups.values() if len(paths) > 1 for path in paths}
        candidates = sorted(path for path in phashes if path not in exact_paths)
        groups, checked_pairs = _complete_link_groups(candidates, phashes, config.phash_distance_threshold)
        split_aliases = {"train": "train", "training": "train", "val": "validation", "valid": "validation", "validation": "validation", "test": "test", "testing": "test"}
        split_by_path: dict[str, str] = {}
        for relative, *_ in records:
            for part in Path(relative).parts:
                if part.casefold() in split_aliases:
                    split_by_path[relative] = split_aliases[part.casefold()]
                    break
        split_counts = Counter(split_by_path.values())
        near_cross_split = []
        for group in groups:
            member_splits = sorted({split_by_path[path] for path in [member["relative_path"] for member in group["members"]] if path in split_by_path})
            if len(member_splits) > 1:
                near_cross_split.append({"representative_path": group["representative_path"], "observed_splits": member_splits,
                                         "member_paths": [member["relative_path"] for member in group["members"]]})
        exact_cross_split = []
        for digest, paths in sha_groups.items():
            member_splits = sorted({split_by_path[path] for path in paths if path in split_by_path})
            if len(paths) > 1 and len(member_splits) > 1:
                exact_cross_split.append({"sha256_prefix": digest[:16], "observed_splits": member_splits, "member_paths": sorted(paths)})
        leakage = {"status": "candidate_groups_found" if exact_cross_split or near_cross_split else ("no_cross_split_candidates_observed" if split_counts else "unavailable_no_explicit_split_directories"),
                   "observed_split_counts": dict(sorted(split_counts.items())),
                   "candidate_cross_split_exact_groups": exact_cross_split,
                   "candidate_cross_split_near_duplicate_groups": near_cross_split,
                   "limitation": "Split assignments are inferred only from exact path segments and require dataset-owner verification. No directory token means leakage cannot be assessed; similar images do not independently prove leakage."}
        near_duplicates = {"algorithm": "64-bit pHash", "distance_threshold": config.phash_distance_threshold,
                           "candidate_images": len(candidates), "candidate_pairs_compared_for_grouping": checked_pairs,
                           "groups": groups, "group_count": len(groups),
                           "bit_agreement_definition": "100 × (1 − Hamming distance / 64); this is not a probability of visual identity.",
                           "exact_duplicate_paths_excluded": len(exact_paths)}
        metrics = ["brightness_mean", "contrast_std", "laplacian_variance", "noise_mad_estimate", "pixel_count", "file_size_bytes"]
        flag_counts = {name: sum(name in row["quality_flags"] for row in measurements) for name in metrics}
        findings: list[dict[str, Any]] = []
        format_mismatches = []
        equivalent_extensions = {"jpg": "jpeg", "jpe": "jpeg", "tif": "tiff"}
        for pair, count in sorted(extension_formats.items()):
            suffix, decoded = [value.strip().lower() for value in pair.split("→", 1)]
            decoded_suffix = decoded.lstrip(".")
            if suffix.startswith(".") and equivalent_extensions.get(suffix[1:], suffix[1:]) != equivalent_extensions.get(decoded_suffix, decoded_suffix):
                format_mismatches.append({"extension": suffix, "decoded_format": decoded.upper(), "count": count})
        if format_mismatches:
            findings.append({"id": "image-format-suffix-mismatch", "title": "Filename suffix and decoded format differ",
                             "observation": f"{sum(item['count'] for item in format_mismatches)} images use suffixes that differ from Pillow's decoded format.",
                             "evidence": {"pairs": format_mismatches}, "suggested_action": "Review affected samples and downstream decoder compatibility before renaming or converting files.",
                             "limitations": "A suffix mismatch can still be a valid image encoding and does not imply corruption."})
        if class_counts:
            findings.append({"id": "observed-class-distribution", "title": "Observed directory class distribution",
                             "observation": f"{len(classes)} directory-derived classes contain {minimum} to {maximum} analyzed images each.",
                             "evidence": {"class_counts": dict(sorted(classes.items())), "majority_minority_ratio": class_balance["majority_minority_ratio"], "entropy_bits": entropy},
                             "suggested_action": "Use class-aware evaluation and inspect minority-class support when defining splits or metrics.",
                             "limitations": "Directory-derived labels are observations and are not independently verified; counts alone do not justify resampling."})
        if flags:
            findings.append({"id": "image-quality-review-candidates", "title": "Images fall outside dataset-relative metric ranges",
                             "observation": f"{len(flags)} images have one or more Tukey-fence flags across pixel and file measurements.",
                             "evidence": {"candidate_image_count": len(flags), "metric_counts": flag_counts},
                             "suggested_action": "Inspect the linked source images and determine whether the measurements reflect acquisition, class-specific appearance, or a processing issue.",
                             "limitations": "IQR fences only identify distributional extremes. They do not diagnose blur, noise, or incorrect labels."})
        if groups:
            findings.append({"id": "perceptual-near-duplicates", "title": "Perceptually similar image groups were detected",
                             "observation": f"{len(groups)} complete-link groups satisfy the configured pHash Hamming threshold of {config.phash_distance_threshold}.",
                             "evidence": {"group_count": len(groups), "candidate_images": len(candidates), "distance_threshold": config.phash_distance_threshold},
                             "suggested_action": "Review group members and check verified train/validation/test assignments before model evaluation.",
                             "limitations": "Hash agreement is not a probability of visual identity; similar appearance does not establish biological identity. Split leakage is unavailable without verified split assignments."})
        if exact_cross_split or near_cross_split:
            findings.append({"id": "possible-cross-split-duplicates", "title": "Duplicate candidates cross observed split folders",
                             "observation": f"{len(exact_cross_split)} exact and {len(near_cross_split)} near-duplicate groups span path segments named as separate splits.",
                             "evidence": {"exact_groups": exact_cross_split, "near_duplicate_groups": near_cross_split},
                             "suggested_action": "Verify split definitions and review affected image groups before evaluating a model.",
                             "limitations": leakage["limitation"]})
        if pca.get("status") == "computed":
            findings.append({"id": "image-feature-pca", "title": "Image feature variance is summarized by PCA",
                             "observation": "The first two principal components summarize variance in the selected numeric feature matrix.",
                             "evidence": {"explained_variance_ratio": pca["explained_variance_ratio"], "feature_count": len(selected_features), "image_count": len(measurements)},
                             "suggested_action": "Use the projection to inspect feature-space structure and compare it with source images and class folders.",
                             "limitations": "PCA is descriptive, lossy, and unsupervised; it does not establish classification performance or disease separation."})
        unreadable = len(records) - len(measurements)
        payload = {"analysis_id": f"img-{uuid.uuid4().hex[:12]}", "dataset_id": dataset_id, "version_id": version_id,
                   "created_at": datetime.now(timezone.utc).isoformat(), "methodology_version": ALGORITHM_VERSION,
                   "provenance": {"python_version": platform.python_version(), "numpy_version": np.__version__, "pillow_version": PIL.__version__},
                   "configuration": config.model_dump(), "total_images": len(records), "analyzed_images": len(measurements), "unreadable_images": unreadable,
                   "class_distribution": dict(sorted(classes.items())), "class_balance": class_balance,
                   "metadata_consistency": {"extension_counts": dict(extensions), "extension_to_format_counts": dict(extension_formats), "mode_counts": dict(modes),
                                            "duplicate_filename_count": len(duplicate_basenames), "duplicate_filenames": duplicate_basenames,
                                            "unreadable_paths": failures, "explicit_split_available": bool(split_counts), "observed_split_counts": dict(sorted(split_counts.items()))},
                   "numeric_distributions": distributions, "correlation": correlations,
                   "feature_families": {"rgb_histogram": {"bins_per_channel": 16, "dimensions": 48, "normalization": "each 16-bin channel histogram is normalized to sum to one; the existing 48-dimensional representation is preserved"},
                                         "hsv_histogram": {"bins_per_channel": 8, "dimensions": 24, "encoding": "Pillow HSV 8-bit channels; normalized per channel"},
                                         "glcm": {"levels": 16, "distance": 1, "angles_degrees": [0, 45, 90, 135], "symmetric": True, "normalized": True,
                                                  "descriptors": ["contrast", "homogeneity", "energy", "correlation"]},
                                         "lbp": {"neighbors": 8, "radius": 1, "bins": 10, "encoding": "rotation-invariant uniform LBP; non-uniform patterns share final bin"},
                                         "edge": {"method": "3×3 Sobel gradient kernels with edge padding", "summaries": ["mean magnitude", "share above within-image 90th percentile"]},
                                         "noise_estimate": "median absolute deviation of grayscale residual after a 3x3 median filter divided by 0.6745; texture and edges also contribute"},
                   "pca": pca, "quality_flags": {"rule": "Tukey 1.5×IQR per selected metric; candidate anomalies, not defects", "metric_counts": flag_counts,
                                                     "candidate_image_count": len(flags), "candidates": [{"relative_path": path, "class_name": next((r["class_name"] for r in measurements if r["relative_path"] == path), ""), "flags": details} for path, details in sorted(flags.items())]},
                   "image_measurements": measurements, "near_duplicates": near_duplicates, "leakage_investigation": leakage, "findings": findings,
                   "limitations": ["Measurements operate on an EXIF-oriented RGB analysis proxy with maximum edge set in configuration; source files remain unchanged.",
                                   "Laplacian variance depends on image scale, texture, and acquisition; IQR flags are dataset-relative review candidates, not universal quality thresholds.",
                                   "Noise estimate also responds to texture, edges, compression, and resampling; it is not a sensor-noise measurement.",
                                   "Visual similarity and feature-space structure do not establish biological identity or disease classification accuracy.",
                                   "Split availability is inferred only from relative path tokens and does not establish leakage without verified split assignments."]}
        response = ImageIntelligenceResponse.model_validate(payload)
        result_path = self._result_path(dataset_id, version_id)
        result_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = result_path.with_suffix(f".{uuid.uuid4().hex}.tmp")
        temporary.write_text(response.model_dump_json(indent=2), encoding="utf-8")
        temporary.replace(result_path)
        return response


image_intelligence_service = ImageIntelligenceService()
