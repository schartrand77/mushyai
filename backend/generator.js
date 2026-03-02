function normalizePrompt(prompt) {
  return String(prompt ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function extractSubject(prompt) {
  const cleaned = normalizePrompt(prompt)
    .replace(/^[Aa]n?\s+/, "")
    .replace(/^the\s+/i, "");

  return (
    cleaned
      .replace(/^(shape|model|render|version)\s+of\s+/i, "")
      .replace(/^(a|an|the)\s+/i, "") || "generated-asset"
  );
}

import { pipeline } from "@huggingface/transformers";

const MODEL_VERSION = "mushyai-ml-2026.03";

let extractor = null;

async function loadExtractor() {
  if (!extractor) {
    try {
      extractor = await pipeline(
        "feature-extraction",
        "Xenova/all-MiniLM-L6-v2",
      );
    } catch (error) {
      console.error("Error loading extractor:", error);
      // It's fine to fail silently, the old classifier will be used.
    }
  }
}

// Load the extractor on startup.
loadExtractor();

function cosineSimilarity(v1, v2) {
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (let i = 0; i < v1.length; i++) {
    dotProduct += v1[i] * v2[i];
    norm1 += v1[i] * v1[i];
    norm2 += v2[i] * v2[i];
  }

  if (norm1 === 0 || norm2 === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

async function detectShape(prompt) {
  const value = prompt.toLowerCase();
  const shapeFeatures = {
    cube: [
      { pattern: /(cube|box|square|dice)/, weight: 2.8 },
      { pattern: /(blocky|voxel|orthogonal)/, weight: 1.2 },
    ],
    sphere: [
      { pattern: /(sphere|orb|ball|planet)/, weight: 2.7 },
      { pattern: /(round|globular|pearl)/, weight: 1.3 },
      {
        pattern:
          /(apple|orange|lemon|lime|peach|pear|plum|cherry|fruit|tomato|pumpkin)/,
        weight: 2.5,
      },
    ],
    cylinder: [
      {
        pattern: /(cylinder|can|pillar|column|tin|bottle|lantern|tower)/,
        weight: 2.6,
      },
      { pattern: /(kettle|teapot|vase|thermos)/, weight: 1.4 },
    ],
    capsule: [
      { pattern: /(capsule|pill|vial)/, weight: 2.4 },
      { pattern: /(rounded ends|pharmaceutical)/, weight: 1.3 },
    ],
    pyramid: [
      { pattern: /(pyramid|cone|spire)/, weight: 2.5 },
      { pattern: /(triangular profile|pointed top)/, weight: 1.2 },
    ],
    bust: [
      { pattern: /(bust|head|statue|face)/, weight: 2.6 },
      { pattern: /(portrait|sculpture)/, weight: 1.2 },
    ],
  };

  if (!extractor) {
    return scoreLabel(value, shapeFeatures, "cube").label;
  }

  const shapeKeywords = {
    cube: "cube, box, square, dice, blocky, voxel, orthogonal",
    sphere:
      "sphere, orb, ball, planet, round, globular, pearl, apple, orange, lemon, lime, peach, pear, plum, cherry, fruit, tomato, pumpkin",
    cylinder:
      "cylinder, can, pillar, column, tin, bottle, lantern, tower, kettle, teapot, vase, thermos",
    capsule: "capsule, pill, vial, rounded ends, pharmaceutical",
    pyramid: "pyramid, cone, spire, triangular profile, pointed top",
    bust: "bust, head, statue, face, portrait, sculpture",
  };

  const promptEmbedding = await extractor(prompt, {
    pooling: "mean",
    normalize: true,
  });

  let bestShape = "cube";
  let bestSimilarity = -1;

  for (const shape in shapeKeywords) {
    const keywords = shapeKeywords[shape];
    const shapeEmbedding = await extractor(keywords, {
      pooling: "mean",
      normalize: true,
    });

    const similarity = cosineSimilarity(
      promptEmbedding.data,
      shapeEmbedding.data,
    );

    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestShape = shape;
    }
  }

  return bestShape;
}

function detectMaterial(prompt) {
  const value = prompt.toLowerCase();

  if (/(glass|crystal|transparent|frosted)/.test(value)) return "glass";
  if (/(bronze|brass|steel|metal|chrome|iron|gold|silver)/.test(value))
    return "metal";
  if (/(wood|oak|walnut|timber)/.test(value)) return "wood";
  if (/(marble|stone|granite|rock|ceramic|clay)/.test(value)) return "stone";
  if (/(apple|orange|lemon|lime|peach|pear|plum|cherry|fruit|tomato)/.test(value))
    return "organic";
  return "default";
}

function detectLighting(prompt) {
  const value = prompt.toLowerCase();

  if (/(rim light|backlit|back light)/.test(value)) return "Rim lit";
  if (/(studio|softbox|soft fill)/.test(value)) return "Studio soft light";
  if (/(dramatic|moody|shadow)/.test(value)) return "Dramatic contrast";
  if (/(sunset|golden hour|warm light)/.test(value))
    return "Warm directional light";
  return "Balanced key light";
}

function detectColorway(prompt) {
  const value = prompt.toLowerCase();
  const matches = [];
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
    "red",
    "silver",
    "white",
  ];

  colors.forEach((color) => {
    if (value.includes(color)) {
      matches.push(color);
    }
  });

  return matches.length > 0 ? matches : ["neutral"];
}

function detectModifiers(prompt) {
  const value = prompt.toLowerCase();
  const modifiers = [];

  if (/(embossed|engraved|etched)/.test(value))
    modifiers.push("surface detail");
  if (/(brushed|polished|gloss|glaze|lacquered)/.test(value))
    modifiers.push("finish treatment");
  if (/(worn|chipped|weathered)/.test(value)) modifiers.push("edge wear");
  if (/(cutout|perforated|holes)/.test(value)) modifiers.push("negative space");
  if (/(woven|rope|handle|strap)/.test(value))
    modifiers.push("secondary attachment");

  return modifiers;
}

function summarizePrompt(prompt) {
  return prompt.length > 72 ? `${prompt.slice(0, 69)}...` : prompt;
}

function buildPromptPackage(prompt, interpretation) {
  const tones = [];

  if (interpretation.material !== "default") {
    tones.push(`${interpretation.material} material response`);
  }

  if (interpretation.colorway.length > 0) {
    tones.push(`${interpretation.colorway.join(", ")} color direction`);
  }

  tones.push(`${interpretation.lighting} lighting`);
  tones.push(`${interpretation.topology} topology`);
  tones.push(`${interpretation.textureDetail} texture budget`);

  return [
    `Primary subject: ${extractSubject(prompt)}`,
    `Render intent: ${interpretation.stylePreset}`,
    `Spatial form: ${interpretation.shape}`,
    `Art direction: ${tones.join(" | ")}`,
    interpretation.modifiers.length
      ? `Surface notes: ${interpretation.modifiers.join(", ")}`
      : "Surface notes: keep forms clean and readable",
    "Delivery goal: export a production-ready preview model with consistent silhouette and material separation.",
  ].join("\n");
}

function buildDeliveryPackage(summary, prompt, interpretation, blenderScript) {
  const safeBaseName = summarizePrompt(summary)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const fileName = `${safeBaseName || "mushyai-model"}.json`;

  return {
    fileName,
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

function buildPalette(shape, material, colors) {
  const basePalettes = {
    cube: { accentA: "#ce7a36", accentB: "#48616f", accentC: "#fff4dd" },
    sphere: { accentA: "#6ca0dc", accentB: "#1f334f", accentC: "#ebf7ff" },
    cylinder: { accentA: "#cf8f52", accentB: "#334d5f", accentC: "#fff1df" },
    capsule: { accentA: "#a57ac8", accentB: "#32465b", accentC: "#f7ebff" },
    pyramid: { accentA: "#be7040", accentB: "#574135", accentC: "#fff0e4" },
    bust: { accentA: "#a9aba6", accentB: "#3f4f59", accentC: "#f4f0ea" },
  };

  const palette = basePalettes[shape] ?? basePalettes.cube;

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

  if (material === "organic") {
    return colors.includes("green")
      ? { accentA: "#84b85b", accentB: "#415b35", accentC: "#f0f8df" }
      : colors.includes("red")
        ? { accentA: "#cc5342", accentB: "#6a2d27", accentC: "#ffe5dd" }
        : { accentA: "#d86c4b", accentB: "#6b4030", accentC: "#fff0df" };
  }

  return palette;
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

export async function generatePromptInterpretation({
  prompt,
  stylePreset = "product",
  topology = "game-ready",
  textureDetail = "2k",
}) {
  const cleanPrompt = normalizePrompt(prompt);
  const shape = await detectShape(cleanPrompt);
  const material = detectMaterial(cleanPrompt);
  const lighting = detectLighting(cleanPrompt);
  const colors = detectColorway(cleanPrompt);
  const modifiers = detectModifiers(cleanPrompt);
  const palette = buildPalette(shape, material, colors);

  const interpretation = {
    prompt: cleanPrompt,
    shape,
    material,
    lighting,
    colorway: colors,
    modifiers,
    topology,
    textureDetail,
    stylePreset,
  };
  const promptPackage = buildPromptPackage(cleanPrompt, interpretation);
  const blenderScript = generateBlenderScript({
    prompt: cleanPrompt,
    shape,
    material,
    topology,
    textureDetail,
    modifiers,
    lighting,
  });
  const summary = summarizePrompt(
    `${titleFromStyle(stylePreset)} model: ${extractSubject(cleanPrompt)}`,
  );

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
    promptPackage,
    model: {
      version: MODEL_VERSION,
      classifier: extractor
        ? "sentence-embedding-similarity"
        : "weighted-keyword-ensemble",
    },
    preview: {
      shape,
      material,
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
