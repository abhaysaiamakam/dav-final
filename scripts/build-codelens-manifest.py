"""Build source manifests from fixed, reviewed allowlists of repository symbols."""
from __future__ import annotations

import ast
import io
import json
import tokenize
from pathlib import Path

PHASE1_PYTHON_MODULES = [
    {
        "id": "inventory", "title": "Dataset loading & inventory", "kind": "production",
        "path": "apps/api/app/services/dataset_discovery_service.py",
        "symbols": ["DatasetDiscoveryService.scan_directory", "DatasetDiscoveryService.discover_dataset"],
        "purpose": "Discovers files and directory-derived classes for a dataset version.",
        "math": "Counts discovered paths; directory names are observed labels, not independently verified truth.",
        "ml": "Provides the image and class inventory used by downstream analysis.",
        "agriculture": "Keeps crop and disease folder context available for rice and maize image review.",
        "limitations": "Folder structure alone cannot validate a biological diagnosis or field prevalence.",
    },
    {
        "id": "validation", "title": "Image validation & metadata", "kind": "production",
        "path": "apps/api/app/services/image_validation_service.py",
        "symbols": ["ImageValidationService.validate_image_file", "ImageValidationService.validate_dataset"],
        "purpose": "Checks supported files, image headers, full pixel decoding, dimensions and errors.",
        "math": "No statistical estimator; records per-file validation outcomes.",
        "ml": "Makes unreadable or unsupported inputs visible before feature extraction or training.",
        "agriculture": "Preserves source paths so a decoding issue can be reviewed against its crop/class folder.",
        "limitations": "Successful decoding does not establish label correctness or symptom visibility.",
    },
    {
        "id": "eda", "title": "Dataset composition & EDA", "kind": "production",
        "path": "apps/api/app/services/eda_service.py",
        "symbols": ["_safe_mean", "_safe_median", "_safe_stdev", "_compute_entropy", "_compute_gini", "EdaService._compute_class_distribution", "EdaService._compute_dimension_analysis", "EdaService._compute_aspect_ratio_analysis", "EdaService._compute_format_analysis", "EdaService._compute_color_analysis", "EdaService._compute_file_size_analysis"],
        "purpose": "Summarizes class counts, dimensions, aspect ratios, formats and file sizes.",
        "math": "Includes mean, median, standard deviation, CV = SD/mean, aspect ratio = width/height and measured proportions.",
        "ml": "Highlights sampling imbalance and input geometry that may affect model preparation.",
        "agriculture": "Shows how the dataset's crop/disease folders and leaf-image framing are represented.",
        "limitations": "Balanced folder counts do not guarantee balanced visual symptoms, acquisition conditions or true prevalence.",
    },
    {
        "id": "quality", "title": "Image quality & outlier review", "kind": "production",
        "path": "apps/api/app/services/image_intelligence_service.py",
        "symbols": ["_image_features", "_distribution"],
        "purpose": "Computes brightness, contrast, Laplacian variance, a residual noise proxy and dataset-relative IQR candidates.",
        "math": "Laplacian variance is Var(ΔI); IQR review fences use Q1−1.5·IQR and Q3+1.5·IQR.",
        "ml": "Makes image-condition variability and review candidates visible before training.",
        "agriculture": "Lighting, focus, leaf texture and background can affect measured disease-image descriptors.",
        "limitations": "These are screening measurements; sharpness/noise proxies are scale- and texture-dependent and flags are not defects.",
    },
    {
        "id": "outliers", "title": "Dataset-relative outlier candidates", "kind": "production",
        "path": "apps/api/app/services/image_intelligence_service.py",
        "symbols": ["ImageIntelligenceService.analyze"],
        "purpose": "Calculates per-feature Tukey 1.5×IQR limits and records images outside those dataset-relative ranges.",
        "math": "IQR=Q3−Q1; lower fence=Q1−1.5×IQR; upper fence=Q3+1.5×IQR. The code applies these to brightness, contrast, Laplacian variance, noise proxy, pixel count and file size.",
        "ml": "Produces review candidates for source inspection and data-quality triage.",
        "agriculture": "Allows a researcher to inspect atypical image conditions or leaf samples in their original folder context.",
        "limitations": "A statistical tail is not a defect, disease, mislabeled sample or universal quality failure; the IQR population and features are dataset-specific.",
    },
    {
        "id": "exact-duplicates", "title": "Exact duplicate detection", "kind": "production",
        "path": "apps/api/app/services/duplicate_detection_service.py",
        "symbols": ["DuplicateDetectionService.compute_file_sha256", "DuplicateDetectionService.detect_duplicates"],
        "purpose": "Groups validated files by SHA-256 byte-content digest.",
        "math": "Files with equal SHA-256 digests are treated as exact byte copies.",
        "ml": "Can identify repeated files that could otherwise cross data splits.",
        "agriculture": "Makes repeated specimen photographs traceable by their original paths.",
        "limitations": "Re-encoded, resized or visually similar images have different file bytes and are not exact duplicates.",
    },
    {
        "id": "near-duplicates", "title": "Perceptual near-duplicate detection", "kind": "production",
        "path": "apps/api/app/services/perceptual_hash_service.py",
        "symbols": ["PerceptualHashService.preprocess_image", "PerceptualHashService.compute_hash", "PerceptualHashService.compute_hamming_distance"],
        "purpose": "Normalizes image orientation/mode, computes a perceptual hash and compares hash bits.",
        "math": "Hamming distance d(h₁,h₂)=popcount(h₁ XOR h₂); grouping uses configured bit-distance thresholds.",
        "ml": "Helps review visually redundant samples before creating train/validation/test splits.",
        "agriculture": "Can surface repeat captures or transformed copies of disease symptoms for human inspection.",
        "limitations": "Hash similarity is not semantic identity, disease identity or a probability; grouping behavior depends on threshold and algorithm.",
    },
    {
        "id": "near-duplicate-groups", "title": "Near-duplicate grouping", "kind": "production",
        "path": "apps/api/app/services/image_intelligence_service.py",
        "symbols": ["_complete_link_groups"],
        "purpose": "Builds near-duplicate groups from stored perceptual hashes under the configured Hamming threshold.",
        "math": "A pair is eligible when bitwise Hamming distance is at most the configured threshold; complete-link grouping requires every pair in a group to meet it.",
        "ml": "Helps prevent visually redundant examples from leaking across later data splits.",
        "agriculture": "Groups repeat or lightly transformed captures for image-by-image review of symptoms.",
        "limitations": "Hash distance is a low-level visual proxy; a group does not prove the same plant, lesion or field specimen.",
    },
    {
        "id": "quality-lab", "title": "Quality Lab assessment", "kind": "production",
        "path": "apps/api/app/services/data_quality_service.py",
        "symbols": ["DataQualityService.assess_dataset", "DataQualityService._evaluate_integrity", "DataQualityService._evaluate_imbalance", "DataQualityService._evaluate_consistency", "DataQualityService._evaluate_duplicates", "DataQualityService._calculate_quality_score"],
        "purpose": "Combines persisted validation, EDA and duplicate evidence into version-aware quality findings and assessment fields.",
        "math": "Each measure is implemented in its cited method; the app intentionally avoids treating its composite score as a scientific measurement.",
        "ml": "Summarizes dataset integrity and review needs before modeling.",
        "agriculture": "Keeps quality concerns linked to original image and class paths for domain review.",
        "limitations": "A quality assessment cannot establish label truth, field prevalence or model performance.",
    },
    {
        "id": "visual-features", "title": "RGB, HSV, texture & edge features", "kind": "production",
        "path": "apps/api/app/services/image_intelligence_service.py",
        "symbols": ["_gray", "_glcm_features", "_lbp_histogram", "_image_features"],
        "purpose": "Extracts per-image color histograms, grayscale/HSV summaries, GLCM, LBP and Sobel descriptors.",
        "math": "GLCM uses normalized neighboring gray-level counts; LBP compares each neighbor to its center; Sobel summarizes gradient magnitude.",
        "ml": "Produces numeric descriptors for distribution review, correlation and exploratory projection.",
        "agriculture": "Color and texture may reflect lesions, chlorosis, leaf structure or acquisition conditions.",
        "limitations": "Handcrafted descriptors discard or compress spatial/biological context and are not disease classifiers.",
    },
    {
        "id": "statistics", "title": "Feature distributions & correlation", "kind": "production",
        "path": "apps/api/app/services/image_intelligence_service.py",
        "symbols": ["_distribution", "_rank", "_correlation"],
        "purpose": "Summarizes feature distributions and computes Pearson and rank-based Spearman associations.",
        "math": "Pearson measures linear association; Spearman applies Pearson correlation to ranks.",
        "ml": "Surfaces scale, skew and redundant descriptors for feature review.",
        "agriculture": "Shows whether color, texture, resolution or image-condition descriptors co-vary in this dataset.",
        "limitations": "Correlation is not causation and can be affected by class mix, outliers and acquisition differences.",
    },
    {
        "id": "pca", "title": "Feature matrix & PCA", "kind": "production",
        "path": "apps/api/app/services/image_intelligence_service.py",
        "symbols": ["ImageIntelligenceService.analyze"],
        "purpose": "Builds a version-scoped image feature matrix, standardizes columns and computes PCA by NumPy thin SVD.",
        "math": "For centered standardized X=UΣVᵀ, explained-variance ratio i is σᵢ² / Σⱼσⱼ².",
        "ml": "Projects high-dimensional descriptors into lower dimensions for exploratory inspection.",
        "agriculture": "Can reveal broad visual structure across crop and symptom folders for follow-up study.",
        "limitations": "PCA is unsupervised and lossy; overlap is not classification failure and separation is not accuracy.",
    },
    {
        "id": "image-preprocessing", "title": "Image preprocessing & augmentation", "kind": "production",
        "path": "apps/api/app/services/preprocessing/image_preprocessing.py",
        "symbols": ["AugmentImagesOperation._transform", "AugmentImagesOperation.preview", "AugmentImagesOperation.apply", "ResizeImagesOperation.apply", "ConvertFormatOperation.apply", "ConvertColorModeOperation.apply", "RemoveExactDuplicatesOperation.apply", "ExcludeCorruptImagesOperation.apply"],
        "purpose": "Implements registered image transforms and augmentation operations through preview/apply methods.",
        "math": "Transform-specific; inspect each operation's parameters and implementation below.",
        "ml": "Supports controlled derived-data preparation and augmentation experiments.",
        "agriculture": "Transformation choices can change lesion shape, color, orientation or visible leaf context.",
        "limitations": "Only the operations listed in the production registry are supported; applying an operation creates derived data, not new evidence about the original.",
    },
    {
        "id": "preprocessing-versioning", "title": "Preprocessing preview & derived versions", "kind": "production",
        "path": "apps/api/app/services/preprocessing/preprocessing_service.py",
        "symbols": ["PreprocessingService.preview_operations", "PreprocessingService.apply_operations"],
        "purpose": "Coordinates registered preview/apply steps and materializes operations against versioned storage.",
        "math": "Operation-specific; the service records the requested configuration and resulting derived version/job metadata.",
        "ml": "Keeps experimental preparation reproducible and separate from the source dataset version.",
        "agriculture": "Provides an auditable way to compare transformed leaf imagery while retaining the original input.",
        "limitations": "A preview is not an applied transformation; inspect job/version status before using derived outputs.",
    },
    {
        "id": "image-previews", "title": "Image visual operations & previews", "kind": "production",
        "path": "apps/api/app/services/image_visualization_service.py",
        "symbols": ["_canny", "render_image_preview"],
        "purpose": "Creates on-demand visual previews such as grayscale, Sobel, Canny and segmentation views.",
        "math": "Canny applies gradient-based edge detection with non-maximum suppression and threshold connectivity as implemented in the cited function.",
        "ml": "Supports human inspection of candidate image structures; this is not a persisted feature unless the result artifact says so.",
        "agriculture": "Edges can make leaf boundaries and lesion contours easier to inspect.",
        "limitations": "A preview transform is not a stored analytical result or disease diagnosis.",
    },
    {
        "id": "api-endpoints", "title": "Version-scoped image API endpoints", "kind": "production",
        "path": "apps/api/app/api/v1/endpoints/images.py",
        "symbols": ["get_image_intelligence", "analyze_image_intelligence", "get_version_image_visual_preview", "preview_image_preprocessing"],
        "purpose": "Routes requests to version-scoped image analysis, visual preview and preprocessing services.",
        "math": "The endpoints delegate calculations to the services above; they do not implement the statistical methods themselves.",
        "ml": "Expose persisted results and previews to the Phase 1 UI.",
        "agriculture": "Keep the selected dataset/version context attached to image evidence and results.",
        "limitations": "Endpoint handlers are orchestration and serialization; read service functions for the algorithms.",
    },
    {
        "id": "versioning", "title": "Dataset versioning & persistence", "kind": "production",
        "path": "apps/api/app/services/dataset_service.py",
        "symbols": ["DatasetService.create_version", "DatasetService.mark_version_ready"],
        "purpose": "Registers immutable dataset-version metadata and fingerprints for reproducible analysis scope.",
        "math": "Fingerprinting is based on the source implementation; inspect its code and stored fields.",
        "ml": "Makes analysis outputs traceable to a selected dataset version.",
        "agriculture": "Supports repeatable review of the exact image collection used in research presentation.",
        "limitations": "A version identifier does not itself guarantee source provenance or scientific validity.",
    },
    {
        "id": "standalone", "title": "Standalone archive reproduction script", "kind": "standalone",
        "path": "apps/web/public/phase1-image-analysis.py",
        "symbols": ["image_inventory", "class_distribution_rows", "exact_duplicate_groups", "color_histogram_features", "write_csv", "write_class_distribution_svg", "write_pca_svg", "main"],
        "purpose": "Runnable local ZIP analysis utility preserved from the original presentation.",
        "math": "Its calculations are defined by this standalone source and may differ from the production API pipeline.",
        "ml": "Provides a separate archive-based reproduction path for its stated outputs.",
        "agriculture": "Retains source archive paths and directory-derived class information during its local analysis.",
        "limitations": "Do not attribute its outputs to persisted production API results unless that exact script run generated them.",
    },
]

