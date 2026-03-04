import http from "node:http";
import { generatePromptInterpretation } from "./generator.js";
import { requestWorkerReconstruction } from "./reconstructionClient.js";

const port = Number(process.env.PORT ?? 3000);
const REQUEST_LIMIT_BYTES = 1024 * 1024;
const RATE_LIMIT_WINDOW_MS = 15_000;
const RATE_LIMIT_MAX_REQUESTS = 40;
const CACHE_MAX_ITEMS = 120;
const STYLE_PRESETS = new Set([
  "product",
  "stylized",
  "hard-surface",
  "organic",
]);
const TOPOLOGIES = new Set(["game-ready", "cinematic"]);
const TEXTURE_DETAILS = new Set(["1k", "2k", "4k", "8k"]);
const REFERENCE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);
const REFERENCE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const REFERENCE_IMAGE_MIN_DIMENSION = 128;
const REFERENCE_IMAGE_MAX_DIMENSION = 4096;
const REFERENCE_IMAGE_MAX_CONTOUR_POINTS = 256;
const generationCache = new Map();
const requestBuckets = new Map();

function pruneRateBuckets(now) {
  requestBuckets.forEach((bucket, key) => {
    if (now - bucket.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
      requestBuckets.delete(key);
    }
  });
}

function hitRateLimit(clientId) {
  const now = Date.now();
  const bucket = requestBuckets.get(clientId);

  if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
    requestBuckets.set(clientId, { count: 1, windowStart: now });
    pruneRateBuckets(now);
    return false;
  }

  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX_REQUESTS;
}

function readClientId(request) {
  const forwardedFor = request.headers["x-forwarded-for"];

  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim();
  }

  return request.socket.remoteAddress ?? "unknown";
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  });
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let byteLength = 0;

    request.on("data", (chunk) => {
      byteLength += chunk.length;
      raw += chunk;

      if (byteLength > REQUEST_LIMIT_BYTES) {
        reject(new Error("Payload too large."));
        request.destroy();
      }
    });

    request.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });

    request.on("error", reject);
  });
}

function validateGeneratePayload(payload) {
  if (!payload || typeof payload !== "object") {
    return { error: "Request body is required.", value: null };
  }

  const rawPrompt =
    typeof payload.prompt === "string"
      ? payload.prompt
      : payload.prompt === undefined || payload.prompt === null
        ? ""
        : null;
  if (rawPrompt === null) {
    return { error: "Prompt must be a string when provided.", value: null };
  }
  const prompt = rawPrompt.trim().replace(/\s+/g, " ");

  let referenceImage = null;
  if (payload.referenceImage !== undefined && payload.referenceImage !== null) {
    const value = payload.referenceImage;

    if (!value || typeof value !== "object") {
      return { error: "referenceImage must be an object.", value: null };
    }

    if (typeof value.fileName !== "string" || !value.fileName.trim()) {
      return { error: "referenceImage.fileName is required.", value: null };
    }

    if (!REFERENCE_IMAGE_TYPES.has(value.mimeType)) {
      return {
        error: "referenceImage.mimeType must be PNG, JPEG, WEBP, or SVG.",
        value: null,
      };
    }

    if (
      typeof value.sizeBytes !== "number" ||
      !Number.isFinite(value.sizeBytes) ||
      value.sizeBytes <= 0 ||
      value.sizeBytes > REFERENCE_IMAGE_MAX_BYTES
    ) {
      return {
        error: "referenceImage.sizeBytes must be between 1 and 8388608.",
        value: null,
      };
    }

    if (
      !Number.isInteger(value.width) ||
      !Number.isInteger(value.height) ||
      value.width < REFERENCE_IMAGE_MIN_DIMENSION ||
      value.height < REFERENCE_IMAGE_MIN_DIMENSION ||
      value.width > REFERENCE_IMAGE_MAX_DIMENSION ||
      value.height > REFERENCE_IMAGE_MAX_DIMENSION
    ) {
      return {
        error: "referenceImage dimensions must be 128..4096 pixels.",
        value: null,
      };
    }

    if (
      typeof value.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/i.test(value.sha256)
    ) {
      return {
        error: "referenceImage.sha256 must be a 64-char hex digest.",
        value: null,
      };
    }

    const caption =
      typeof value.caption === "string"
        ? value.caption.trim().replace(/\s+/g, " ").slice(0, 160)
        : "";
    let silhouette = null;
    if (value.silhouette !== undefined && value.silhouette !== null) {
      const raw = value.silhouette;
      if (!raw || typeof raw !== "object") {
        return {
          error: "referenceImage.silhouette must be an object.",
          value: null,
        };
      }

      if (
        typeof raw.algorithm !== "string" ||
        !raw.algorithm.trim() ||
        !Array.isArray(raw.points)
      ) {
        return {
          error:
            "referenceImage.silhouette requires algorithm and points array.",
          value: null,
        };
      }

      if (
        raw.points.length < 8 ||
        raw.points.length > REFERENCE_IMAGE_MAX_CONTOUR_POINTS
      ) {
        return {
          error: "referenceImage.silhouette.points must contain 8..256 points.",
          value: null,
        };
      }

      const points = [];
      for (const point of raw.points) {
        if (
          !Array.isArray(point) ||
          point.length !== 2 ||
          typeof point[0] !== "number" ||
          typeof point[1] !== "number" ||
          !Number.isFinite(point[0]) ||
          !Number.isFinite(point[1]) ||
          point[0] < 0 ||
          point[0] > 1 ||
          point[1] < 0 ||
          point[1] > 1
        ) {
          return {
            error:
              "referenceImage.silhouette points must be normalized [x,y] pairs.",
            value: null,
          };
        }

        points.push([Number(point[0].toFixed(4)), Number(point[1].toFixed(4))]);
      }

      silhouette = {
        algorithm: raw.algorithm.trim().slice(0, 64),
        pointCount: points.length,
        points,
      };
    }

    referenceImage = {
      fileName: value.fileName.trim().slice(0, 128),
      mimeType: value.mimeType,
      sizeBytes: value.sizeBytes,
      width: value.width,
      height: value.height,
      sha256: value.sha256.toLowerCase(),
      caption,
      silhouette,
    };
  }

  if (!prompt && !referenceImage) {
    return {
      error: "Provide a prompt or a reference image.",
      value: null,
    };
  }

  if (prompt) {
    if (prompt.length < 3) {
      return { error: "Prompt must be at least 3 characters.", value: null };
    }

    if (!/[a-z0-9]{3}/i.test(prompt)) {
      return {
        error: "Prompt must include recognizable words or object names.",
        value: null,
      };
    }
  }

  return {
    error: "",
    value: {
      prompt,
      stylePreset: STYLE_PRESETS.has(payload.stylePreset)
        ? payload.stylePreset
        : "product",
      topology: TOPOLOGIES.has(payload.topology)
        ? payload.topology
        : "game-ready",
      textureDetail: TEXTURE_DETAILS.has(payload.textureDetail)
        ? payload.textureDetail
        : "2k",
      referenceImage,
    },
  };
}

