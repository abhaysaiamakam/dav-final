# ICAR Rice and Maize validation runbook

This runbook prepares CropLens to validate the original ICAR Rice and Maize image set. It does not run analysis or report dataset findings. It preserves the source directory and creates a version record that points to it.

## Current source and findings

- Dataset ID: `icar-rice-maize`.
- Source directory in this checkout: `apps/api/storage_data/curated/icar-rice-maize`.
- The directory currently contains the 852 source images and occupies about 933 MiB on disk (the screenshot/archive label says 925.9 MiB). No source ZIP was found under `apps/api/storage_data` during this inspection.
- The curated registry already points to this directory, but it currently has no version record. Version-specific image APIs require a version record.
- Do not upload a generated ZIP from this directory to the current endpoint: the endpoint's 500 MiB upload cap is below the reported 925.9 MiB archive size. The safest available path is a read-only fingerprint plus a version record referencing `curated/icar-rice-maize`, followed by the regular version job.

All storage figures are from the local development checkout at inspection time. Confirm free space on the machine/container that will run the API; local disk capacity does not imply that a deployment has the same capacity.

## Limits and prerequisites

The defaults in `apps/api/app/core/config.py` and `apps/api/app/services/upload_service.py` are:

| Limit | Current value | Relevance |
| --- | ---: | --- |
| HTTP archive upload | 500 MiB (524,288,000 bytes) | Rejects the reported 925.9 MiB ZIP with HTTP 413. |
| Extracted archive size | 2 GiB | Above the current ~933 MiB image tree. |
| Archive members | 20,000 | Above 852 images plus ordinary metadata files. |
| Per-image decode limit | 25,000,000 pixels | An image above the limit may fail validation/decode. |
| Concurrent image processing | 16 | Image processing cap; background job executor has 2 workers. |

The local storage volume was observed with about 681 GiB free. A referenced version adds small metadata, while preprocessing copies the source tree to a derived version and therefore needs roughly another dataset-sized allocation plus temporary space. Keep at least 2–3 GiB free for this validation and any derived copy. Check `df -h apps/api/storage_data` immediately before starting.

Prerequisites:

1. Use the same working tree and persistent `CROPLENS_STORAGE_BASE_DIR` for registration and API execution. Do not register on one machine and run the API against another storage volume.
2. Start the API from the repository's configured Python environment. From the repository root, the README setup uses `apps/api/.venv`.
3. Ensure the curated directory is mounted/readable by the API process and remains unchanged during processing.
4. Set `API=http://localhost:8000` below to the API origin used by the local app. API prefix is `/api/v1`.

## Register the existing directory as a version

There is no directory-upload route. The archive endpoints accept files only. Register the current curated folder by reference using the existing service APIs; this reads all non-hidden files to fingerprint their content and writes only dataset/version/job metadata under `storage_data`. It does not extract, copy, rename, or modify the curated images.

Run once from the repository root, with the backend environment active:

```bash
cd apps/api
source .venv/bin/activate
python - <<'PY'
from pathlib import Path
import json

from app.services.dataset_service import dataset_service
from app.services.upload_service import upload_service
from app.storage.local import storage_backend

dataset_id = "icar-rice-maize"
source = (Path("storage_data/curated/icar-rice-maize")).resolve()
if not source.is_dir():
    raise SystemExit(f"Missing curated source directory: {source}")
if not storage_backend.is_safe_path(source):
    raise SystemExit("Source directory is outside configured CropLens storage")

fingerprint = upload_service.compute_content_fingerprint(source)
relative_path = storage_backend.sanitize_relative_path(source)
version, reused = dataset_service.create_version(dataset_id, relative_path, fingerprint)

print(json.dumps({
    "dataset_id": dataset_id,
    "version_id": version.version_id,
    "version_number": version.version_number,
    "storage_relative_path": version.storage_relative_path,
    "reused_existing_version": reused,
}, indent=2))
PY
```

If `reused_existing_version` is true, the content fingerprint matched the latest ready/registered/analyzing version. The command does not enqueue processing in either case. Keep the printed `version_id` and use it explicitly in all following requests. The backend `create_version` method updates the dataset's current-version metadata and writes version metadata; that is expected and does not mutate the source directory.

Start the API in another terminal from the repository root (or leave it running against the same storage):

```bash
./scripts/dev-backend.sh
```

Verify registration:

```bash
export API=http://localhost:8000
export DATASET_ID=icar-rice-maize
curl -fsS "$API/api/v1/datasets/$DATASET_ID/versions" | python -m json.tool
```

Copy the `version_id` printed by the registration step into the shell variable:

```bash
export VERSION_ID='ver-icar-rice-maize-1-<fingerprint-prefix>'
curl -fsS "$API/api/v1/datasets/$DATASET_ID/versions/$VERSION_ID" | python -m json.tool
```

