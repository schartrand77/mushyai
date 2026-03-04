# Audit: 2D image upload to accurate 3D model output

## Executive verdict

**Current status: partially met (Phase 1 complete, accurate reconstruction not yet met).**

This repository now supports:

- Reference-image upload plumbing (UI + API metadata contract)
- Strict validation (type/size/dimensions/hash schema)
- Provenance in exported delivery package
- Explicit capability messaging that output quality varies

It still does **not** provide confident, production-grade image-to-3D reconstruction fidelity.

## What is implemented now (evidence)

1. **Input surface includes upload flow**
   - UI contains `referenceImage` file input and optional `referenceCaption`.
   - Prompt is optional when a reference image is provided.

2. **API accepts and validates `referenceImage` metadata**
   - `/api/generate` accepts `referenceImage` object with strict field validation.
   - Invalid hash/dimensions/silhouette schema are rejected.

3. **Provenance is stored in output package**
   - Delivery JSON includes prompt digest, reference digest, and processing metadata.
   - Input mode and reconstruction mode are captured.

4. **Tests cover Phase 1 contract**
   - Unit/integration tests cover upload metadata handling and validation failures.

## Remaining gaps to claim accurate 2D -> 3D

1. **No true reconstruction model pipeline**
   - Current reconstruction is deterministic silhouette extrusion fallback and heuristics.
   - No learned single-view or multi-view model is integrated.

2. **Quality metrics are heuristic**
   - Current quality report is useful for gating UX but not a robust reconstruction-fidelity benchmark.

3. **No production mesh/texturing backend**
   - Missing robust retopo/UV/texture baking and mesh validity workflow expected for high-fidelity exports.

## Risk assessment

- **High functional risk** for claims of "accurate from one image."
- **Medium trust risk** if UX language implies reconstruction reliability beyond current implementation.
- **Medium operational risk** until objective, evidence-based quality gates replace heuristics.

## Roadmap

### Phase 1 - Product honesty + input plumbing

- Status: **Complete**
- Delivered:
  - Upload UX + caption
  - Validation for supported formats/size/dimensions/schema
  - API `referenceImage` contract
  - Provenance in exported package

### Phase 2 - Single-image 3D reconstruction backend

- Status: **In progress (orchestration scaffold implemented)**
- Required:
  - Real image-to-3D model service
  - Image preprocessing and artifact management
  - Mesh + texture generation pipeline

### Phase 3 - Confidence scoring and acceptance gates

- Status: **Scaffold only**
- Required:
  - Evidence-based metrics (silhouette/render consistency/mesh checks)
  - Threshold-driven export gating tied to reconstruction quality

### Phase 4 - Regression coverage

- Status: **Partial**
- Required:
  - Broader fixture set and golden outputs for upload->export path
  - Full E2E upload and quality-gate behavior coverage

## Acceptance criteria for "confidently accurate"

A release should only claim this requirement after all are true:

1. User can upload supported image formats and submit reliably.
2. Backend reconstructs non-primitive geometry from image evidence (model-based).
3. Output includes textured mesh assets suitable for downstream DCC/game use.
4. Pipeline reports transparent, objective confidence metrics and gates exports.
5. CI enforces regression tests for full upload-to-export behavior.

## Practical recommendation

Market the app today as:

- **Deterministic prompt interpreter with reference-image provenance and experimental reconstruction heuristics**

Do not market it as:

- **Accurate 2D-image to 3D reconstruction**
