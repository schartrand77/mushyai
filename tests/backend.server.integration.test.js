import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const HOST = "127.0.0.1";
const START_TIMEOUT_MS = 12_000;

function pickPort() {
  return 39000 + Math.floor(Math.random() * 1000);
}

function basePayload() {
  return {
    prompt: "A frosted glass sphere with studio light",
    stylePreset: "product",
    topology: "game-ready",
    textureDetail: "2k",
    referenceImage: {
      fileName: "sample.png",
      mimeType: "image/png",
      sizeBytes: 2048,
      width: 512,
      height: 512,
      sha256: "a".repeat(64),
      caption: "front view",
      silhouette: {
        algorithm: "radial-mask-v1",
        points: [
          [0.5, 0.1],
          [0.64, 0.16],
          [0.76, 0.28],
          [0.9, 0.5],
          [0.84, 0.66],
          [0.72, 0.8],
          [0.5, 0.9],
          [0.32, 0.82],
          [0.18, 0.68],
          [0.1, 0.5],
          [0.18, 0.3],
          [0.34, 0.16],
        ],
      },
    },
  };
}

describe("backend /api/generate validation integration", () => {
  const port = pickPort();
  const baseUrl = `http://${HOST}:${port}`;
  let serverProcess = null;
  let startupError = "";

  beforeAll(async () => {
    serverProcess = spawn(process.execPath, ["backend/server.js"], {
      env: {
        ...process.env,
        PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    serverProcess.stderr.on("data", (chunk) => {
      startupError += String(chunk);
    });

    let started = false;
    serverProcess.stdout.on("data", (chunk) => {
      const output = String(chunk);
      if (output.includes("mushyai-backend listening on")) {
        started = true;
      }
    });

    const startAt = Date.now();
    while (!started && Date.now() - startAt < START_TIMEOUT_MS) {
      if (serverProcess.exitCode !== null) {
        throw new Error(
          `Backend exited before startup. stderr:\n${startupError}`,
        );
      }
      await delay(60);
    }

    if (!started) {
      serverProcess.kill();
      throw new Error(
        `Backend did not start within ${START_TIMEOUT_MS}ms.\n${startupError}`,
      );
    }

    const health = await fetch(`${baseUrl}/healthz`);
    expect(health.status).toBe(200);
  });

  afterAll(async () => {
    if (!serverProcess || serverProcess.exitCode !== null) {
      return;
    }

    serverProcess.kill();
    const startAt = Date.now();
    while (serverProcess.exitCode === null && Date.now() - startAt < 4000) {
      await delay(50);
    }

    if (serverProcess.exitCode === null) {
      serverProcess.kill("SIGKILL");
    }
  });

  async function postGenerate(payload) {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const json = await response.json();
    return { response, json };
  }

  it("rejects referenceImage payload with an invalid digest", async () => {
    const payload = basePayload();
    payload.referenceImage.sha256 = "not-a-valid-digest";

    const { response, json } = await postGenerate(payload);

    expect(response.status).toBe(400);
    expect(json.error).toContain("referenceImage.sha256");
  });

  it("rejects referenceImage payload with out-of-range dimensions", async () => {
    const payload = basePayload();
    payload.referenceImage.width = 64;
    payload.referenceImage.height = 8192;

    const { response, json } = await postGenerate(payload);

    expect(response.status).toBe(400);
    expect(json.error).toContain("dimensions");
  });

  it("rejects referenceImage payload with invalid silhouette schema", async () => {
    const payload = basePayload();
    payload.referenceImage.silhouette = {
      algorithm: "radial-mask-v1",
      points: [[0.2, 0.4], [0.7, 0.6, 0.5], "bad-point"],
    };

    const { response, json } = await postGenerate(payload);

    expect(response.status).toBe(400);
    expect(json.error).toContain("silhouette");
  });

  it("accepts image-only requests without a text prompt", async () => {
    const payload = basePayload();
    payload.prompt = "";

    const { response, json } = await postGenerate(payload);

    expect(response.status).toBe(200);
    expect(json.type).toBe("generation");
    expect(json.input.prompt).toBe("");
    expect(json.input.referenceImage.fileName).toBe("sample.png");
  });
});
