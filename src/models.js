import { prettyJson, stageLabel } from "./state.js";

const EMPTY_DEBUG_SCRIPT = "# Blender Python script will appear here.";

function stringToPaletteSeed(input) {
  return [...String(input ?? "")].reduce(
    (total, character) => total + character.charCodeAt(0),
    0,
  );
}

export function titleCase(value) {
  return String(value ?? "")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((segment) => segment[0].toUpperCase() + segment.slice(1))
    .join(" ");
}

function emptyDebugModel() {
  return {
    subject: "No generation data yet",
    modifiers: "Awaiting prompt interpretation",
    json: "{}",
    quality: "No quality report yet.",
    script: EMPTY_DEBUG_SCRIPT,
  };
}

export function buildPreviewModel(job) {
  if (!job) {
    return {
      mode: "idle",
      shape: "cube",
      material: "default",
      subject: "Awaiting queue input",
      copy: "Queue a concept to generate a model package and light up the display wall.",
      shapeLabel: "No shape",
      materialLabel: "No material",
      style: "No style",
      topology: "No topology",
      stage: "No stage",
      canDownload: false,
      accentA: "#d8843d",
      accentB: "#4d6a7d",
      accentC: "#fff2d9",
    };
  }

  const interpretation = job.result?.interpretation ?? {};
  const preview = job.result?.preview ?? {};
  const seed = stringToPaletteSeed(job.summary);
  const warm = 28 + (seed % 30);
  const cool = 190 + (seed % 35);
  const deep = 20 + (seed % 12);
  const shape = preview.shape ?? interpretation.shape ?? "cube";
  const material = preview.material ?? interpretation.material ?? "default";
  const lighting = interpretation.lighting ?? "Balanced key light";
  const mode = job.stage === "complete" ? "delivered" : "concept";
  const exportReady = job.result?.export?.ready !== false;
  const blockedReason = job.result?.export?.blockedReason ?? "";
  const remediation = Array.isArray(job.result?.qualityReport?.remediation)
    ? job.result.qualityReport.remediation
    : [];
  const stage =
    job.stage === "draft"
      ? "Stage: Draft interpretation"
      : job.stage === "complete"
        ? "Stage: Delivered model"
        : `Stage: ${stageLabel(job.stage)}`;

  return {
    mode,
    shape,
    material,
    subject: job.summary,
    copy:
      job.stage === "complete"
        ? exportReady
          ? `${lighting}. Delivered model package is pinned here until you clear it.`
          : `${lighting}. Export blocked: ${blockedReason} ${remediation[0] ?? ""}`
        : `${lighting}. Preview geometry biased toward ${shape} form cues from the interpreted prompt.`,
    shapeLabel: `Shape: ${shape}`,
    materialLabel: `Material: ${material}`,
    style: `Style: ${titleCase(job.stylePreset)}`,
    topology: `Topology: ${titleCase(job.topology)}`,
    stage,
    canDownload: Boolean(job.result?.delivery?.content) && exportReady,
    accentA: preview.palette?.accentA ?? `hsl(${warm} 74% 58%)`,
    accentB: preview.palette?.accentB ?? `hsl(${cool} 30% 37%)`,
    accentC: preview.palette?.accentC ?? `hsl(${deep} 100% 92%)`,
  };
}

export function buildDebugModel(job) {
  if (!job?.result) {
    return emptyDebugModel();
  }

  const interpretation = job.result.interpretation ?? {};
  const modifiers = Array.isArray(interpretation.modifiers)
    ? interpretation.modifiers
    : [];

  return {
    subject: job.result.summary ?? job.summary,
    modifiers:
      modifiers.length > 0
        ? modifiers.map(titleCase).join(" | ")
        : "No modifiers detected",
    json: prettyJson(interpretation),
    quality: prettyJson(job.result.qualityReport ?? {}),
    script: job.result.blenderScript ?? EMPTY_DEBUG_SCRIPT,
  };
}
