import { describe, expect, it } from "vitest";
import { generatePromptInterpretation } from "../backend/generator.js";

function circlePoints(count) {
  const points = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    points.push([
      Number((0.5 + Math.cos(angle) * 0.34).toFixed(4)),
      Number((0.5 + Math.sin(angle) * 0.34).toFixed(4)),
    ]);
  }
  return points;
}

describe("backend quality gate hardening", () => {
  it("marks weak reconstructions as export-blocked", () => {
    const result = generatePromptInterpretation({
      prompt: "thing",
      stylePreset: "product",
      topology: "game-ready",
      textureDetail: "2k",
      referenceImage: {
        fileName: "weak.png",
        mimeType: "image/png",
        sizeBytes: 5000,
        width: 512,
        height: 512,
        sha256: "d".repeat(64),
        silhouette: {
          algorithm: "radial-mask-v1",
          points: circlePoints(8),
        },
      },
    });

    expect(result.qualityReport.pass).toBe(false);
    expect(result.export.ready).toBe(false);
    expect(result.qualityReport.findings.length).toBeGreaterThan(0);
  });

  it("keeps export ready for strong reconstruction evidence", () => {
    const result = generatePromptInterpretation({
      prompt: "A frosted glass sphere with studio light",
      stylePreset: "product",
      topology: "game-ready",
      textureDetail: "2k",
      referenceImage: {
        fileName: "strong.png",
        mimeType: "image/png",
        sizeBytes: 8000,
        width: 1024,
        height: 1024,
        sha256: "e".repeat(64),
        silhouette: {
          algorithm: "radial-mask-v1",
          points: circlePoints(32),
        },
      },
    });

    expect(result.reconstruction?.mesh?.vertexCount).toBeGreaterThan(40);
    expect(result.qualityReport.metrics.overall).toBeGreaterThanOrEqual(0.66);
    expect(result.export.ready).toBe(true);
  });

  it("handles malformed silhouette points without crashing", () => {
    const result = generatePromptInterpretation({
      prompt: "A glass sphere",
      stylePreset: "product",
      topology: "game-ready",
      textureDetail: "2k",
      referenceImage: {
        fileName: "bad.png",
        mimeType: "image/png",
        sizeBytes: 2048,
        width: 512,
        height: 512,
        sha256: "f".repeat(64),
        silhouette: {
          algorithm: "radial-mask-v1",
          points: [
            [0.4, 0.4],
            [1.1, 0.5],
            [0.6, Number.NaN],
            "bad",
            [0.5, 0.6],
            [0.55, 0.7],
          ],
        },
      },
    });

    expect(result.reconstruction).toBeNull();
    expect(result.export.ready).toBe(false);
    expect(result.qualityReport.findings).toContain(
      "Low silhouette overlap against reference contour.",
    );
  });
});
