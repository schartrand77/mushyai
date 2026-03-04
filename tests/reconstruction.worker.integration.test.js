import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const HOST = "127.0.0.1";
const START_TIMEOUT_MS = 10_000;
const pythonCheck = spawnSync("python", ["--version"], { encoding: "utf8" });
const hasPython = pythonCheck.status === 0;

function pickPort() {
  return 40000 + Math.floor(Math.random() * 800);
}

function payload() {
  return {
    prompt: "Millennium Falcon reference",
    referenceImage: {
      fileName: "falcon.png",
      mimeType: "image/png",
      sizeBytes: 1000,
      width: 512,
      height: 512,
      sha256: "a".repeat(64),
      silhouette: {
        algorithm: "radial-mask-v1",
        points: [
          [0.2, 0.4],
          [0.3, 0.3],
          [0.45, 0.22],
          [0.62, 0.25],
          [0.78, 0.36],
          [0.88, 0.52],
          [0.76, 0.67],
          [0.6, 0.75],
          [0.42, 0.77],
          [0.28, 0.7],
          [0.18, 0.58],
          [0.14, 0.48],
        ],
      },
    },
  };
}

const workerDescribe = hasPython ? describe : describe.skip;

workerDescribe("reconstruction worker integration", () => {
  const port = pickPort();
  const baseUrl = `http://${HOST}:${port}`;
  const artifactDir = mkdtempSync(join(tmpdir(), "mushyai-worker-artifacts-"));
  let worker = null;
  let startupError = "";

  beforeAll(async () => {
    worker = spawn("python", ["reconstruction_worker/server.py"], {
      env: {
        ...process.env,
        RECONSTRUCTION_HOST: HOST,
        RECONSTRUCTION_PORT: String(port),
        RECONSTRUCTION_ARTIFACT_DIR: artifactDir,
        RECONSTRUCTION_MODEL_PROVIDER: "neural-endpoint-v1",
        RECONSTRUCTION_MODEL_VERSION: "0.1.0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    worker.stderr.on("data", (chunk) => {
      startupError += String(chunk);
    });

    let started = false;
    worker.stdout.on("data", (chunk) => {
      if (String(chunk).includes("mushyai-reconstruction-worker listening on")) {
        started = true;
      }
    });

    const startAt = Date.now();
    while (!started && Date.now() - startAt < START_TIMEOUT_MS) {
      if (worker.exitCode !== null) {
        throw new Error(
          `Worker exited before startup. stderr:\n${startupError}`,
        );
      }
      await delay(50);
    }

    if (!started) {
      worker.kill();
      throw new Error(
        `Worker did not start within ${START_TIMEOUT_MS}ms.\n${startupError}`,
      );
    }
  });

  afterAll(async () => {
    if (!worker || worker.exitCode !== null) {
      return;
    }

    worker.kill();
    const startAt = Date.now();
    while (worker.exitCode === null && Date.now() - startAt < 3000) {
      await delay(50);
    }
    if (worker.exitCode === null) {
      worker.kill("SIGKILL");
    }
    rmSync(artifactDir, { recursive: true, force: true });
  });

  it("returns reconstruction with preprocess and artifact metadata", async () => {
    const response = await fetch(`${baseUrl}/reconstruct`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload()),
    });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.reconstruction.method).toBe("worker-silhouette-extrusion-v1");
    expect(json.reconstruction.preprocess.pipeline).toBe(
      "silhouette-canonicalization-v1",
    );
    expect(json.reconstruction.model.provider).toBe("contour-prior-v1");
    expect(json.reconstruction.model.version).toBe("0.1.0");
    expect(json.reconstruction.model.fallbackFrom).toBe("neural-endpoint-v1");
    expect(typeof json.reconstruction.model.confidence).toBe("number");
    expect(json.reconstruction.telemetry.pipelineVersion).toBe(
      "worker-pipeline-v0.4",
    );
    expect(typeof json.reconstruction.telemetry.totalMs).toBe("number");
    expect(typeof json.reconstruction.telemetry.timingsMs.preprocess).toBe(
      "number",
    );
    expect(json.reconstruction.artifacts.manifest.pipelineVersion).toBe(
      "worker-pipeline-v0.4",
    );
    expect(json.reconstruction.postprocess.pipeline).toBe("mesh-postprocess-v1");
    expect(json.reconstruction.artifacts.store.storage).toBe("filesystem");
    expect(Array.isArray(json.reconstruction.artifacts.store.files)).toBe(true);
    expect(json.reconstruction.artifacts.store.files.length).toBe(5);
    expect(json.reconstruction.materials.format).toBe("mtl");
    expect(Array.isArray(json.reconstruction.textures)).toBe(true);
    expect(json.reconstruction.textures[0].kind).toBe("baseColor");
    expect(Array.isArray(json.reconstruction.warnings)).toBe(true);
    expect(json.reconstruction.warnings.length).toBeGreaterThan(0);
    expect(json.reconstruction.mesh.content).toContain(
      "o mushyai_worker_reconstructed",
    );

    for (const filePath of json.reconstruction.artifacts.store.files) {
      expect(existsSync(filePath)).toBe(true);
    }
    const manifestRaw = readFileSync(
      json.reconstruction.artifacts.store.files[0],
      "utf8",
    );
    const manifest = JSON.parse(manifestRaw);
    expect(manifest.jobId).toBe(json.reconstruction.jobId);
  });
});
