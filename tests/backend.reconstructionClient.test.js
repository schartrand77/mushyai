import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestWorkerReconstruction } from "../backend/reconstructionClient.js";

function basePayload() {
  return {
    prompt: "A sci-fi ship",
    stylePreset: "product",
    topology: "game-ready",
    textureDetail: "2k",
    referenceImage: {
      fileName: "ship.png",
      mimeType: "image/png",
      sizeBytes: 2048,
      width: 512,
      height: 512,
      sha256: "a".repeat(64),
      silhouette: {
        algorithm: "radial-mask-v1",
        points: [
          [0.5, 0.1],
          [0.8, 0.3],
          [0.9, 0.5],
          [0.8, 0.7],
          [0.5, 0.9],
          [0.2, 0.7],
          [0.1, 0.5],
          [0.2, 0.3],
        ],
      },
    },
  };
}

describe("reconstruction worker client", () => {
  beforeEach(() => {
    delete process.env.RECONSTRUCTION_WORKER_URL;
    delete process.env.RECONSTRUCTION_WORKER_TIMEOUT_MS;
  });

  it("returns disabled mode when worker URL is unset", async () => {
    const result = await requestWorkerReconstruction(basePayload(), vi.fn());
    expect(result.mode).toBe("disabled");
    expect(result.reconstruction).toBeNull();
  });

  it("accepts valid worker reconstruction payloads", async () => {
    process.env.RECONSTRUCTION_WORKER_URL = "http://worker.internal";
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        reconstruction: {
          method: "worker-silhouette-extrusion-v1",
          inputContourPoints: 16,
          mesh: {
            format: "obj",
            fileName: "mesh.obj",
            content: "o mesh",
            vertexCount: 64,
            faceCount: 128,
          },
        },
      }),
    });

    const result = await requestWorkerReconstruction(basePayload(), fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.mode).toBe("worker");
    expect(result.warning).toBe("");
    expect(result.reconstruction?.method).toBe("worker-silhouette-extrusion-v1");
  });

  it("returns failed mode when worker response schema is invalid", async () => {
    process.env.RECONSTRUCTION_WORKER_URL = "http://worker.internal";
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hello: "world" }),
    });

    const result = await requestWorkerReconstruction(basePayload(), fetchImpl);

    expect(result.mode).toBe("failed");
    expect(result.warning).toContain("schema");
  });
});