The version response should identify `dataset_id`, the same `version_id`, `storage_relative_path: "curated/icar-rice-maize"`, status, fingerprint, and version number. The generated version ID suffix is based on the content fingerprint; do not guess it.

## Run and monitor the standard analysis job

After version registration, enqueue the standard asynchronous analysis pipeline for that active version:

```bash
curl -fsS -X POST "$API/api/v1/datasets/$DATASET_ID/reanalyze" | tee /tmp/croplens-job.json | python -m json.tool
export JOB_ID=$(python -c 'import json; print(json.load(open("/tmp/croplens-job.json"))["job_id"])')
```

Because registration points the dataset to the newly selected version, this reanalysis job targets that version. Confirm its `dataset_version` matches `$VERSION_ID` in the response before continuing. Poll the exact job:

```bash
export JOB_ID='job-icar-rice-maize-<printed-id>'
curl -fsS "$API/api/v1/jobs/$JOB_ID/status" | python -m json.tool
```

Expected lifecycle fields include `job_id`, `dataset_id`, `dataset_version`, `status`, `current_stage`, `progress_pct`, timestamps, and `error_message`. `status` progresses from `queued` through processing stages to `completed`; `failed` includes an error message. Full details and artifact references:

```bash
curl -fsS "$API/api/v1/jobs/$JOB_ID" | python -m json.tool
curl -fsS "$API/api/v1/jobs?dataset_id=$DATASET_ID" | python -m json.tool
```

Also confirm the exact version status:

```bash
curl -fsS "$API/api/v1/datasets/$DATASET_ID/versions/$VERSION_ID" | python -m json.tool
```

The job runner binds the pipeline to the selected `version_id`. Current caveat: within the legacy background pipeline, its older near-duplicate detector stores its result by dataset ID, not by dataset/version. Use the version-bound image-intelligence route below as the authoritative version-isolated perceptual near-duplicate/feature/PCA result. Do not treat `/near-duplicates` as proof of version isolation.

For a failed job, inspect its `error_code`/`error_message` and server logs, confirm the exact version path still exists and is readable, and check disk/memory/decode limits. Retry the same failed job (it keeps the same dataset version):

```bash
curl -fsS -X POST "$API/api/v1/jobs/$JOB_ID/retry" | python -m json.tool
```

If the version record points to a missing path, stop and repair the storage mount/path before retrying. Do not re-upload over or replace `curated/icar-rice-maize`. Startup recovery marks interrupted processing jobs failed with `JOB_INTERRUPTED_BY_RESTART`; queued jobs are resumed automatically, and failed jobs can be retried as above.

## Version-bound image intelligence: duplicate groups, quality, features, PCA

The exact-version endpoint is:

```text
POST /api/v1/datasets/{dataset_id}/versions/{version_id}/image-intelligence
GET  /api/v1/datasets/{dataset_id}/versions/{version_id}/image-intelligence
```

Run only after the source version has been registered. This endpoint reads the selected version directory directly and saves the result beneath a key derived from both `dataset_id` and `version_id`. The GET route validates that same version and returns its saved JSON. It does not return or create findings until POST is called.

Default request (all current defaults shown explicitly):

```bash
cat > /tmp/croplens-image-intelligence.json <<'JSON'
{
  "analysis_max_edge": 512,
  "phash_distance_threshold": 8,
  "feature_families": ["rgb", "hsv", "statistics", "glcm", "lbp", "edge"],
  "standardize_features": true
}
JSON

curl -fsS -X POST \
  "$API/api/v1/datasets/$DATASET_ID/versions/$VERSION_ID/image-intelligence" \
  -H 'Content-Type: application/json' \
  --data-binary @/tmp/croplens-image-intelligence.json \
  | python -m json.tool

curl -fsS \
  "$API/api/v1/datasets/$DATASET_ID/versions/$VERSION_ID/image-intelligence" \
  | python -m json.tool
```

Expected output contains the same `dataset_id` and `version_id`, analysis configuration/methodology, image measurement rows, quality measurements, pHash groups, feature names/matrix metadata, and PCA output/metadata. A GET before a successful POST returns 404. The computation is synchronous, so the POST remains open while it processes; monitor the API process logs and request completion rather than `/jobs` for this endpoint. A repeated POST recomputes and replaces the `latest.json` result for that exact version key.

Validation criterion for isolation: GET results for `VERSION_ID` must echo that exact ID. Compare results across versions only by calling the version-qualified URL for each ID. The separate legacy route `POST /api/v1/datasets/{dataset_id}/near-duplicates/detect` has no `version_id` parameter and is not suitable for this criterion.

The image-intelligence response includes quality measurements and feature/PCA results; it is separate from the legacy Quality Lab and EDA artifacts. The legacy quality and EDA POST routes accept `?version_id=...` and execute inside `version_scope`; their GET routes also accept the version filter:

