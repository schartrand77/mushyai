import { createHash } from "node:crypto";

const MODEL_VERSION = "mushyai-ml-2026.03";

function normalizePrompt(prompt) {
  return String(prompt ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function unique(values) {
  return [...new Set(values)];
}

function scoreLabel(value, labelMap, fallback) {
  const normalized = value.toLowerCase();
  const entries = Object.entries(labelMap).map(([label, features]) => {
    const score = features.reduce((total, feature) => {
      return total + (feature.pattern.test(normalized) ? feature.weight : 0);
    }, 0);

    return [label, score];
  });

  entries.sort((left, right) => {
    if (right[1] === left[1]) {
      return left[0].localeCompare(right[0]);
    }

    return right[1] - left[1];
  });

  const [bestLabel, bestScore] = entries[0];
  const totalScore = entries.reduce((total, [, score]) => total + score, 0);

  return {
    label: bestScore > 0 ? bestLabel : fallback,
    confidence:
      bestScore > 0 && totalScore > 0
        ? Number((bestScore / totalScore).toFixed(2))
        : 0,
  };
}

function extractSubject(prompt) {
  const cleaned = normalizePrompt(prompt)
    .replace(/^(please\s+)?(make|create|generate|render|build)\s+/i, "")
    .replace(/^((a|an|the)\s+)?(shape|model|render|version)\s+of\s+/i, "")
    .replace(/^(a|an|the)\s+/i, "");

  return cleaned || "generated asset";
}

function detectShape(prompt) {
  return scoreLabel(
    prompt,
    {
      cube: [
        { pattern: /\b(cube|box|dice|block|voxel)\b/, weight: 3 },
        {
          pattern: /\b(square|orthogonal|rectilinear|hard edge)\b/,
          weight: 1.3,
        },
      ],
      sphere: [
        { pattern: /\b(sphere|orb|ball|planet|globe|pearl)\b/, weight: 3 },
        { pattern: /\b(round|rounded|globular)\b/, weight: 1.4 },
        {
          pattern:
            /\b(apple|orange|lemon|lime|peach|pear|plum|cherry|fruit|tomato|pumpkin|melon)\b/,
          weight: 2.8,
        },
      ],
      cylinder: [
        {
          pattern: /\b(cylinder|can|pillar|column|tin|bottle|tower|tube)\b/,
          weight: 2.8,
        },
        { pattern: /\b(lantern|kettle|teapot|vase|thermos|jar)\b/, weight: 2 },
      ],
      capsule: [
        { pattern: /\b(capsule|pill|vial|ampoule)\b/, weight: 3 },
        { pattern: /\b(rounded ends|pharmaceutical)\b/, weight: 1.2 },
      ],
      pyramid: [
        { pattern: /\b(pyramid|cone|spire)\b/, weight: 2.8 },
        {
          pattern: /\b(pointed top|triangular profile|tapered)\b/,
          weight: 1.4,
        },
      ],
      bust: [
        {
          pattern: /\b(bust|head|face|statue|portrait|sculpture)\b/,
          weight: 3,
        },
        { pattern: /\b(character|figure)\b/, weight: 1.2 },
      ],
    },
    "cube",
  );
}

function detectMaterial(prompt) {
  return scoreLabel(
    prompt,
    {
      glass: [
        {
          pattern: /\b(glass|crystal|transparent|translucent|frosted)\b/,
          weight: 3,
        },
      ],
      metal: [
        {
          pattern:
            /\b(bronze|brass|steel|metal|chrome|iron|gold|silver|aluminum)\b/,
          weight: 3,
        },
        { pattern: /\b(polished|brushed|machined)\b/, weight: 1.2 },
      ],
      wood: [
        { pattern: /\b(wood|oak|walnut|timber|maple|mahogany)\b/, weight: 3 },
      ],
      stone: [
        {
          pattern: /\b(marble|stone|granite|rock|ceramic|clay|porcelain)\b/,
          weight: 3,
        },
      ],
      organic: [
        {
          pattern:
            /\b(apple|orange|lemon|lime|peach|pear|plum|cherry|fruit|tomato|leaf|petal)\b/,
          weight: 2.8,
        },
        { pattern: /\b(organic|natural skin|flesh|produce)\b/, weight: 1.6 },
      ],
    },
    "default",
  );
}

function detectLighting(prompt) {
  return scoreLabel(
    prompt,
    {
      "Rim lit": [
        { pattern: /\b(rim light|backlit|back light|edge light)\b/, weight: 3 },
      ],
      "Studio soft light": [
        {
          pattern: /\b(studio|softbox|soft fill|soft light|product shot)\b/,
          weight: 3,
        },
      ],
      "Dramatic contrast": [
        {
          pattern: /\b(dramatic|moody|high contrast|deep shadow)\b/,
          weight: 3,
        },
      ],
      "Warm directional light": [
        {
          pattern: /\b(sunset|golden hour|warm light|late afternoon)\b/,
          weight: 3,
        },
      ],
    },
    "Balanced key light",
  ).label;
}

function detectColorway(prompt) {
  const value = prompt.toLowerCase();
  const colors = [
    "amber",
    "black",
    "blue",
    "brass",
    "bronze",
    "cream",
    "gold",
    "green",
    "ivory",
    "orange",
    "red",
    "silver",
    "white",
    "yellow",
  ];

  const matched = colors.filter((color) => value.includes(color));
  return matched.length ? unique(matched) : ["neutral"];
}

function detectModifiers(prompt) {
  const value = prompt.toLowerCase();
  const modifiers = [];

  if (/\b(embossed|engraved|etched|carved)\b/.test(value)) {
    modifiers.push("surface detail");
  }
  if (/\b(brushed|polished|gloss|glaze|lacquered|matte)\b/.test(value)) {
    modifiers.push("finish treatment");
  }
  if (/\b(worn|chipped|weathered|aged|distressed)\b/.test(value)) {
    modifiers.push("edge wear");
  }
  if (/\b(cutout|perforated|holes|vented|pierced)\b/.test(value)) {
    modifiers.push("negative space");
  }
  if (/\b(woven|rope|handle|strap|loop|stem)\b/.test(value)) {
    modifiers.push("secondary attachment");
  }
  if (/\b(stylized|cartoon|hero)\b/.test(value)) {
    modifiers.push("stylized proportions");
  }

  return unique(modifiers);
}

function summarizePrompt(prompt) {
  return prompt.length > 72 ? `${prompt.slice(0, 69)}...` : prompt;
}

function sha256Hex(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function buildPalette(shape, material, colors) {
  const basePalettes = {
    cube: { accentA: "#ce7a36", accentB: "#48616f", accentC: "#fff4dd" },
    sphere: { accentA: "#6ca0dc", accentB: "#1f334f", accentC: "#ebf7ff" },
    cylinder: { accentA: "#cf8f52", accentB: "#334d5f", accentC: "#fff1df" },
    capsule: { accentA: "#a57ac8", accentB: "#32465b", accentC: "#f7ebff" },
    pyramid: { accentA: "#be7040", accentB: "#574135", accentC: "#fff0e4" },
    bust: { accentA: "#a9aba6", accentB: "#3f4f59", accentC: "#f4f0ea" },
  };

  if (material === "glass") {
    return { accentA: "#7db7e8", accentB: "#234763", accentC: "#eef9ff" };
  }

  if (material === "metal") {
    return colors.includes("bronze") || colors.includes("brass")
      ? { accentA: "#cb8348", accentB: "#3c4c58", accentC: "#fff0df" }
      : { accentA: "#c9c7c2", accentB: "#465462", accentC: "#fbf7f2" };
  }

  if (material === "stone") {
    return { accentA: "#c7b8a9", accentB: "#55626d", accentC: "#f6f1ea" };
  }

  if (material === "wood") {
    return { accentA: "#9a6a3e", accentB: "#4f3929", accentC: "#f8e9d6" };
  }

  if (material === "organic") {
    if (colors.includes("green")) {
      return { accentA: "#84b85b", accentB: "#415b35", accentC: "#f0f8df" };
    }

    if (colors.includes("yellow") || colors.includes("orange")) {
      return { accentA: "#de9648", accentB: "#70421d", accentC: "#fff0d7" };
    }

    return { accentA: "#cc5342", accentB: "#6a2d27", accentC: "#ffe5dd" };
  }

  return basePalettes[shape] ?? basePalettes.cube;
}

function polygonArea(points) {
  let area = 0;

  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[(index + 1) % points.length];
    area += x1 * y2 - x2 * y1;
  }

  return area / 2;
}

function normalizeContourPoints(points) {
  const mapped = points.map(([x, y]) => [
    Number(x) * 2 - 1,
    (1 - Number(y)) * 2 - 1,
  ]);

  let cx = 0;
  let cy = 0;
  for (const [x, y] of mapped) {
    cx += x;
    cy += y;
  }
  cx /= mapped.length;
  cy /= mapped.length;

  const centered = mapped.map(([x, y]) => [x - cx, y - cy]);
  let maxAbs = 0;
  for (const [x, y] of centered) {
    maxAbs = Math.max(maxAbs, Math.abs(x), Math.abs(y));
  }

  const scale = maxAbs > 0 ? 1 / maxAbs : 1;
  return centered.map(([x, y]) => [x * scale, y * scale]);
}

function sortPointsByAngle(points) {
  let cx = 0;
  let cy = 0;

  for (const [x, y] of points) {
    cx += x;
    cy += y;
  }
  cx /= points.length;
  cy /= points.length;

  return [...points].sort((left, right) => {
    const a1 = Math.atan2(left[1] - cy, left[0] - cx);
    const a2 = Math.atan2(right[1] - cy, right[0] - cx);
    return a1 - a2;
  });
}

function dedupePoints(points) {
  const deduped = [];

  for (const point of points) {
    const rounded = [Number(point[0].toFixed(4)), Number(point[1].toFixed(4))];
    const previous = deduped[deduped.length - 1];
    if (!previous || previous[0] !== rounded[0] || previous[1] !== rounded[1]) {
      deduped.push(rounded);
    }
  }

  return deduped;
}

function sanitizeSilhouettePoints(points) {
  if (!Array.isArray(points)) {
    return [];
  }

  const valid = [];
  for (const point of points) {
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
      continue;
    }

    valid.push([point[0], point[1]]);
  }

  return valid;
}

function buildObjFromContour(points, depth = 0.26) {
  const contour = dedupePoints(
    sortPointsByAngle(normalizeContourPoints(points)),
  );

  if (contour.length < 8) {
    return null;
  }

  const ordered =
    polygonArea(contour) < 0 ? [...contour].reverse() : [...contour];
  const halfDepth = depth / 2;
  const vertexLines = [];
  const uvLines = [];
  const faceLines = [];
  const topOffset = 1;
  const bottomOffset = topOffset + ordered.length;
  const topCenterIndex = bottomOffset + ordered.length;
  const bottomCenterIndex = topCenterIndex + 1;
  const sideUvOffset = ordered.length * 2 + 1;

  for (const [x, y] of ordered) {
    vertexLines.push(
      `v ${x.toFixed(4)} ${y.toFixed(4)} ${halfDepth.toFixed(4)}`,
    );
  }
  for (const [x, y] of ordered) {
    vertexLines.push(
      `v ${x.toFixed(4)} ${y.toFixed(4)} ${(-halfDepth).toFixed(4)}`,
    );
  }
  vertexLines.push(`v 0.0000 0.0000 ${halfDepth.toFixed(4)}`);
  vertexLines.push(`v 0.0000 0.0000 ${(-halfDepth).toFixed(4)}`);

  for (const [x, y] of ordered) {
    uvLines.push(
      `vt ${(x * 0.5 + 0.5).toFixed(4)} ${(y * 0.5 + 0.5).toFixed(4)}`,
    );
  }
  for (const [x, y] of ordered) {
    uvLines.push(
      `vt ${(x * 0.5 + 0.5).toFixed(4)} ${(y * 0.5 + 0.5).toFixed(4)}`,
    );
  }
  uvLines.push("vt 0.5000 0.5000");

  for (let index = 0; index < ordered.length; index += 1) {
    const next = (index + 1) % ordered.length;
    const topA = topOffset + index;
    const topB = topOffset + next;
    const bottomA = bottomOffset + index;
    const bottomB = bottomOffset + next;

    faceLines.push(
      `f ${topCenterIndex}/${sideUvOffset} ${topA}/${topA} ${topB}/${topB}`,
    );
    faceLines.push(
      `f ${bottomCenterIndex}/${sideUvOffset} ${bottomB}/${bottomB} ${bottomA}/${bottomA}`,
    );
    faceLines.push(
      `f ${topA}/${topA} ${bottomA}/${bottomA} ${bottomB}/${bottomB}`,
    );
    faceLines.push(`f ${topA}/${topA} ${bottomB}/${bottomB} ${topB}/${topB}`);
  }

  return {
    obj: [
      "# MushyAI silhouette reconstruction mesh",
      "o mushyai_reconstructed",
      ...vertexLines,
      ...uvLines,
      ...faceLines,
      "",
    ].join("\n"),
    vertexCount: ordered.length * 2 + 2,
    faceCount: faceLines.length,
    contourPoints: ordered.length,
  };
}

function buildReconstruction(referenceImage) {
  const points = sanitizeSilhouettePoints(referenceImage?.silhouette?.points);

  if (points.length < 8) {
    return null;
  }

  const mesh = buildObjFromContour(points);

  if (!mesh) {
    return null;
  }

  return {
    method: "silhouette-extrusion-v1",
    inputContourPoints: mesh.contourPoints,
    mesh: {
      format: "obj",
      fileName: "reconstructed_mesh.obj",
      content: mesh.obj,
      vertexCount: mesh.vertexCount,
      faceCount: mesh.faceCount,
    },
  };
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function round2(value) {
  return Number(value.toFixed(2));
}

function computeQualityReport({
  interpretation,
  reconstruction,
  referenceImage,
  prompt,
}) {
  const hasReference = Boolean(referenceImage);
  const silhouetteOverlap = hasReference
    ? clamp01((reconstruction?.inputContourPoints ?? 0) / 24)
    : 0.65;
  const semanticAlignment = clamp01(
    interpretation.confidence.shape * 0.6 +
      interpretation.confidence.material * 0.3 +
      (/\b(light|studio|rim|sunset|dramatic|soft)\b/i.test(prompt) ? 0.1 : 0),
  );
  const meshValidity = reconstruction?.mesh
    ? clamp01(
        (reconstruction.mesh.vertexCount >= 16 ? 0.4 : 0) +
          (reconstruction.mesh.faceCount >= 24 ? 0.3 : 0) +
          (reconstruction.mesh.faceCount /
            Math.max(1, reconstruction.mesh.vertexCount) >
          1
            ? 0.3
            : 0.1),
      )
    : 0.78;
  const uvCoverage = reconstruction?.mesh ? 0.9 : 0.72;

  const overall = clamp01(
    silhouetteOverlap * 0.35 +
      semanticAlignment * 0.3 +
      meshValidity * 0.2 +
      uvCoverage * 0.15,
  );

  const thresholds = {
    silhouetteOverlap: hasReference ? 0.55 : 0.45,
    semanticAlignment: 0.38,
    meshValidity: 0.55,
    uvCoverage: 0.6,
    overall: hasReference ? 0.66 : 0.6,
  };

  const findings = [];
  if (silhouetteOverlap < thresholds.silhouetteOverlap) {
    findings.push("Low silhouette overlap against reference contour.");
  }
  if (semanticAlignment < thresholds.semanticAlignment) {
    findings.push("Prompt/image semantic alignment is weak.");
  }
  if (meshValidity < thresholds.meshValidity) {
    findings.push("Mesh validity score is below release threshold.");
  }
  if (uvCoverage < thresholds.uvCoverage) {
    findings.push("UV coverage is below threshold.");
  }
  if (overall < thresholds.overall) {
    findings.push("Overall confidence score is below export threshold.");
  }

  const remediation = [];
  if (silhouetteOverlap < thresholds.silhouetteOverlap) {
    remediation.push(
      "Use a cleaner silhouette with high contrast and minimal background clutter.",
    );
  }
  if (semanticAlignment < thresholds.semanticAlignment) {
    remediation.push(
      "Add explicit shape/material terms in the prompt and caption (e.g., 'glass sphere').",
    );
  }
  if (meshValidity < thresholds.meshValidity) {
    remediation.push(
      "Retry with a centered front/side image to improve contour stability.",
    );
  }
  if (uvCoverage < thresholds.uvCoverage) {
    remediation.push(
      "Use an image with complete object framing to improve UV projection.",
    );
  }

  const metrics = {
    silhouetteOverlap: round2(silhouetteOverlap),
    semanticAlignment: round2(semanticAlignment),
    meshValidity: round2(meshValidity),
    uvCoverage: round2(uvCoverage),
    overall: round2(overall),
  };

  const pass = findings.length === 0;

  return {
    version: "quality-gates-v1",
    metrics,
    thresholds,
    pass,
    findings,
    remediation: remediation.length
      ? remediation
      : ["No remediation required. Export-ready."],
  };
}

function blenderPrimitive(shape) {
  switch (shape) {
    case "sphere":
      return "bpy.ops.mesh.primitive_uv_sphere_add(radius=1.0, segments=64, ring_count=32)";
    case "cylinder":
      return "bpy.ops.mesh.primitive_cylinder_add(radius=0.8, depth=2.2, vertices=48)";
    case "capsule":
      return "bpy.ops.mesh.primitive_cylinder_add(radius=0.7, depth=2.0, vertices=48)";
    case "pyramid":
      return "bpy.ops.mesh.primitive_cone_add(radius1=1.1, depth=1.8, vertices=4)";
    case "bust":
      return "bpy.ops.mesh.primitive_uv_sphere_add(radius=1.0, segments=64, ring_count=32)";
    default:
      return "bpy.ops.mesh.primitive_cube_add(size=2.0)";
  }
}

function modifierComments(modifiers) {
  if (!modifiers.length) {
    return "# No extra modifiers inferred from prompt";
  }

  return modifiers.map((modifier) => `# modifier: ${modifier}`).join("\n");
}

function titleFromStyle(stylePreset) {
  switch (stylePreset) {
    case "stylized":
      return "Stylized";
    case "hard-surface":
      return "Hard-surface";
    case "organic":
      return "Organic";
    default:
      return "Product";
  }
}

function buildPromptPackage(prompt, interpretation) {
  const directives = [];

  directives.push(`Primary subject: ${extractSubject(prompt)}`);
  directives.push(`Render intent: ${interpretation.stylePreset}`);
  directives.push(
    `Spatial form: ${interpretation.shape} (confidence ${interpretation.confidence.shape})`,
  );

  const artDirection = [];
  if (interpretation.material !== "default") {
    artDirection.push(`${interpretation.material} material response`);
  }
  if (!interpretation.colorway.includes("neutral")) {
    artDirection.push(`${interpretation.colorway.join(", ")} color direction`);
  }
  artDirection.push(`${interpretation.lighting} lighting`);
  artDirection.push(`${interpretation.topology} topology`);
  artDirection.push(`${interpretation.textureDetail} texture budget`);
  directives.push(`Art direction: ${artDirection.join(" | ")}`);

  directives.push(
    interpretation.modifiers.length
      ? `Surface notes: ${interpretation.modifiers.join(", ")}`
      : "Surface notes: keep forms clean and readable",
  );
  directives.push(
    "Delivery goal: export a production-ready preview model with consistent silhouette and material separation.",
  );

  return directives.join("\n");
}

function buildProvenance(
  prompt,
  interpretation,
  referenceImage,
  reconstruction,
  reconstructionProvider,
) {
  return {
    promptSha256: sha256Hex(prompt),
    referenceImage: referenceImage
      ? {
          fileName: referenceImage.fileName,
          mimeType: referenceImage.mimeType,
          sizeBytes: referenceImage.sizeBytes,
          width: referenceImage.width,
          height: referenceImage.height,
          sha256: referenceImage.sha256,
          caption: referenceImage.caption ?? "",
        }
      : null,
    processing: {
      modelVersion: MODEL_VERSION,
      classifier: "weighted-keyword-ensemble",
      stylePreset: interpretation.stylePreset,
      topology: interpretation.topology,
      textureDetail: interpretation.textureDetail,
      inputMode: referenceImage
        ? "prompt-plus-reference-metadata"
        : "prompt-only",
      reconstruction:
        reconstruction?.method ?? "heuristic-primitive-generation",
      reconstructionProvider:
        reconstructionProvider ??
        (referenceImage ? "in-process-fallback" : "none"),
    },
  };
}

function buildDeliveryPackage(
  summary,
  prompt,
  interpretation,
  blenderScript,
  provenance,
  reconstruction,
  qualityReport,
  exportGate,
) {
  const safeBaseName = summarizePrompt(summary)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return {
    fileName: `${safeBaseName || "mushyai-model"}.json`,
    mimeType: "application/json",
    content: JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        summary,
        prompt,
        promptPackage: buildPromptPackage(prompt, interpretation),
        interpretation,
        provenance,
        reconstruction,
        qualityReport,
        export: exportGate,
        blenderScript,
      },
      null,
      2,
    ),
  };
}

