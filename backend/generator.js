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
  return scoreLabel(prompt, {
    cube: [
      { pattern: /\b(cube|box|dice|block|voxel)\b/, weight: 3 },
      { pattern: /\b(square|orthogonal|rectilinear|hard edge)\b/, weight: 1.3 },
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
      { pattern: /\b(cylinder|can|pillar|column|tin|bottle|tower|tube)\b/, weight: 2.8 },
      { pattern: /\b(lantern|kettle|teapot|vase|thermos|jar)\b/, weight: 2 },
    ],
    capsule: [
      { pattern: /\b(capsule|pill|vial|ampoule)\b/, weight: 3 },
      { pattern: /\b(rounded ends|pharmaceutical)\b/, weight: 1.2 },
    ],
    pyramid: [
      { pattern: /\b(pyramid|cone|spire)\b/, weight: 2.8 },
      { pattern: /\b(pointed top|triangular profile|tapered)\b/, weight: 1.4 },
    ],
    bust: [
      { pattern: /\b(bust|head|face|statue|portrait|sculpture)\b/, weight: 3 },
      { pattern: /\b(character|figure)\b/, weight: 1.2 },
    ],
  }, "cube");
}

function detectMaterial(prompt) {
  return scoreLabel(prompt, {
    glass: [
      { pattern: /\b(glass|crystal|transparent|translucent|frosted)\b/, weight: 3 },
    ],
    metal: [
      { pattern: /\b(bronze|brass|steel|metal|chrome|iron|gold|silver|aluminum)\b/, weight: 3 },
      { pattern: /\b(polished|brushed|machined)\b/, weight: 1.2 },
    ],
    wood: [{ pattern: /\b(wood|oak|walnut|timber|maple|mahogany)\b/, weight: 3 }],
    stone: [
      { pattern: /\b(marble|stone|granite|rock|ceramic|clay|porcelain)\b/, weight: 3 },
    ],
    organic: [
      { pattern: /\b(apple|orange|lemon|lime|peach|pear|plum|cherry|fruit|tomato|leaf|petal)\b/, weight: 2.8 },
      { pattern: /\b(organic|natural skin|flesh|produce)\b/, weight: 1.6 },
    ],
  }, "default");
}

function detectLighting(prompt) {
  return scoreLabel(prompt, {
    "Rim lit": [{ pattern: /\b(rim light|backlit|back light|edge light)\b/, weight: 3 }],
    "Studio soft light": [
      { pattern: /\b(studio|softbox|soft fill|soft light|product shot)\b/, weight: 3 },
    ],
    "Dramatic contrast": [
      { pattern: /\b(dramatic|moody|high contrast|deep shadow)\b/, weight: 3 },
    ],
    "Warm directional light": [
      { pattern: /\b(sunset|golden hour|warm light|late afternoon)\b/, weight: 3 },
    ],
  }, "Balanced key light").label;
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

function buildDeliveryPackage(summary, prompt, interpretation, blenderScript) {
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
    },
    interpretation,
    promptPackage: buildPromptPackage(cleanPrompt, interpretation),
    model: {
      version: MODEL_VERSION,
      classifier: "weighted-keyword-ensemble",
    },
    preview: {
      shape: interpretation.shape,
      material: interpretation.material,
      palette,
    },
    blenderScript,
    delivery: buildDeliveryPackage(
      summary,
      cleanPrompt,
      interpretation,
      blenderScript,
    ),
  };
}