ROOT = Path(__file__).resolve().parents[1]
ALLOWLIST = {
    "eda.class_distribution": ("apps/api/app/services/eda_service.py", "EdaService", "_compute_class_distribution"),
    "eda.dimensions": ("apps/api/app/services/eda_service.py", "EdaService", "_compute_dimension_analysis"),
    "eda.color": ("apps/api/app/services/eda_service.py", "EdaService", "_compute_color_analysis"),
    "eda.tabular.histogram": ("apps/api/app/services/visualizations/tabular_visualizer.py", "TabularVisualizer", "generate", "bin_count = min(10"),
    "quality.assessment": ("apps/api/app/services/data_quality_service.py", "DataQualityService", "assess_dataset"),
    "quality.integrity": ("apps/api/app/services/data_quality_service.py", "DataQualityService", "_evaluate_integrity"),
    "quality.imbalance": ("apps/api/app/services/data_quality_service.py", "DataQualityService", "_evaluate_imbalance"),
    "quality.consistency": ("apps/api/app/services/data_quality_service.py", "DataQualityService", "_evaluate_consistency"),
    "quality.duplicates": ("apps/api/app/services/data_quality_service.py", "DataQualityService", "_evaluate_duplicates"),
    "quality.score": ("apps/api/app/services/data_quality_service.py", "DataQualityService", "_calculate_quality_score", "overall_score = round("),
    "preprocess.imputation": ("apps/api/app/services/preprocessing/tabular_preprocessing.py", "MissingValueImputationOperation", "preview"),
    "preprocess.drop_missing": ("apps/api/app/services/preprocessing/tabular_preprocessing.py", "DropMissingRowsOperation", "preview"),
    "preprocess.duplicates": ("apps/api/app/services/preprocessing/tabular_preprocessing.py", "RemoveDuplicatesOperation", "preview"),
    "preprocess.outliers": ("apps/api/app/services/preprocessing/tabular_preprocessing.py", "OutlierHandlingOperation", "preview"),
    "preprocess.scaling": ("apps/api/app/services/preprocessing/tabular_preprocessing.py", "NumericScalingOperation", "preview"),
    "feature.variance": ("apps/api/app/services/feature_engineering/tabular_feature_operations.py", "VarianceThresholdSelectionOperation", "preview"),
    "feature.transform": ("apps/api/app/services/feature_engineering/tabular_feature_operations.py", "MathematicalTransformOperation", "preview"),
    "feature.correlation": ("apps/api/app/services/feature_engineering/tabular_feature_operations.py", "CorrelationRedundancyOperation", "preview"),
    "feature.pca": ("apps/api/app/services/feature_engineering/tabular_feature_operations.py", "PrincipalComponentAnalysisOperation", "preview"),
    "readiness.assessment": ("apps/api/app/services/readiness_service.py", "ReadinessService", "assess_readiness", "overall_score = int(sum(d.score"),
    "images.gallery": ("apps/api/app/services/image_explorer_service.py", "ImageExplorerService", "list_images", "counts = Counter"),
    "images.annotations": ("apps/api/app/services/image_explorer_service.py", "ImageExplorerService", "_annotation_index", "COCO provides source category names"),
}
FRONTEND_ALLOWLIST = {
    "renderer.visualization": (
        "apps/web/src/components/ui/visualization-chart.tsx",
        "VisualizationChart",
        "export function VisualizationChart(",
        "\n  return <div className=\"space-y-2\">",
    ),
    "images.gallery.ui": (
        "apps/web/src/app/explorer/page.tsx",
        "VisualExplorerPage class distribution and gallery controls",
        "{classes.length > 0 && <DashboardCard title=\"Discovered class distribution\"",
        "{!classes.length && !error && <EmptyState",
    ),
    "images.annotations.ui": (
        "apps/web/src/app/explorer/page.tsx",
        "VisualExplorerPage annotation overlay and evidence controls",
        "aria-label=\"Image annotations\"><div className=\"flex flex-wrap items-center justify-between gap-2\"",
        "</section>\n          <div className=\"grid grid-cols-2 gap-2 sm:grid-cols-4\"",
    ),
}


