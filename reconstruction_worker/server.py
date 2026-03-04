#!/usr/bin/env python3
import json
import math
import os
import time
import urllib.error
import urllib.request
from hashlib import sha256
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path


HOST = os.environ.get("RECONSTRUCTION_HOST", "0.0.0.0")
PORT = int(os.environ.get("RECONSTRUCTION_PORT", "8000"))
ARTIFACT_DIR = os.environ.get("RECONSTRUCTION_ARTIFACT_DIR", "").strip()
MODEL_PROVIDER = os.environ.get("RECONSTRUCTION_MODEL_PROVIDER", "contour-prior-v1").strip()
MODEL_VERSION = os.environ.get("RECONSTRUCTION_MODEL_VERSION", "0.1.0").strip()
NEURAL_ENDPOINT_URL = os.environ.get("RECONSTRUCTION_NEURAL_ENDPOINT_URL", "").strip()
NEURAL_ENDPOINT_TIMEOUT_SECONDS = float(
    os.environ.get("RECONSTRUCTION_NEURAL_ENDPOINT_TIMEOUT_SECONDS", "6")
)


def normalize_points(points):
    if not isinstance(points, list):
        return []

    valid = []
    for point in points:
        if (
            not isinstance(point, list)
            or len(point) != 2
            or not isinstance(point[0], (int, float))
            or not isinstance(point[1], (int, float))
        ):
            continue

        x = float(point[0])
        y = float(point[1])
        if x < 0 or x > 1 or y < 0 or y > 1:
            continue
        valid.append([x, y])

    return valid


def contour_area(points):
    total = 0.0
    for idx, point in enumerate(points):
        x1, y1 = point
        x2, y2 = points[(idx + 1) % len(points)]
        total += x1 * y2 - x2 * y1
    return total / 2.0


def sort_points_by_angle(points):
    cx = sum(point[0] for point in points) / len(points)
    cy = sum(point[1] for point in points) / len(points)
    return sorted(points, key=lambda p: math.atan2(p[1] - cy, p[0] - cx))


def dedupe_points(points):
    deduped = []
    for point in points:
        rounded = [round(point[0], 4), round(point[1], 4)]
        if not deduped or deduped[-1] != rounded:
            deduped.append(rounded)
    return deduped


def normalize_contour(points):
    mapped = [[point[0] * 2 - 1, (1 - point[1]) * 2 - 1] for point in points]
    cx = sum(point[0] for point in mapped) / len(mapped)
    cy = sum(point[1] for point in mapped) / len(mapped)
    centered = [[point[0] - cx, point[1] - cy] for point in mapped]

    max_abs = 0.0
    for point in centered:
        max_abs = max(max_abs, abs(point[0]), abs(point[1]))

    scale = 1.0 / max_abs if max_abs > 0 else 1.0
    return [[point[0] * scale, point[1] * scale] for point in centered]


def compute_bbox(points):
    min_x = min(point[0] for point in points)
    min_y = min(point[1] for point in points)
    max_x = max(point[0] for point in points)
    max_y = max(point[1] for point in points)
    width = max(0.0, max_x - min_x)
    height = max(0.0, max_y - min_y)
    center_x = min_x + width / 2
    center_y = min_y + height / 2
    return {
        "minX": round(min_x, 4),
        "minY": round(min_y, 4),
        "maxX": round(max_x, 4),
        "maxY": round(max_y, 4),
        "width": round(width, 4),
        "height": round(height, 4),
        "centerX": round(center_x, 4),
        "centerY": round(center_y, 4),
    }


def canonicalize_points(points):
    bbox = compute_bbox(points)
    width = bbox["width"]
    height = bbox["height"]
    largest = max(width, height)
    if largest <= 0:
        return [], bbox, {"scaleToUnitSquare": 1.0, "padding": 0.08}

    padding = 0.08
    scale_to_unit = (1.0 - padding * 2) / largest
    center_x = bbox["centerX"]
    center_y = bbox["centerY"]

    transformed = []
    for x, y in points:
        nx = 0.5 + (x - center_x) * scale_to_unit
        ny = 0.5 + (y - center_y) * scale_to_unit
        transformed.append([round(nx, 4), round(ny, 4)])

    return transformed, bbox, {"scaleToUnitSquare": round(scale_to_unit, 4), "padding": padding}


