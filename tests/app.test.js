import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  STAGES,
  advanceJob,
  buildPreviewModel,
  createApp,
  createCalibrationJobFromGeneration,
  createInitialState,
  createJobFromGeneration,
  loadState,
  normalizeState,
  prettyJson,
  validateCalibrationImage,
  validatePrompt,
} from "../src/app.js";
import {
  generateCalibrationResult,
  generatePromptInterpretation,
} from "../backend/generator.js";

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
        <select id="stylePreset"><option value="product">Product</option><option value="stylized">Stylized</option></select>
        <select id="topology"><option value="game-ready">Game ready</option><option value="cinematic">Cinematic</option></select>
        <select id="textureDetail"><option value="2k">2K</option><option value="4k">4K</option></select>
        <input id="calibrationImage" type="file" />
        <p id="calibration-feedback"></p>
        <button id="run-calibration" type="button">Calibrate cube</button>
        <p id="form-feedback"></p>
        <button id="submit-job" type="submit">Queue</button>
      </form>
      <button id="clear-history" type="button">Clear</button>
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
      <pre id="debug-script"></pre>
    </main>
  `;
}

describe("app state helpers", () => {
  it("creates the default single-user state", () => {
    expect(createInitialState()).toEqual({
      form: {
        prompt: "",
        stylePreset: "product",
        topology: "game-ready",
        textureDetail: "2k",
      },
      jobs: [],
      activeJobId: null,
      lastMessage: "Ready for a new prompt.",
    });
  });

  it("rejects prompts that are too short", () => {
    expect(validatePrompt("tiny")).toContain("12 characters");
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

  it("accepts only square images for calibration", () => {
    expect(validateCalibrationImage({ width: 128, height: 128 })).toBe("");
    expect(validateCalibrationImage({ width: 128, height: 96 })).toContain(
      "square image",
    );
  });

  it("creates a perfect cube calibration job", () => {
    const job = createCalibrationJobFromGeneration(
      { name: "square.svg" },
      generateCalibrationResult({
        fileName: "square.svg",
        width: 128,
        height: 128,
      }),
      new Date("2026-03-01T10:00:00.000Z"),
    );

    expect(job.summary).toBe("Perfect cube calibration - square.svg");
    expect(job.prompt).toContain("Perfect 3D cube calibration");
    expect(job.stylePreset).toBe("calibration");
  });

  it("builds a calibration preview model", () => {
    const model = buildPreviewModel(
      createCalibrationJobFromGeneration(
        { name: "square.svg" },
        generateCalibrationResult({
          fileName: "square.svg",
          width: 128,
          height: 128,
        }),
        new Date("2026-03-01T10:00:00.000Z"),
      ),
    );

    expect(model.mode).toBe("calibration");
    expect(model.subject).toContain("square.svg");
    expect(model.stage).toContain("Queued");
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
    expect(result.blenderScript).toContain("primitive_uv_sphere_add");
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
    expect(document.querySelector("#debug-script").textContent).toContain(
      "primitive_cylinder_add",
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

  it("queues a perfect cube calibration from a square image", async () => {
    const storage = createStorage();
    const app = createApp({
      document,
      storage,
      clock: () => new Date("2026-03-01T10:03:00.000Z"),
      inspectFile: vi.fn().mockResolvedValue({ width: 64, height: 64 }),
      apiClient: vi.fn().mockResolvedValue(
        generateCalibrationResult({
          fileName: "square.svg",
          width: 64,
          height: 64,
        }),
      ),
    });

    Object.defineProperty(
      document.querySelector("#calibrationImage"),
      "files",
      {
        configurable: true,
        value: [
          new File(["<svg></svg>"], "square.svg", { type: "image/svg+xml" }),
        ],
      },
    );

    document.querySelector("#run-calibration").click();
    await Promise.resolve();
    await Promise.resolve();

    expect(app.getState().jobs).toHaveLength(1);
    expect(app.getState().jobs[0].summary).toBe(
      "Perfect cube calibration - square.svg",
    );
    expect(
      document.querySelector("#calibration-feedback").textContent,
    ).toContain("square.svg");
    expect(document.querySelector("#preview-mode").textContent).toBe(
      "Live preview",
    );
    expect(
      document.querySelector("#preview-stage-label").textContent,
    ).toContain("Queued");
    expect(document.querySelector("#debug-script").textContent).toContain(
      "primitive_cube_add",
    );
    app.destroy();
  });
});