def symbol_node(tree: ast.Module, class_name: str, method_name: str) -> ast.AST:
    owners = [node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == class_name]
    if not owners:
        raise ValueError(f"Allowlisted class not found: {class_name}")
    methods = [node for node in owners[0].body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == method_name]
    if not methods:
        raise ValueError(f"Allowlisted method not found: {class_name}.{method_name}")
    return methods[0]


def find_symbol(tree: ast.Module, symbol: str) -> ast.AST:
    parts = symbol.split(".")
    node: ast.AST = tree
    for part in parts:
        body = getattr(node, "body", [])
        matches = [item for item in body if getattr(item, "name", None) == part]
        if not matches:
            raise ValueError(f"Phase 1 source symbol not found: {symbol}")
        node = matches[0]
    if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        raise ValueError(f"Phase 1 symbol is not a function: {symbol}")
    return node


def without_comment_tokens(source: str) -> str:
    lines = source.splitlines(keepends=True)
    comment_only_rows = {
        item.start[0] for item in tokenize.generate_tokens(io.StringIO(source).readline)
        if item.type == tokenize.COMMENT and not lines[item.start[0] - 1][:item.start[1]].strip()
    }
    return "".join(
        ("\n" if line.endswith("\n") else "") if index in comment_only_rows else line
        for index, line in enumerate(lines, start=1)
    )