function isJsonRequest(request) {
  const contentType = request.headers["content-type"] ?? "";
  return contentType.toLowerCase().startsWith("application/json");
}

async function maybeCachedGeneration(payload) {
  const reconstructionResult =
    payload.referenceImage !== null
      ? await requestWorkerReconstruction(payload)
      : {
          mode: "disabled",
          reconstruction: null,
          warning: "",
        };

  const key = JSON.stringify({
    prompt: payload.prompt,
    stylePreset: payload.stylePreset,
    topology: payload.topology,
    textureDetail: payload.textureDetail,
    referenceImage: payload.referenceImage,
    reconstructionMode: reconstructionResult.mode,
  });

  if (generationCache.has(key)) {
    const cached = generationCache.get(key);
    generationCache.delete(key);
    generationCache.set(key, cached);
    return cached;
  }

  const generated = await generatePromptInterpretation({
    ...payload,
    reconstructionOverride:
      reconstructionResult.mode === "worker"
        ? reconstructionResult.reconstruction
        : undefined,
    reconstructionProvider:
      reconstructionResult.mode === "worker"
        ? "external-worker"
        : payload.referenceImage
          ? "in-process-fallback"
          : "none",
    runtimeWarnings: reconstructionResult.warning
      ? [reconstructionResult.warning]
      : [],
  });
  generationCache.set(key, generated);

  if (generationCache.size > CACHE_MAX_ITEMS) {
    const oldest = generationCache.keys().next().value;
    generationCache.delete(oldest);
  }

  return generated;
}
const server = http.createServer(async (request, response) => {
  if (!request.url) {
    sendJson(response, 404, { error: "Not found." });
    return;
  }

  const pathname = new URL(request.url, "http://localhost").pathname;

  if (request.method === "GET" && pathname === "/healthz") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && pathname === "/api/generate") {
    if (hitRateLimit(readClientId(request))) {
      sendJson(response, 429, {
        error: "Too many requests. Slow down slightly.",
      });
      return;
    }

    if (!isJsonRequest(request)) {
      sendJson(response, 415, {
        error: "Content-Type must be application/json.",
      });
      return;
    }
  }

  if (request.method === "POST" && pathname === "/api/generate") {
    try {
      const payload = await readBody(request);
      const validation = validateGeneratePayload(payload);

      if (validation.error) {
        sendJson(response, 400, { error: validation.error });
        return;
      }

      const result = await maybeCachedGeneration(validation.value);
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  sendJson(response, 404, { error: "Not found." });
});

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`mushyai-backend listening on ${port}\n`);
});