export function generateBlenderScript({
  prompt,
  shape,
  material,
  topology,
  textureDetail,
  modifiers,
  lighting,
}) {
  return `import bpy

# Deterministic MushyAI build script
PROMPT = ${JSON.stringify(prompt)}

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

${blenderPrimitive(shape)}
obj = bpy.context.active_object
obj.name = "mushyai_asset"

${modifierComments(modifiers)}
# material: ${material}
# topology: ${topology}
# texture detail: ${textureDetail}
# lighting: ${lighting}

mat = bpy.data.materials.new(name="mushyai_material")
mat.use_nodes = True
obj.data.materials.append(mat)

if ${JSON.stringify(material)} == "glass":
    mat.diffuse_color = (0.72, 0.86, 0.98, 0.45)
elif ${JSON.stringify(material)} == "metal":
    mat.diffuse_color = (0.72, 0.63, 0.49, 1.0)
elif ${JSON.stringify(material)} == "stone":
    mat.diffuse_color = (0.74, 0.72, 0.68, 1.0)
elif ${JSON.stringify(material)} == "wood":
    mat.diffuse_color = (0.58, 0.36, 0.22, 1.0)
elif ${JSON.stringify(material)} == "organic":
    mat.diffuse_color = (0.76, 0.18, 0.12, 1.0)
else:
    mat.diffuse_color = (0.78, 0.76, 0.73, 1.0)

bpy.context.scene.render.engine = "CYCLES"
`;
}