```bash
curl -fsS -X POST "$API/api/v1/datasets/$DATASET_ID/quality-assessments?version_id=$VERSION_ID&force_refresh=true" | python -m json.tool
curl -fsS "$API/api/v1/datasets/$DATASET_ID/quality-assessment?version_id=$VERSION_ID" | python -m json.tool
curl -fsS -X POST "$API/api/v1/datasets/$DATASET_ID/eda?version_id=$VERSION_ID&force_refresh=true" | python -m json.tool
curl -fsS "$API/api/v1/datasets/$DATASET_ID/eda?version_id=$VERSION_ID" | python -m json.tool
```

Check each response's `version_id` before accepting it. Quality/EDA GET filters reject a mismatched latest report, but their persistence uses dataset-level latest pointers; after a server restart, a non-latest historical report may not be rehydrated by these routes. For durable exact-version evidence, retain the returned response JSON and use image-intelligence's version-hashed GET for the new feature/PCA/near-duplicate output.

## Preprocessing safety check

Preprocessing requires an explicit source version in the request body. Preview is sandboxed; apply copies that version into a temporary work tree, applies operations there, fingerprints the output, and creates a new extracted version. It does not edit the selected source directory. Applying an operation is a separate intentional step; do not apply it as part of baseline validation.

Example preview (resize to a maximum edge of 512 while preserving aspect ratio):

```bash
cat > /tmp/croplens-preview.json <<JSON
{
  "dataset_id": "$DATASET_ID",
  "version_id": "$VERSION_ID",
  "operations": [{
    "operation_type": "resize_images",
    "parameters": {"max_dim": 512, "resample": "lanczos"}
  }]
}
JSON
curl -fsS -X POST "$API/api/v1/datasets/$DATASET_ID/preprocessing/preview" \
  -H 'Content-Type: application/json' --data-binary @/tmp/croplens-preview.json \
  | python -m json.tool
```

Preview should report the same `source_version_id` and `can_apply`. If later choosing to apply, use the same body at `/preprocessing/apply`; save its `derived_version_id` and `job_id`. The original stays at the source version path. Verify lineage at:

```bash
curl -fsS "$API/api/v1/datasets/$DATASET_ID/versions/$DERIVED_VERSION_ID/preprocessing/history" | python -m json.tool
```

The history must show `source_version_id == $VERSION_ID`, a distinct `derived_version_id`, input/output fingerprints, applied operations, and status. Do not run apply merely to validate baseline analysis.

## Upload path if using an archive on another host

The supported archive methods are:

```text
POST /api/v1/datasets/upload                 multipart file; optional dataset_id, name, description
POST /api/v1/datasets/{dataset_id}/upload    multipart file; creates a new version
```

Accepted file types are `.zip`, `.tar`, `.tar.gz`, and `.tgz`. If a byte-identical archive is actually available and is within the configured 500 MiB cap, upload it with:

```bash
curl -fsS -X POST "$API/api/v1/datasets/$DATASET_ID/upload" \
  -F 'file=@/absolute/path/to/dataset.zip' | python -m json.tool
```

This streams the archive to a temporary file, securely extracts it into `storage_data/extracted/{dataset_id}/vN`, creates a version, and enqueues the analysis job. A 925.9 MiB archive exceeds the current cap and will fail with 413 before extraction. Do not split it into multipart chunks: this endpoint has no resumable/chunked upload protocol. For the archive available only on another computer, place it in accessible storage and check its size before upload; if it exceeds the cap, use the existing curated-folder reference path above or first arrange a supported storage/limit change. Do not recompress/replace the source archive as part of this runbook.

## Deployment limits and operational notes

- Local `storage_data` is durable only while the same volume is retained. A serverless deployment with ephemeral `/tmp` cannot safely retain version metadata/results/jobs across instances or restarts. Use a persistent shared volume/object store implementation before production-scale processing.
- The current upload limit blocks the stated ZIP size; extracted-size/file-count limits are adequate for the present image tree, based on current folder size/count.
- The API currently processes a direct image-intelligence POST synchronously. A client/proxy timeout can interrupt the request even if local disk is ample. A background-job wrapper is not currently provided for that endpoint.
- Peak RAM/CPU depends on image dimensions and selected feature families. Decode is limited to 25 MP/image, image workers cap at 16, and the job executor has 2 workers. Do not run several full analyses concurrently on a constrained deployment.
- The direct existing-folder reference method is local-storage-specific. It only works if the API process sees the exact directory under its configured storage base and the directory is mounted read-only or otherwise protected from writes.

## Inspection scope

This runbook is based on code and filesystem inspection only. No analysis POST, preprocessing apply, or archive upload was run, and no new dataset findings were generated or displayed.
