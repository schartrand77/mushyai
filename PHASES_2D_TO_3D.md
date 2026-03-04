# 2D-to-3D Roadmap and Phase Status

## Goal

Move from deterministic prompt interpretation to trustworthy image-informed 3D reconstruction.

## Current status (March 4, 2026)

- Phase 1: Complete
- Phase 2: In progress (service orchestration scaffold complete)
- Phase 3: Partial scaffold, not production-ready
- Phase 4: Partial coverage, expand as phases 2-3 land

## Phase 1 - Product honesty and input plumbing (Complete)

Implemented:

- Upload input in UI (`png`, `jpeg`, `webp`, `svg`) with optional caption.
- Client-side strict validation for type, size, and dimensions.
- API schema support for `referenceImage` metadata:
  - `fileName`, `mimeType`, `sizeBytes`, `width`, `height`, `sha256`, optional `caption`, optional `silhouette`.
- Provenance persisted in delivery package:
  - Prompt digest + reference-image digest and dimensions + processing parameters.
- User-facing capability messaging that this is not final accurate 2D-to-3D reconstruction.

Primary files:

- `index.html`
- `src/referenceImage.js`
- `src/app.js`
- `backend/server.js`
- `backend/generator.js`

Tests covering Phase 1:

- `tests/app.test.js`
- `tests/backend.server.integration.test.js`
- `tests/backend.generator.test.js`

## Phase 2 - Single-image reconstruction backend (In progress)

Implemented in this phase so far:

- Added a dedicated reconstruction worker service boundary:
  - Node backend can call an external worker via `RECONSTRUCTION_WORKER_URL`.
  - Worker failures time out and safely fall back to in-process reconstruction.
- Added a lightweight Python worker with:
  - `/healthz`
  - `/reconstruct` JSON endpoint returning mesh reconstruction payload.
- Added preprocessing and artifact contract in worker output:
  - Canonical silhouette framing/normalization metadata.
  - Artifact manifest and normalized contour trace for debugging and reproducibility.
- Added optional artifact persistence to disk:
  - Set `RECONSTRUCTION_ARTIFACT_DIR` to store per-job mesh/manifest/contour artifacts.
  - Response now includes artifact store metadata and job id for traceability.
- Added explicit reconstruction model metadata contract:
  - Worker response now includes `model.provider`, `model.version`, confidence, and input feature summary.
  - Backend provenance now preserves reconstruction model metadata in exported packages.
- Added execution telemetry and resilience:
  - Worker response now includes per-stage timing (`telemetry.timingsMs`) and total runtime.
  - Backend worker client now retries transient failures before falling back to in-process reconstruction.
- Added Docker wiring for local/e2e stacks:
  - `reconstruction-worker` service
  - backend dependency and worker URL env wiring.

Required:

- Replace heuristic mesh generation with a real image-to-3D reconstruction service.
- Add preprocessing (segmentation, framing/canonicalization, background handling).
- Generate mesh + textures with postprocess steps (retopo, UVs, manifold cleanup, scale normalization).

Suggested architecture:

- Keep Node API as orchestrator.
- Add Python worker service for reconstruction inference.
- Persist intermediate artifacts for debugging and reproducibility.

## Phase 3 - Confidence scoring and export gates (Planned)

Required:

- Objective quality gates (silhouette overlap, semantic alignment, manifold checks, UV/texture checks).
- Make export decision driven by measurable thresholds.
- Return actionable remediation for failed jobs.

Note:

- Current quality report is a deterministic heuristic score; it is useful for UX but not yet a model-validated fidelity metric.

## Phase 4 - Regression and release confidence (Planned)

Required:

- Fixture-based end-to-end upload->reconstruction->export assertions.
- Golden artifact checks for provenance and package schema stability.
- Browser E2E for upload workflow, quality block behavior, and successful export path.

## Exit criteria for "accurate image-to-3D"

Do not claim accurate 2D->3D until all are true:

1. Image upload works reliably for supported formats and constraints.
2. Backend reconstructs non-primitive geometry from image evidence.
3. Export includes textured mesh assets suitable for DCC/game pipelines.
4. Quality report is evidence-based, transparent, and gating.
5. Automated tests cover the upload-to-export flow with regression confidence.
