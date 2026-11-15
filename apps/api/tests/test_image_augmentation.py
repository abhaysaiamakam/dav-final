import json
import shutil
from pathlib import Path

from PIL import Image

from app.schemas.preprocessing import PreprocessingOperationConfig, PreprocessingOperationType
from app.services.preprocessing.image_preprocessing import AugmentImagesOperation


def _fixture(root: Path) -> bytes:
    image = root / "Rice" / "Disease" / "leaf.png"
    image.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (36, 28), (50, 110, 170)).save(image)
    return image.read_bytes()


def test_augmentation_preview_is_non_destructive_and_apply_is_seeded(tmp_path: Path):
    source = tmp_path / "source"
    clone = tmp_path / "clone"
    original = _fixture(source)
    shutil.copytree(source, clone)
    operation = AugmentImagesOperation()
    config = PreprocessingOperationConfig(operation_type=PreprocessingOperationType.AUGMENT_IMAGES, parameters={
        "seed": 123, "copies_per_image": 1, "augmentations": [
            {"type": "horizontal_flip"}, {"type": "rotate", "degrees": 12},
            {"type": "brightness", "value": 1.15}, {"type": "gaussian_noise", "sigma": 2},
        ],
    })

    preview = operation.preview(source, config)
    assert preview.status == "valid"
    assert preview.files_after == 2
    assert (source / "Rice" / "Disease" / "leaf.png").read_bytes() == original
    assert len(list(source.rglob("*__aug_*.png"))) == 0

    first = operation.apply(source, config)
    second = operation.apply(clone, config)
    first_output = source / first["affected_files"][0]
    second_output = clone / second["affected_files"][0]
    assert (source / "Rice" / "Disease" / "leaf.png").read_bytes() == original
    assert first_output.read_bytes() == second_output.read_bytes()
    with Image.open(first_output) as image:
        assert image.size == (36, 28)
    manifest = json.loads((source / ".croplens" / "augmentation_manifest.json").read_text())
    assert manifest["records"][0]["source_relative_path"] == "Rice/Disease/leaf.png"
    assert manifest["records"][0]["seed"] == 123


def test_augmentation_rejects_invalid_transform_parameters(tmp_path: Path):
    operation = AugmentImagesOperation()
    config = PreprocessingOperationConfig(operation_type=PreprocessingOperationType.AUGMENT_IMAGES,
        parameters={"augmentations": [{"type": "rotate", "degrees": 220}]})
    assert any("degrees" in error for error in operation.validate_parameters(config))
