#!/usr/bin/env python3
import json
import math
import os
from http.server import BaseHTTPRequestHandler, HTTPServer


HOST = os.environ.get("RECONSTRUCTION_HOST", "0.0.0.0")
PORT = int(os.environ.get("RECONSTRUCTION_PORT", "8000"))


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

    return {
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


def reconstruct_from_payload(payload):
    reference_image = payload.get("referenceImage")
    if not isinstance(reference_image, dict):
        return 422, {"error": "referenceImage is required."}

    silhouette = reference_image.get("silhouette")
    if not isinstance(silhouette, dict):
        return 422, {"error": "referenceImage.silhouette is required."}

    points = normalize_points(silhouette.get("points"))
    if len(points) < 8:
        return 422, {"error": "referenceImage.silhouette.points must include at least 8 normalized points."}

    mesh = build_obj_from_silhouette(points)
    if not mesh:
        return 422, {"error": "Could not construct reconstruction mesh from contour."}

    return (
        200,
        {
            "type": "reconstruction",
            "reconstruction": {
                "method": "worker-silhouette-extrusion-v1",
                "inputContourPoints": mesh["contourPoints"],
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
