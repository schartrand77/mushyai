import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  STAGES,
  advanceJob,
  createApp,
  createInitialState,
  createJobFromGeneration,
  loadState,
  normalizeState,
  prettyJson,
  validatePrompt,
} from "../src/app.js";
import { generatePromptInterpretation } from "../backend/generator.js";

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function mountDom() {
  document.body.innerHTML = `
    <main>
      <form id="job-form">
        <textarea id="prompt"></textarea>
        <input id="referenceImage" type="file" />
        <input id="referenceCaption" type="text" />
        <select id="stylePreset"><option value="product">Product</option><option value="stylized">Stylized</option></select>
        <select id="topology"><option value="game-ready">Game ready</option><option value="cinematic">Cinematic</option></select>
        <select id="textureDetail"><option value="2k">2K</option><option value="4k">4K</option></select>
        <p id="form-feedback"></p>
        <button id="submit-job" type="submit">Queue</button>
      </form>
      <button id="clear-history" type="button">Clear</button>
      <button id="clear-preview" type="button">Clear preview</button>
      <button id="download-model" type="button">Download model</button>
      <div id="suggestions"></div>
      <ul id="job-list"></ul>
      <div id="empty-state"></div>
      <div id="pipeline-panel" class="hidden"></div>
      <h3 id="active-prompt"></h3>
      <strong id="active-progress"></strong>
      <div role="progressbar" aria-valuenow="0"><span id="progress-fill"></span></div>
      <div id="pipeline-stages"></div>
      <span id="active-job-badge"></span>
      <div id="preview-scene" data-mode="idle"></div>
      <span id="preview-mode"></span>
      <h3 id="preview-subject"></h3>
      <p id="preview-copy"></p>
      <span id="preview-shape"></span>
      <span id="preview-material"></span>
      <span id="preview-style"></span>
      <span id="preview-topology"></span>
      <span id="preview-stage-label"></span>
      <h3 id="debug-subject"></h3>
      <p id="debug-modifiers"></p>
      <pre id="debug-json"></pre>
      <pre id="debug-quality"></pre>
      <pre id="debug-script"></pre>
    </main>
  `;
}

