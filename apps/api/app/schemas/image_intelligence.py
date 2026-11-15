"""Version-bound image quality and feature analysis schemas."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ImageIntelligenceRequest(BaseModel):
    analysis_max_edge: int = Field(default=512, ge=64, le=2048)
    phash_distance_threshold: int = Field(default=8, ge=0, le=64)
    feature_families: list[str] = Field(
        default_factory=lambda: ["rgb", "hsv", "statistics", "glcm", "lbp", "edge"],
        min_length=1,
    )
    standardize_features: bool = True


class ImageIntelligenceResponse(BaseModel):
    analysis_id: str
    dataset_id: str
    version_id: str
    created_at: str
    methodology_version: str
    provenance: dict[str, Any]
    configuration: dict[str, Any]
    total_images: int
    analyzed_images: int
    unreadable_images: int
    class_distribution: dict[str, int]
    class_balance: dict[str, Any]
    metadata_consistency: dict[str, Any]
    numeric_distributions: dict[str, dict[str, Any]]
    correlation: dict[str, Any]
    feature_families: dict[str, Any]
    pca: dict[str, Any]
    quality_flags: dict[str, Any]
    image_measurements: list[dict[str, Any]]
    near_duplicates: dict[str, Any]
    leakage_investigation: dict[str, Any]
    findings: list[dict[str, Any]]
    limitations: list[str]
