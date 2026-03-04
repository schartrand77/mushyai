const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_RETRIES = 1;

function getWorkerUrl() {
  return String(process.env.RECONSTRUCTION_WORKER_URL ?? "").trim();
}

function normalizeWorkerResponse(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const reconstruction =
    payload.reconstruction && typeof payload.reconstruction === "object"
      ? payload.reconstruction
      : payload;

  if (!reconstruction || typeof reconstruction !== "object") {
    return null;
  }

  if (typeof reconstruction.method !== "string" || !reconstruction.method) {
    return null;
  }

  if (!reconstruction.mesh || typeof reconstruction.mesh !== "object") {
    return null;
  }

  const mesh = reconstruction.mesh;
  if (
    typeof mesh.format !== "string" ||
    typeof mesh.fileName !== "string" ||
    typeof mesh.content !== "string" ||
    typeof mesh.vertexCount !== "number" ||
    typeof mesh.faceCount !== "number"
  ) {
    return null;
  }

  return reconstruction;
}

export async function requestWorkerReconstruction(payload, fetchImpl = fetch) {
  const workerUrl = getWorkerUrl();
  if (!workerUrl) {
    return {
      mode: "disabled",
      reconstruction: null,
      warning: "",
    };
  }

  const timeoutMs = Number(process.env.RECONSTRUCTION_WORKER_TIMEOUT_MS);
  const effectiveTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : DEFAULT_TIMEOUT_MS;
  const retries = Number(process.env.RECONSTRUCTION_WORKER_RETRIES);
  const maxRetries = Number.isFinite(retries) && retries >= 0
    ? Math.floor(retries)
    : DEFAULT_RETRIES;

  let lastWarning = "Worker request failed.";
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), effectiveTimeout);

    try {
      const response = await fetchImpl(`${workerUrl}/reconstruct`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          prompt: payload.prompt,
          stylePreset: payload.stylePreset,
          topology: payload.topology,
          textureDetail: payload.textureDetail,
          referenceImage: payload.referenceImage,
        }),
      });

      if (!response.ok) {
        let workerMessage = `Worker returned status ${response.status}.`;
        const body = await response.json().catch(() => null);
        if (body && typeof body.error === "string" && body.error) {
          workerMessage = `Worker returned status ${response.status}: ${body.error}`;
        }
        lastWarning = workerMessage;

        if (attempt < maxRetries) {
          continue;
        }

        return {
          mode: "failed",
          reconstruction: null,
          warning: workerMessage,
        };
      }

      const body = await response.json().catch(() => null);
      const reconstruction = normalizeWorkerResponse(body);
      if (!reconstruction) {
        lastWarning = "Worker response schema is invalid.";
        if (attempt < maxRetries) {
          continue;
        }

        return {
          mode: "failed",
          reconstruction: null,
          warning: lastWarning,
        };
      }

      return {
        mode: "worker",
        reconstruction,
        warning: "",
      };
    } catch (error) {
      const message =
        error && typeof error.message === "string"
          ? error.message
          : "Worker request failed.";
      lastWarning = `Worker request failed: ${message}`;

      if (attempt < maxRetries) {
        continue;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    mode: "failed",
    reconstruction: null,
    warning: lastWarning,
  };
}