describe("app state helpers", () => {
  it("creates the default single-user state", () => {
    expect(createInitialState()).toEqual({
      form: {
        prompt: "",
        referenceCaption: "",
        stylePreset: "product",
        topology: "game-ready",
        textureDetail: "2k",
      },
      jobs: [],
      activeJobId: null,
      draftJob: null,
      previewJob: null,
      lastMessage: "Ready for a new prompt.",
    });
  });

  it("accepts concise prompts but rejects empty noise", () => {
    expect(validatePrompt("")).toContain("Enter a prompt");
    expect(validatePrompt("??")).toContain("at least 3 characters");
    expect(validatePrompt("...word")).toBe("");
    expect(validatePrompt("apple")).toBe("");
    expect(validatePrompt("A grounded bronze kettle with woven handle")).toBe(
      "",
    );
  });

  it("advances jobs through every pipeline stage", () => {
    let job = createJobFromGeneration(
      {
        prompt: "A grounded bronze kettle with woven handle",
        stylePreset: "product",
        topology: "game-ready",
        textureDetail: "2k",
      },
      generatePromptInterpretation({
        prompt: "A grounded bronze kettle with woven handle",
        stylePreset: "product",
        topology: "game-ready",
        textureDetail: "2k",
      }),
    );

    const visited = [job.stage];
    for (let index = 0; index < STAGES.length; index += 1) {
      job = advanceJob(job);
      visited.push(job.stage);
    }

    expect(visited).toEqual([
      "queued",
      "input",
      "reconstruction",
      "texturing",
      "export",
      "complete",
      "complete",
    ]);
  });

  it("falls back to a safe state when persisted data is invalid", () => {
    expect(
      normalizeState({ jobs: [{ id: "x", stage: "bad-stage" }] }).jobs[0].stage,
    ).toBe("queued");
  });

  it("returns the default state when storage cannot be parsed", () => {
    const storage = {
      getItem: () => "{not-json}",
    };

    expect(loadState(storage)).toEqual(createInitialState());
  });

  it("interprets prompts into structured 3D generation output", () => {
    const result = generatePromptInterpretation({
      prompt: "A frosted glass sphere with studio light",
      stylePreset: "product",
      topology: "game-ready",
      textureDetail: "2k",
    });

    expect(result.interpretation.shape).toBe("sphere");
    expect(result.interpretation.material).toBe("glass");
    expect(result.preview.shape).toBe("sphere");
    expect(result.promptPackage).toContain("Delivery goal:");
    expect(result.delivery.fileName).toMatch(/\.json$/);
    expect(result.blenderScript).toContain("primitive_uv_sphere_add");
    expect(result.provenance.processing.inputMode).toBe("prompt-only");
    expect(result.qualityReport.pass).toBe(true);
    expect(result.export.ready).toBe(true);
  });

  it("includes reference-image provenance metadata in output packages", () => {
    const result = generatePromptInterpretation({
      prompt: "A frosted glass sphere with studio light",
      stylePreset: "product",
      topology: "game-ready",
      textureDetail: "2k",
      referenceImage: {
        fileName: "sphere.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 2048,
        width: 1024,
        height: 1024,
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
    });

    expect(result.input.referenceImage?.fileName).toBe("sphere.jpg");
    expect(result.provenance.referenceImage?.sha256).toBe("a".repeat(64));
    expect(result.provenance.processing.inputMode).toBe(
      "prompt-plus-reference-metadata",
    );
    expect(result.delivery.content).toContain('"provenance"');
    expect(result.reconstruction?.method).toBe("silhouette-extrusion-v1");
    expect(result.reconstruction?.mesh?.format).toBe("obj");
    expect(result.reconstruction?.mesh?.content).toContain(
      "o mushyai_reconstructed",
    );
    expect(result.delivery.content).toContain('"reconstruction"');
    expect(result.qualityReport.metrics.overall).toBeGreaterThan(0);
    expect(result.delivery.content).toContain('"qualityReport"');
  });

  it("treats apples as organic spherical subjects", () => {
    const result = generatePromptInterpretation({
      prompt: "shape of an apple",
      stylePreset: "product",
      topology: "game-ready",
      textureDetail: "2k",
    });

    expect(result.interpretation.shape).toBe("sphere");
    expect(result.interpretation.material).toBe("organic");
    expect(result.summary).toContain("apple");
  });

  it("keeps hard-surface props out of the cube fallback when shape cues exist", () => {
    const result = generatePromptInterpretation({
      prompt: "A brushed aluminum bottle with studio light",
      stylePreset: "product",
      topology: "game-ready",
      textureDetail: "2k",
    });

    expect(result.interpretation.shape).toBe("cylinder");
    expect(result.interpretation.material).toBe("metal");
    expect(result.interpretation.confidence.shape).toBeGreaterThan(0);
  });

  it("formats debug JSON for display", () => {
    expect(prettyJson({ shape: "cube" })).toContain('"shape": "cube"');
  });
});

describe("app DOM behavior", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mountDom();
  });

  it("queues a job from the form and renders it", async () => {
    const storage = createStorage();
    const app = createApp({
      document,
      storage,
      clock: () => new Date("2026-03-01T10:00:00.000Z"),
      apiClient: vi.fn().mockResolvedValue(
        generatePromptInterpretation({
          prompt:
            "A lacquered tea tin with embossed cranes and brushed brass lid",
          stylePreset: "stylized",
          topology: "game-ready",
          textureDetail: "2k",
        }),
      ),
    });

    document.querySelector("#prompt").value =
      "A lacquered tea tin with embossed cranes and brushed brass lid";
    document.querySelector("#stylePreset").value = "stylized";
    document
      .querySelector("#job-form")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();

    expect(app.getState().jobs).toHaveLength(1);
    expect(document.querySelector("#job-list").textContent).toContain(
      "lacquered tea tin",
    );
    expect(document.querySelector("#active-job-badge").textContent).toBe(
      "Queued",
    );
    expect(document.querySelector("#preview-subject").textContent).toContain(
      "lacquered tea tin",
    );
    expect(document.querySelector("#preview-shape").textContent).toBe(
      "Shape: cylinder",
    );
    expect(document.querySelector("#preview-material").textContent).toBe(
      "Material: metal",
    );
    expect(document.querySelector("#download-model").disabled).toBe(false);
    expect(document.querySelector("#debug-script").textContent).toContain(
      "primitive_cylinder_add",
    );
    expect(document.querySelector("#debug-quality").textContent).toContain(
      '"overall"',
    );
    app.destroy();
  });

  it("attaches validated reference image metadata to submit payload", async () => {
    const storage = createStorage();
    const apiClient = vi.fn().mockResolvedValue(
      generatePromptInterpretation({
        prompt:
          "A lacquered tea tin with embossed cranes and brushed brass lid",
        stylePreset: "stylized",
        topology: "game-ready",
        textureDetail: "2k",
      }),
    );

    const referenceImageBuilder = vi.fn().mockResolvedValue({
      fileName: "tin.png",
      mimeType: "image/png",
      sizeBytes: 1024,
      width: 512,
      height: 512,
      sha256: "b".repeat(64),
      caption: "front-left angle",
    });

    const app = createApp({
      document,
      storage,
      apiClient,
      referenceImageBuilder,
    });

    const fileInput = document.querySelector("#referenceImage");
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [{ name: "tin.png", size: 1024, type: "image/png" }],
    });
    document.querySelector("#referenceCaption").value = "front-left angle";
    document.querySelector("#prompt").value =
      "A lacquered tea tin with embossed cranes and brushed brass lid";
    document.querySelector("#stylePreset").value = "stylized";

    document
      .querySelector("#job-form")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();

    expect(referenceImageBuilder).toHaveBeenCalledTimes(1);
    expect(apiClient).toHaveBeenCalledWith(
      "/api/generate",
      expect.objectContaining({
        referenceImage: expect.objectContaining({
          fileName: "tin.png",
          sha256: "b".repeat(64),
        }),
      }),
    );
    app.destroy();
  });

  it("allows submit with reference image and no prompt", async () => {
    const storage = createStorage();
    const apiClient = vi.fn().mockResolvedValue(
      generatePromptInterpretation({
        prompt: "",
        stylePreset: "product",
        topology: "game-ready",
        textureDetail: "2k",
        referenceImage: {
          fileName: "shape.png",
          mimeType: "image/png",
          sizeBytes: 1024,
          width: 512,
          height: 512,
          sha256: "9".repeat(64),
          silhouette: {
            algorithm: "radial-mask-v1",
            points: [
              [0.5, 0.1],
              [0.7, 0.2],
              [0.9, 0.5],
              [0.7, 0.8],
              [0.5, 0.9],
              [0.3, 0.8],
              [0.1, 0.5],
              [0.3, 0.2],
            ],
          },
        },
      }),
    );
    const referenceImageBuilder = vi.fn().mockResolvedValue({
      fileName: "shape.png",
      mimeType: "image/png",
      sizeBytes: 1024,
      width: 512,
      height: 512,
      sha256: "9".repeat(64),
      silhouette: {
        algorithm: "radial-mask-v1",
        points: [
          [0.5, 0.1],
          [0.7, 0.2],
          [0.9, 0.5],
          [0.7, 0.8],
          [0.5, 0.9],
          [0.3, 0.8],
          [0.1, 0.5],
          [0.3, 0.2],
        ],
      },
    });

    const app = createApp({
      document,
      storage,
      apiClient,
      referenceImageBuilder,
    });

    const fileInput = document.querySelector("#referenceImage");
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [{ name: "shape.png", size: 1024, type: "image/png" }],
    });
    document.querySelector("#prompt").value = "";

    document
      .querySelector("#job-form")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(apiClient).toHaveBeenCalledWith(
      "/api/generate",
      expect.objectContaining({
        prompt: "",
        referenceImage: expect.objectContaining({ fileName: "shape.png" }),
      }),
    );
    expect(app.getState().jobs).toHaveLength(1);
    app.destroy();
  });

  it("blocks export when quality gates fail and shows remediation", async () => {
    const storage = createStorage();
    const lowQualityGeneration = generatePromptInterpretation({
      prompt: "thing",
      stylePreset: "product",
      topology: "game-ready",
      textureDetail: "2k",
      referenceImage: {
        fileName: "low.png",
        mimeType: "image/png",
        sizeBytes: 1024,
        width: 512,
        height: 512,
        sha256: "c".repeat(64),
        caption: "",
        silhouette: {
          algorithm: "radial-mask-v1",
          points: [
            [0.5, 0.2],
            [0.65, 0.28],
            [0.75, 0.45],
            [0.7, 0.62],
            [0.5, 0.72],
            [0.32, 0.62],
            [0.24, 0.45],
            [0.34, 0.28],
          ],
        },
      },
    });
    expect(lowQualityGeneration.export.ready).toBe(false);

    const app = createApp({
      document,
      storage,
      apiClient: vi.fn().mockResolvedValue(lowQualityGeneration),
    });

    document.querySelector("#prompt").value = "thing";
    document
      .querySelector("#job-form")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    vi.advanceTimersByTime(6500);

    expect(document.querySelector("#download-model").disabled).toBe(true);
    expect(document.querySelector("#form-feedback").textContent).toContain(
      "Export is blocked",
    );
    expect(document.querySelector("#preview-copy").textContent).toContain(
      "Export blocked",
    );
    app.destroy();
  });

  it("renders a live draft interpretation from prompt input before queueing", async () => {
    const storage = createStorage();
    const apiClient = vi.fn().mockResolvedValue(
      generatePromptInterpretation({
        prompt: "A frosted glass sphere with studio light",
        stylePreset: "product",
        topology: "game-ready",
        textureDetail: "2k",
      }),
    );
    const app = createApp({
      document,
      storage,
      apiClient,
    });

    document.querySelector("#prompt").value =
      "A frosted glass sphere with studio light";
    document
      .querySelector("#prompt")
      .dispatchEvent(new Event("input", { bubbles: true }));

    vi.advanceTimersByTime(250);
    await Promise.resolve();
    await Promise.resolve();

    expect(apiClient).toHaveBeenCalledTimes(1);
    expect(document.querySelector("#preview-mode").textContent).toBe(
      "Live preview",
    );
    expect(document.querySelector("#preview-subject").textContent).toContain(
      "frosted glass sphere",
    );
    expect(document.querySelector("#preview-shape").textContent).toBe(
      "Shape: sphere",
    );
    expect(document.querySelector("#preview-stage-label").textContent).toBe(
      "Stage: Draft interpretation",
    );
    expect(document.querySelector("#download-model").disabled).toBe(false);
    expect(document.querySelector("#debug-script").textContent).toContain(
      "primitive_uv_sphere_add",
    );

    app.destroy();
  });

  it("ignores stale draft responses and keeps the latest interpretation", async () => {
    const storage = createStorage();
    const apiClient = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setTimeout(
              () =>
                resolve(
                  generatePromptInterpretation({
                    prompt: "A cube",
                    stylePreset: "product",
                    topology: "game-ready",
                    textureDetail: "2k",
                  }),
                ),
              20,
            );
          }),
      )
      .mockResolvedValueOnce(
        generatePromptInterpretation({
          prompt: "A frosted glass sphere with studio light",
          stylePreset: "product",
          topology: "game-ready",
          textureDetail: "2k",
        }),
      );

    const app = createApp({
      document,
      storage,
      apiClient,
    });

    document.querySelector("#prompt").value = "A cube";
    document
      .querySelector("#prompt")
      .dispatchEvent(new Event("input", { bubbles: true }));

    vi.advanceTimersByTime(230);
    await Promise.resolve();

    document.querySelector("#prompt").value =
      "A frosted glass sphere with studio light";
    document
      .querySelector("#prompt")
      .dispatchEvent(new Event("input", { bubbles: true }));

    vi.advanceTimersByTime(230);
    await Promise.resolve();
    await Promise.resolve();
    vi.advanceTimersByTime(30);
    await Promise.resolve();

    expect(document.querySelector("#preview-subject").textContent).toContain(
      "frosted glass sphere",
    );
    expect(document.querySelector("#preview-shape").textContent).toBe(
      "Shape: sphere",
    );
    app.destroy();
  });

  it("automatically advances the active job over time", async () => {
    const storage = createStorage();
    const app = createApp({
      document,
      storage,
      clock: () => new Date("2026-03-01T10:00:00.000Z"),
      apiClient: vi.fn().mockResolvedValue(
        generatePromptInterpretation({
          prompt:
            "A museum-grade marble bust with delicate chipped edges and soft fill light",
          stylePreset: "product",
          topology: "game-ready",
          textureDetail: "2k",
        }),
      ),
    });

    document.querySelector("#prompt").value =
      "A museum-grade marble bust with delicate chipped edges and soft fill light";
    document
      .querySelector("#job-form")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();

    vi.advanceTimersByTime(2500);

    expect(app.getState().jobs[0].stage).toBe("reconstruction");
    expect(document.querySelector("#active-progress").textContent).toBe("48%");
    app.destroy();
  });

  it("clears completed jobs without removing active work", () => {
    const storage = createStorage();
    storage.setItem(
      "mushyai/private-control-room",
      JSON.stringify({
        jobs: [
          {
            id: "done",
            prompt: "done",
            summary: "done",
            stylePreset: "product",
            topology: "game-ready",
            textureDetail: "2k",
            stage: "complete",
            progress: 100,
            createdAt: "2026-03-01T10:00:00.000Z",
            updatedAt: "2026-03-01T10:00:00.000Z",
          },
          {
            id: "active",
            prompt: "active prompt with enough detail",
            summary: "active prompt with enough detail",
            stylePreset: "product",
            topology: "game-ready",
            textureDetail: "2k",
            stage: "texturing",
            progress: 76,
            createdAt: "2026-03-01T10:01:00.000Z",
            updatedAt: "2026-03-01T10:01:00.000Z",
          },
        ],
        activeJobId: "active",
      }),
    );

    const app = createApp({
      document,
      storage,
      clock: () => new Date("2026-03-01T10:02:00.000Z"),
      apiClient: vi.fn(),
    });

    document.querySelector("#clear-history").click();

    expect(app.getState().jobs).toHaveLength(1);
    expect(app.getState().jobs[0].id).toBe("active");
    app.destroy();
  });

  it("keeps a delivered preview pinned until cleared", async () => {
    const storage = createStorage();
    const app = createApp({
      document,
      storage,
      clock: () => new Date("2026-03-01T10:03:00.000Z"),
      apiClient: vi.fn().mockResolvedValue(
        generatePromptInterpretation({
          prompt:
            "A brushed brass lantern with cutout stars and warm rim light",
          stylePreset: "product",
          topology: "game-ready",
          textureDetail: "2k",
        }),
      ),
    });

    document.querySelector("#prompt").value =
      "A brushed brass lantern with cutout stars and warm rim light";
    document
      .querySelector("#job-form")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    vi.advanceTimersByTime(6500);

    expect(app.getState().previewJob?.stage).toBe("complete");
    expect(document.querySelector("#preview-mode").textContent).toBe(
      "Delivered",
    );
    expect(document.querySelector("#preview-stage-label").textContent).toBe(
      "Stage: Delivered model",
    );

    document.querySelector("#clear-history").click();
    expect(app.getState().jobs).toHaveLength(0);
    expect(document.querySelector("#preview-subject").textContent).toContain(
      "Product model:",
    );

    document.querySelector("#clear-preview").click();
    expect(app.getState().previewJob).toBeNull();
    expect(document.querySelector("#preview-mode").textContent).toBe("Idle");
    app.destroy();
  });
});
