import http from "node:http";
import {
  generateCalibrationResult,
  generatePromptInterpretation,
} from "./generator.js";

const port = Number(process.env.PORT ?? 3000);

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let raw = "";

    request.on("data", (chunk) => {
      raw += chunk;

      if (raw.length > 1024 * 1024) {
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

function validateCalibrationPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return "Request body is required.";
  }

  if (typeof payload.fileName !== "string" || !payload.fileName.trim()) {
    return "fileName is required.";
  }

  if (payload.width !== payload.height || payload.width <= 0) {
    return "Calibration requires a square image.";
  }

  return "";
}

const server = http.createServer(async (request, response) => {
  if (!request.url) {
    sendJson(response, 404, { error: "Not found." });
    return;
  }

  if (request.method === "GET" && request.url === "/healthz") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && request.url === "/api/generate") {
    try {
      const payload = await readBody(request);
      const error = validateGeneratePayload(payload);

      if (error) {
        sendJson(response, 400, { error });
        return;
      }

      sendJson(response, 200, generatePromptInterpretation(payload));
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  if (request.method === "POST" && request.url === "/api/calibrate") {
    try {
      const payload = await readBody(request);
      const error = validateCalibrationPayload(payload);

      if (error) {
        sendJson(response, 400, { error });
        return;
      }

      sendJson(response, 200, generateCalibrationResult(payload));
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