def build_obj_from_silhouette(points, depth=0.3):
    contour = dedupe_points(sort_points_by_angle(normalize_contour(points)))
    if len(contour) < 8:
        return None

    ordered = list(reversed(contour)) if contour_area(contour) < 0 else contour
    half_depth = depth / 2

    vertices = []
    uvs = []
    faces = []

    top_offset = 1
    bottom_offset = top_offset + len(ordered)
    top_center_index = bottom_offset + len(ordered)
    bottom_center_index = top_center_index + 1

    for x, y in ordered:
        vertices.append(f"v {x:.4f} {y:.4f} {half_depth:.4f}")
    for x, y in ordered:
        vertices.append(f"v {x:.4f} {y:.4f} {-half_depth:.4f}")
    vertices.append(f"v 0.0000 0.0000 {half_depth:.4f}")
    vertices.append(f"v 0.0000 0.0000 {-half_depth:.4f}")

    for x, y in ordered:
        uvs.append(f"vt {(x * 0.5 + 0.5):.4f} {(y * 0.5 + 0.5):.4f}")
    for x, y in ordered:
        uvs.append(f"vt {(x * 0.5 + 0.5):.4f} {(y * 0.5 + 0.5):.4f}")
    uvs.append("vt 0.5000 0.5000")

    for idx in range(len(ordered)):
        nxt = (idx + 1) % len(ordered)
        top_a = top_offset + idx
        top_b = top_offset + nxt
        bottom_a = bottom_offset + idx
        bottom_b = bottom_offset + nxt

        faces.append(f"f {top_a}/{top_a} {top_b}/{top_b} {top_center_index}/{len(ordered) * 2 + 1}")
        faces.append(f"f {bottom_a}/{bottom_a} {bottom_center_index}/{len(ordered) * 2 + 1} {bottom_b}/{bottom_b}")
        faces.append(f"f {top_a}/{top_a} {bottom_a}/{bottom_a} {bottom_b}/{bottom_b}")
        faces.append(f"f {top_a}/{top_a} {bottom_b}/{bottom_b} {top_b}/{top_b}")

    reconstruction = {
        "obj": "\n".join(
            [
                "# MushyAI worker reconstruction mesh",
                "o mushyai_worker_reconstructed",
                *vertices,
                *uvs,
                *faces,
                "",
            ]
        ),
        "contourPoints": len(ordered),
        "vertexCount": len(ordered) * 2 + 2,
        "faceCount": len(faces),
    }
    return reconstruction


def compute_depth_from_bbox(bbox):
    width = max(0.0001, float(bbox["width"]))
    height = max(0.0001, float(bbox["height"]))
    aspect = width / height
    aspect_penalty = max(0.0, min(1.0, abs(1.0 - aspect)))
    depth = 0.24 + aspect_penalty * 0.12
    return round(max(0.16, min(0.42, depth)), 4)


def estimate_model_confidence(points, bbox):
    count_score = max(0.0, min(1.0, len(points) / 48.0))
    fill = float(bbox["width"]) * float(bbox["height"])
    fill_score = max(0.0, min(1.0, fill / 0.5))
    confidence = count_score * 0.6 + fill_score * 0.4
    return round(max(0.25, min(0.96, confidence)), 2)