def build_phase1_python_manifest() -> None:
    output = []
    for module in PHASE1_PYTHON_MODULES:
        path = ROOT / module["path"]
        source = path.read_text(encoding="utf-8")
        tree = ast.parse(source)
        lines = source.splitlines()
        imports = [
            "\n".join(lines[item.lineno - 1 : item.end_lineno])
            for item in tree.body if isinstance(item, (ast.Import, ast.ImportFrom))
        ]
        functions = []
        for symbol in module["symbols"]:
            node = find_symbol(tree, symbol)
            start = min([node.lineno, *(item.lineno for item in getattr(node, "decorator_list", []))])
            end = node.end_lineno or node.lineno
            function_source = "\n".join(lines[start - 1 : end])
            called = sorted({item.func.id if isinstance(item.func, ast.Name) else item.func.attr
                             for item in ast.walk(node) if isinstance(item, ast.Call)})
            parameters = [
                {"name": arg.arg, "annotation": ast.get_source_segment(source, arg.annotation) if arg.annotation else None}
                for arg in node.args.args
            ]
            return_annotation = ast.get_source_segment(source, node.returns) if node.returns else None
            functions.append({
                "symbol": symbol,
                "name": symbol.rsplit(".", 1)[-1],
                "line_start": start,
                "line_end": end,
                "signature": lines[node.lineno - 1].strip(),
                "source": function_source,
                "raw_source": without_comment_tokens(function_source),
                "parameters": parameters,
                "return_annotation": return_annotation,
                "docstring": ast.get_docstring(node),
                "calls": called,
            })
        output.append({
            **module,
            "imports": "\n\n".join(imports),
            "functions": functions,
        })
    target = ROOT / "apps/web/src/lib/phase1-python-sources.json"
    target.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def build() -> None:
    output: dict[str, dict[str, object]] = {}
    for key, config in ALLOWLIST.items():
        relative_path, class_name, method_name, *anchors = config
        path = ROOT / relative_path
        source = path.read_text(encoding="utf-8")
        tree = ast.parse(source)
        node = symbol_node(tree, class_name, method_name)
        function_start = min([node.lineno, *(d.lineno for d in getattr(node, "decorator_list", []))])
        function_end = node.end_lineno or node.lineno
        lines = source.splitlines()
        start = function_start
        if anchors:
            anchor_line = next((i + 1 for i, line in enumerate(lines[function_start - 1 : function_end]) if anchors[0] in line), None)
            if anchor_line is None:
                raise ValueError(f"Allowlisted source anchor not found: {key}")
            start = max(function_start, anchor_line - 14)
        end = min(function_end, start + 99)
        output[key] = {
            "source_file": relative_path,
            "source_symbol": f"{class_name}.{method_name}",
            "line_start": start,
            "line_end": end,
            "function_line_start": function_start,
            "function_line_end": function_end,
            "is_excerpt": start > function_start or end < function_end,
            "code_snippet": "\n".join(lines[start - 1 : end]),
            "language": "python",
        }
    for key, (relative_path, symbol, start_marker, end_marker) in FRONTEND_ALLOWLIST.items():
        path = ROOT / relative_path
        source = path.read_text(encoding="utf-8")
        start_offset = source.find(start_marker)
        end_offset = source.find(end_marker, start_offset + len(start_marker))
        if start_offset < 0 or end_offset < 0:
            raise ValueError(f"Allowlisted frontend symbol not found: {symbol}")
        start = source.count("\n", 0, start_offset) + 1
        end = source.count("\n", 0, end_offset) + 1
        lines = source.splitlines()
        function_start = start
        function_end = end
        output[key] = {
            "source_file": relative_path,
            "source_symbol": symbol,
            "line_start": start,
            "line_end": end,
            "function_line_start": function_start,
            "function_line_end": function_end,
            "is_excerpt": False,
            "code_snippet": "\n".join(lines[start - 1 : end]),
            "language": "typescript",
        }
    target = ROOT / "apps/web/src/lib/codelens-sources.json"
    target.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    build()
    build_phase1_python_manifest()
