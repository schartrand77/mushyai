# Audit: 2D image upload to accurate 3D model output

## Executive verdict

**Current status: requirement is not met.**

This repository currently supports **text-prompt-only deterministic generation** and does not include a 2D image ingestion pipeline, computer vision feature extraction, or geometry reconstruction from images. Users cannot upload an image and reliably receive an accurate 3D model today.

## Evidence found in code

1. **Input surface is prompt-only in the UI**
   - The job form exposes a textarea (`prompt`) and dropdowns for style/topology/texture detail.
   - There is no `<input type="file">`, image preview, or file handling in the form workflow.

2. **API contract is text-only**
   - `/api/generate` validates a JSON payload that requires `prompt` and optional style metadata.
   - No field exists for image bytes, URLs, masks, camera metadata, or multi-view inputs.

3. **Generator is keyword heuristics, not reconstruction**
   - Shape/material are inferred from regex keyword scoring.
   - Output is a deterministic Blender script that creates primitive meshes (cube/sphere/cylinder/etc.), not mesh recovery from image data.

4. **No model-quality verification loop**
   - No objective metric (e.g., silhouette IoU, reprojection consistency, LPIPS/CLIP alignment) exists to validate 3D faithfulness to a source image.

## Risk assessment

- **High functional risk**: product expectation (“upload 2D → accurate 3D”) is fundamentally beyond current architecture.
- **High trust risk**: UI language can imply model generation capability beyond what is implemented.
- **Medium operational risk**: no dedicated error handling for unsupported input mode because upload mode does not exist.

## Required implementation plan (minimum viable confidence)

### Phase 1 — Product honesty + input plumbing

- Add file upload UX (`accept="image/png,image/jpeg,image/webp,image/svg+xml"`).
- Add strict validation (size/type/resolution) and explicit user-facing capability messaging.
- Extend API schema with `referenceImage` metadata (format, dimensions, optional caption).
- Store generation provenance in delivery package (prompt + image digest + processing params).

### Phase 2 — Single-image 3D reconstruction backend

- Add an actual image-to-3D pipeline (e.g., photogrammetry-lite for multi-view or a single-view reconstruction model).
- Preprocess images: segmentation/background removal, normalization, canonical framing.
- Generate mesh + textures and run post-processing (retopo, UVs, normal fixes, scale normalization).

### Phase 3 — Confidence scoring and acceptance gates

- Add measurable quality gates:
  - silhouette overlap against rendered views,
  - prompt/image semantic alignment,
  - manifold/mesh validity checks,
  - texture seam and UV coverage checks.
- Block “ready for export” when score is below threshold; provide actionable remediation prompts.

### Phase 4 — Regression coverage

- Add fixture-based tests for:
  - upload validation,
  - metadata extraction,
  - deterministic provenance packaging,
  - quality gate pass/fail behavior.
- Add E2E tests for upload workflow and exported package contents.

## Acceptance criteria for “confidently accurate”

A release should only claim this requirement after all are true:

1. User can upload supported image formats from UI and submit successfully.
2. Backend reconstructs non-primitive geometry from image evidence.
3. Output includes textured mesh assets, not only heuristic primitive scripts.
4. Pipeline produces a transparent confidence score and quality report.
5. CI has automated tests covering upload-to-export path.

## Practical recommendation

Until phases 1–4 are implemented, market this app as a **deterministic prompt interpreter and preview package generator**, not an accurate 2D-to-3D reconstruction tool.