def infer_mesh_parameters(prompt, canonical_points, bbox):
    prompt_text = str(prompt or "").lower()
    hard_surface_bias = any(
        token in prompt_text
        for token in ["ship", "falcon", "vehicle", "hard-surface", "panel", "hull"]
    )
    smooth_bias = any(
        token in prompt_text
        for token in ["organic", "creature", "soft", "rounded", "sphere"]
    )

    depth = compute_depth_from_bbox(bbox)
    if hard_surface_bias:
        depth = round(min(0.46, depth + 0.04), 4)
    if smooth_bias:
        depth = round(max(0.16, depth - 0.03), 4)

    vertex_budget_hint = int(max(16, min(256, len(canonical_points) * 6)))
    confidence = estimate_model_confidence(canonical_points, bbox)

    return {
        "model": {
            "provider": MODEL_PROVIDER,
            "version": MODEL_VERSION,
            "inputFeatures": {
                "silhouettePointCount": len(canonical_points),
                "bboxAspectRatio": round(
                    float(bbox["width"]) / max(0.0001, float(bbox["height"])), 3
                ),
                "hardSurfaceBias": hard_surface_bias,
                "smoothBias": smooth_bias,
            },
            "confidence": confidence,
        },
        "depth": depth,
        "vertexBudgetHint": vertex_budget_hint,
    }


def run_local_inference(prompt, canonical_points, bbox):
    return infer_mesh_parameters(prompt, canonical_points, bbox), []