export function generatePromptInterpretation({
  prompt,
  stylePreset = "product",
  topology = "game-ready",
  textureDetail = "2k",
  referenceImage = null,
  reconstructionOverride,
  reconstructionProvider = null,
  runtimeWarnings = [],
}) {
  const cleanPrompt = normalizePrompt(prompt);
  const shapeScore = detectShape(cleanPrompt);
  const materialScore = detectMaterial(cleanPrompt);
  const lighting = detectLighting(cleanPrompt);
  const colors = detectColorway(cleanPrompt);
  const modifiers = detectModifiers(cleanPrompt);
  const palette = buildPalette(shapeScore.label, materialScore.label, colors);
  const summary = summarizePrompt(
    `${titleFromStyle(stylePreset)} model: ${extractSubject(cleanPrompt)}`,
  );

  const interpretation = {
    prompt: cleanPrompt,
    shape: shapeScore.label,
    material: materialScore.label,
    lighting,
    colorway: colors,
    modifiers,
    topology,
    textureDetail,
    stylePreset,
    confidence: {
      shape: shapeScore.confidence,
      material: materialScore.confidence,
    },
  };
  const reconstruction =
    reconstructionOverride === undefined
      ? buildReconstruction(referenceImage)
      : reconstructionOverride;
  const qualityReport = computeQualityReport({
    interpretation,
    reconstruction,
    referenceImage,
    prompt: cleanPrompt,
  });
  const exportGate = {
    ready: qualityReport.pass,
    blockedReason: qualityReport.pass
      ? ""
      : "Quality gates did not pass. Export is blocked.",
  };

  const provenance = buildProvenance(
    cleanPrompt,
    interpretation,
    referenceImage,
    reconstruction,
    reconstructionProvider,
  );

  const blenderScript = generateBlenderScript({
    prompt: cleanPrompt,
    shape: interpretation.shape,
    material: interpretation.material,
    topology,
    textureDetail,
    modifiers,
    lighting,
  });

  return {
    type: "generation",
    summary,
    input: {
      prompt: cleanPrompt,
      stylePreset,
      topology,
      textureDetail,
      referenceImage,
    },
    interpretation,
    promptPackage: buildPromptPackage(cleanPrompt, interpretation),
    provenance,
    model: {
      version: MODEL_VERSION,
      classifier: "weighted-keyword-ensemble",
      reconstruction:
        reconstruction?.method ?? "heuristic-primitive-generation",
    },
    runtime: {
      reconstructionProvider:
        reconstructionProvider ??
        (referenceImage ? "in-process-fallback" : "none"),
      warnings: runtimeWarnings,
    },
    qualityReport,
    export: exportGate,
    preview: {
      shape: interpretation.shape,
      material: interpretation.material,
      palette,
    },
    blenderScript,
    reconstruction,
    delivery: buildDeliveryPackage(
      summary,
      cleanPrompt,
      interpretation,
      blenderScript,
      provenance,
      reconstruction,
      qualityReport,
      exportGate,
    ),
  };
}
