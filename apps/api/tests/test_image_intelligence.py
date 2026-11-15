from pathlib import Path

import numpy as np
from PIL import Image

from app.services.image_intelligence_service import (
    ImageIntelligenceService,
    _complete_link_groups,
    _correlation,
    _distribution,
    _glcm_features,
    _image_features,
    _lbp_histogram,
)


def test_image_features_are_finite_for_small_and_regular_images(tmp_path: Path):
    for name, size in (("tiny.png", (1, 1)), ("normal.png", (32, 24))):
        path = tmp_path / name
        Image.new("RGB", size, (100, 150, 200)).save(path)
        features, metadata = _image_features(path, 128)
        assert metadata["format"] == "PNG"
        assert all(np.isfinite(value) for value in features.values())
        assert features["pixel_count"] == size[0] * size[1]


def test_glcm_and_lbp_return_normalized_descriptors():
    gray = np.tile(np.arange(16, dtype=np.float64), (16, 1)) * 16
    glcm = _glcm_features(gray)
    lbp = _lbp_histogram(gray)
    assert set(glcm) == {"glcm_contrast", "glcm_homogeneity", "glcm_energy", "glcm_correlation"}
    assert all(np.isfinite(value) for value in glcm.values())
    assert len(lbp) == 10
    assert np.isclose(sum(lbp.values()), 1.0)


def test_statistics_and_correlations_handle_constant_columns():
    summary = _distribution([1.0, 2.0, 3.0, 4.0])
    assert summary["median"] == 2.5
    assert summary["iqr"] == 1.5
    result = _correlation([
        {"features": {"x": 1.0, "y": 2.0, "constant": 7.0}},
        {"features": {"x": 2.0, "y": 4.0, "constant": 7.0}},
        {"features": {"x": 3.0, "y": 6.0, "constant": 7.0}},
    ], ["x", "y", "constant"])
    assert result["pearson"]["x"]["y"] > 0.99
    assert result["pearson"]["x"]["constant"] == 0


def test_near_duplicate_groups_are_complete_link_and_non_overlapping():
    hashes = {"a": "0000000000000000", "b": "0000000000000001", "c": "ffffffffffffffff"}
    groups, _ = _complete_link_groups(["a", "b", "c"], hashes, threshold=1)
    assert len(groups) == 1
    assert {member["relative_path"] for member in groups[0]["members"]} == {"a", "b"}
    assert groups[0]["pairwise_distances"][0]["hamming_distance"] == 1


def test_version_analysis_persists_and_retrieves_its_result(tmp_path: Path, monkeypatch):
    from app.schemas.image_intelligence import ImageIntelligenceRequest
    from app.services.image_explorer_service import image_explorer_service

    for name, color in (("a.png", (30, 120, 50)), ("b.png", (190, 40, 90))):
        Image.new("RGB", (24, 20), color).save(tmp_path / name)
    (tmp_path / "broken.jpg").write_bytes(b"not an image")
    monkeypatch.setattr(image_explorer_service, "_version_root", lambda dataset_id, version_id: tmp_path)
    service = ImageIntelligenceService()
    result_file = tmp_path / "result.json"
    monkeypatch.setattr(service, "_result_path", lambda dataset_id, version_id: result_file)

    result = service.analyze("dataset-fixture", "version-fixture", ImageIntelligenceRequest())
    restored = service.get_result("dataset-fixture", "version-fixture")

    assert result.total_images == 3
    assert result.analyzed_images == 2
    assert result.unreadable_images == 1
    assert result.version_id == restored.version_id == "version-fixture"
    assert result.analysis_id == restored.analysis_id
    assert result.pca["status"] == "computed"
    assert result.leakage_investigation["status"] == "unavailable_no_explicit_split_directories"


def test_split_leakage_candidates_require_observed_split_path_segments(tmp_path: Path, monkeypatch):
    from app.schemas.image_intelligence import ImageIntelligenceRequest
    from app.services.image_explorer_service import image_explorer_service

    for split in ("train", "validation"):
        path = tmp_path / split / "class-a" / "copy.png"
        path.parent.mkdir(parents=True)
        Image.new("RGB", (16, 16), (30, 60, 90)).save(path)
    monkeypatch.setattr(image_explorer_service, "_version_root", lambda dataset_id, version_id: tmp_path)
    service = ImageIntelligenceService()
    monkeypatch.setattr(service, "_result_path", lambda dataset_id, version_id: tmp_path / "result.json")

    result = service.analyze("dataset-fixture", "version-splits", ImageIntelligenceRequest())

    assert result.leakage_investigation["status"] == "candidate_groups_found"
    assert result.leakage_investigation["observed_split_counts"] == {"train": 1, "validation": 1}
    assert len(result.leakage_investigation["candidate_cross_split_exact_groups"]) == 1
    assert result.near_duplicates["exact_duplicate_paths_excluded"] == 2


def test_original_image_visual_previews_are_version_bound_and_non_mutating(tmp_path: Path, monkeypatch):
    import io

    from app.services.image_explorer_service import image_explorer_service
    from app.services.image_visualization_service import render_image_preview

    source = tmp_path / "class-a" / "leaf.png"
    source.parent.mkdir()
    pixels = np.zeros((32, 40, 3), dtype=np.uint8)
    pixels[:, 20:, 1] = 220
    Image.fromarray(pixels).save(source)
    original = source.read_bytes()
    image_id = image_explorer_service._id("class-a/leaf.png")
    monkeypatch.setattr(image_explorer_service, "_version_root", lambda dataset_id, version_id: tmp_path)

    for operation in ("grayscale", "sobel", "canny", "segmentation"):
        output = Image.open(io.BytesIO(render_image_preview("dataset", "version", image_id, operation)))
        assert output.format == "PNG"
        assert output.size == (40, 32)
    assert source.read_bytes() == original


def test_image_visual_preview_rejects_unlisted_transform(tmp_path: Path):
    from app.services.image_visualization_service import render_image_preview

    try:
        render_image_preview("dataset", "version", "image", "invented")
    except ValueError as error:
        assert "operation must be" in str(error)
    else:
        raise AssertionError("unsupported transforms must be rejected")