def run_neural_endpoint_inference(prompt, canonical_points, bbox):
    if not NEURAL_ENDPOINT_URL:
        raise RuntimeError("RECONSTRUCTION_NEURAL_ENDPOINT_URL is not configured.")

    payload = {
        "prompt": prompt,
        "silhouettePoints": canonical_points,
        "boundingBox": bbox,
    }
    request = urllib.request.Request(
        NEURAL_ENDPOINT_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(
            request, timeout=NEURAL_ENDPOINT_TIMEOUT_SECONDS
        ) as response:
            body = json.loads(response.read().decode("utf-8") or "{}")
    except urllib.error.URLError as error:
        raise RuntimeError(f"Neural endpoint request failed: {error}") from error

    depth = float(body.get("depth", compute_depth_from_bbox(bbox)))
    depth = round(max(0.16, min(0.5, depth)), 4)
    vertex_budget_hint = int(body.get("vertexBudgetHint", len(canonical_points) * 6))
    vertex_budget_hint = int(max(16, min(384, vertex_budget_hint)))
    confidence = float(body.get("confidence", estimate_model_confidence(canonical_points, bbox)))
    confidence = round(max(0.1, min(0.99, confidence)), 2)
    provider_version = str(body.get("modelVersion", MODEL_VERSION))
    model_features = body.get("inputFeatures")
    if not isinstance(model_features, dict):
        model_features = {
            "silhouettePointCount": len(canonical_points),
            "bboxAspectRatio": round(
                float(bbox["width"]) / max(0.0001, float(bbox["height"])), 3
            ),
            "source": "neural-endpoint-default",
        }

    return (
        {
            "model": {
                "provider": "neural-endpoint-v1",
                "version": provider_version,
                "inputFeatures": model_features,
                "confidence": confidence,
            },
            "depth": depth,
            "vertexBudgetHint": vertex_budget_hint,
        },
        [],
    )


def run_model_inference(prompt, canonical_points, bbox):
    provider = MODEL_PROVIDER.lower()
    if provider == "neural-endpoint-v1":
        try:
            return run_neural_endpoint_inference(prompt, canonical_points, bbox)
        except Exception as error:
            fallback, _ = run_local_inference(prompt, canonical_points, bbox)
            fallback["model"]["provider"] = "contour-prior-v1"
            fallback["model"]["version"] = MODEL_VERSION
            fallback["model"]["fallbackFrom"] = "neural-endpoint-v1"
            return fallback, [f"Neural inference failed, fallback used: {error}"]

    return run_local_inference(prompt, canonical_points, bbox)


def color_from_prompt(prompt):
    digest = sha256(str(prompt or "").encode("utf-8")).hexdigest()
    r = int(digest[0:2], 16)
    g = int(digest[2:4], 16)
    b = int(digest[4:6], 16)
    # Keep texture in visible mid-range
    r = int(60 + (r / 255) * 170)
    g = int(60 + (g / 255) * 170)
    b = int(60 + (b / 255) * 170)
    return r, g, b


def build_texture_ppm(prompt, size=64):
    r, g, b = color_from_prompt(prompt)
    header = f"P3\n{size} {size}\n255\n"
    rows = []
    for y in range(size):
        row = []
        for x in range(size):
            shade = ((x + y) % 8) * 3
            row.extend([str(max(0, min(255, r - shade))), str(max(0, min(255, g - shade))), str(max(0, min(255, b - shade)))])
        rows.append(" ".join(row))
    return header + "\n".join(rows) + "\n"


def build_material_mtl(texture_file_name):
    return (
        "newmtl mushyai_material\n"
        "Ka 1.000 1.000 1.000\n"
        "Kd 1.000 1.000 1.000\n"
        "Ks 0.150 0.150 0.150\n"
        "Ns 32.0\n"
        "d 1.0\n"
        f"map_Kd {texture_file_name}\n"
    )


def build_job_id(reference_image, points):
    source = (
        f"{reference_image.get('sha256', '')}|"
        f"{reference_image.get('fileName', '')}|"
        f"{len(points)}|{time.time_ns()}"
    )
    digest = sha256(source.encode("utf-8")).hexdigest()[:12]
    return f"job-{int(time.time() * 1000)}-{digest}"


def persist_artifacts(job_id, mesh, normalized_contour, manifest, material_text, texture_text):
    if not ARTIFACT_DIR:
        return None

    job_dir = Path(ARTIFACT_DIR) / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    manifest_path = job_dir / "manifest.json"
    contour_path = job_dir / "normalized_contour.json"
    mesh_path = job_dir / "reconstructed_mesh.obj"
    material_path = job_dir / "reconstructed_material.mtl"
    texture_path = job_dir / "reconstructed_basecolor.ppm"

    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    contour_path.write_text(json.dumps(normalized_contour, indent=2), encoding="utf-8")
    mesh_path.write_text(mesh["obj"], encoding="utf-8")
    material_path.write_text(material_text, encoding="utf-8")
    texture_path.write_text(texture_text, encoding="utf-8")

    return {
        "storage": "filesystem",
        "basePath": str(job_dir.resolve()),
        "files": [
            str(manifest_path.resolve()),
            str(contour_path.resolve()),
            str(mesh_path.resolve()),
            str(material_path.resolve()),
            str(texture_path.resolve()),
        ],
    }


def reconstruct_from_payload(payload):
    job_started = time.perf_counter()
    stage_times = {}

    validate_started = time.perf_counter()
    reference_image = payload.get("referenceImage")
    if not isinstance(reference_image, dict):
        return 422, {"error": "referenceImage is required."}

    silhouette = reference_image.get("silhouette")
    if not isinstance(silhouette, dict):
        return 422, {"error": "referenceImage.silhouette is required."}

    points = normalize_points(silhouette.get("points"))
    if len(points) < 8:
        return 422, {"error": "referenceImage.silhouette.points must include at least 8 normalized points."}
    stage_times["validate"] = round((time.perf_counter() - validate_started) * 1000, 2)

    preprocess_started = time.perf_counter()
    canonical_points, bbox, canonicalization = canonicalize_points(points)
    if len(canonical_points) < 8:
        return 422, {"error": "Could not canonicalize silhouette points."}
    stage_times["preprocess"] = round((time.perf_counter() - preprocess_started) * 1000, 2)

    inference_started = time.perf_counter()
    inference, warnings = run_model_inference(
        payload.get("prompt"), canonical_points, bbox
    )
    stage_times["inference"] = round((time.perf_counter() - inference_started) * 1000, 2)

    mesh_started = time.perf_counter()
    depth = inference["depth"]
    mesh = build_obj_from_silhouette(canonical_points, depth=depth)
    if not mesh:
        return 422, {"error": "Could not construct reconstruction mesh from contour."}
    stage_times["mesh"] = round((time.perf_counter() - mesh_started) * 1000, 2)

    postprocess_started = time.perf_counter()
    normalized_contour = dedupe_points(sort_points_by_angle(normalize_contour(canonical_points)))
    texture_text = build_texture_ppm(payload.get("prompt"), size=64)
    material_text = build_material_mtl("reconstructed_basecolor.ppm")
    job_id = build_job_id(reference_image, points)
    artifact_manifest = {
        "pipelineVersion": "worker-pipeline-v0.4",
        "jobId": job_id,
        "stages": [
            "validate-silhouette",
            "canonicalize-contour",
            "run-model-inference",
            "generate-mesh",
            "postprocess-mesh",
            "generate-material-texture",
        ],
        "stats": {
            "sourcePointCount": len(points),
            "canonicalPointCount": len(canonical_points),
            "normalizedContourPointCount": len(normalized_contour),
            "sourceBoundingBox": bbox,
            "canonicalization": canonicalization,
            "inference": inference["model"],
            "postprocess": {
                "depth": depth,
                "vertexCount": mesh["vertexCount"],
                "faceCount": mesh["faceCount"],
                "vertexBudgetHint": inference["vertexBudgetHint"],
            },
            "texture": {
                "format": "ppm",
                "size": 64,
            },
        },
    }
    persisted = persist_artifacts(
        job_id,
        mesh,
        normalized_contour,
        artifact_manifest,
        material_text,
        texture_text,
    )
    stage_times["postprocess"] = round((time.perf_counter() - postprocess_started) * 1000, 2)
    total_ms = round((time.perf_counter() - job_started) * 1000, 2)

    return (
        200,
        {
            "type": "reconstruction",
            "reconstruction": {
                "method": "worker-silhouette-extrusion-v1",
                "jobId": job_id,
                "model": inference["model"],
                "inputContourPoints": mesh["contourPoints"],
                "telemetry": {
                    "pipelineVersion": "worker-pipeline-v0.4",
                    "timingsMs": stage_times,
                    "totalMs": total_ms,
                },
                "preprocess": {
                    "pipeline": "silhouette-canonicalization-v1",
                    "sourceBoundingBox": bbox,
                    "canonicalization": canonicalization,
                },
                "postprocess": {
                    "pipeline": "mesh-postprocess-v1",
                    "depth": depth,
                    "vertexCount": mesh["vertexCount"],
                    "faceCount": mesh["faceCount"],
                    "vertexBudgetHint": inference["vertexBudgetHint"],
                },
                "artifacts": {
                    "normalizedContour": normalized_contour,
                    "manifest": artifact_manifest,
                    "store": persisted,
                },
                "materials": {
                    "format": "mtl",
                    "fileName": "reconstructed_material.mtl",
                    "content": material_text,
                },
                "textures": [
                    {
                        "kind": "baseColor",
                        "format": "ppm",
                        "fileName": "reconstructed_basecolor.ppm",
                        "content": texture_text,
                    }
                ],
                "warnings": warnings,
                "mesh": {
                    "format": "obj",
                    "fileName": "worker_reconstructed_mesh.obj",
                    "content": mesh["obj"],
                    "vertexCount": mesh["vertexCount"],
                    "faceCount": mesh["faceCount"],
                },
            },
        },
    )


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/healthz":
            self._send_json(200, {"ok": True})
            return
        self._send_json(404, {"error": "Not found."})

    def do_POST(self):
        if self.path != "/reconstruct":
            self._send_json(404, {"error": "Not found."})
            return

        content_type = self.headers.get("Content-Type", "")
        if not content_type.lower().startswith("application/json"):
            self._send_json(415, {"error": "Content-Type must be application/json."})
            return

        content_length = self.headers.get("Content-Length")
        if not content_length:
            self._send_json(400, {"error": "Request body is required."})
            return

        try:
            length = int(content_length)
            raw = self.rfile.read(length)
            payload = json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            self._send_json(400, {"error": "Request body must be valid JSON."})
            return

        status, body = reconstruct_from_payload(payload)
        self._send_json(status, body)


if __name__ == "__main__":
    server = HTTPServer((HOST, PORT), Handler)
    print(f"mushyai-reconstruction-worker listening on {PORT}", flush=True)
    server.serve_forever()
