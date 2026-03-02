import http from "node:http";
import { generatePromptInterpretation } from "./generator.js";

const port = Number(process.env.PORT ?? 3000);
const REQUEST_LIMIT_BYTES = 1024 * 1024;
const RATE_LIMIT_WINDOW_MS = 15_000;
const RATE_LIMIT_MAX_REQUESTS = 40;
const CACHE_MAX_ITEMS = 120;
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
    return "Request body is required.";
  }

  if (typeof payload.prompt !== "string" || payload.prompt.trim().length < 12) {
    return "Prompt must be at least 12 characters.";
  }

  return "";
}

function isJsonRequest(request) {
  const contentType = request.headers["content-type"] ?? "";
  return contentType.toLowerCase().startsWith("application/json");
}

async function maybeCachedGeneration(payload) {
  const key = JSON.stringify({
    prompt: payload.prompt,
    stylePreset: payload.stylePreset,
    topology: payload.topology,
    textureDetail: payload.textureDetail,
  });

  if (generationCache.has(key)) {
    const cached = generationCache.get(key);
    generationCache.delete(key);
    generationCache.set(key, cached);
    return cached;
  }

  const generated = await generatePromptInterpretation(payload);
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

  if (
    request.method === "POST" &&
    pathname === "/api/generate"
  ) {
    if (hitRateLimit(readClientId(request))) {
      sendJson(response, 429, { error: "Too many requests. Slow down slightly." });
      return;
    }

    if (!isJsonRequest(request)) {
      sendJson(response, 415, { error: "Content-Type must be application/json." });
      return;
    }
  }

  if (request.method === "POST" && pathname === "/api/generate") {
    try {
      const payload = await readBody(request);
      const error = validateGeneratePayload(payload);

      if (error) {
        sendJson(response, 400, { error });
        return;
      }

      const result = await maybeCachedGeneration(payload);
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
