export const REFERENCE_IMAGE_ACCEPT = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
];

export const REFERENCE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const REFERENCE_IMAGE_MIN_DIMENSION = 128;
export const REFERENCE_IMAGE_MAX_DIMENSION = 4096;
const SILHOUETTE_SAMPLES = 64;
const SILHOUETTE_RENDER_SIZE = 192;

function parseSvgDimension(value) {
  if (!value) {
    return 0;
  }

  const match = String(value).match(/^\s*([0-9]+(?:\.[0-9]+)?)\s*(px)?\s*$/i);
  if (!match) {
    return 0;
  }

  return Math.round(Number(match[1]));
}

function getSvgViewBoxDimensions(svgText) {
  const viewBoxMatch = svgText.match(/\bviewBox\s*=\s*"([^"]+)"/i);
  if (!viewBoxMatch) {
    return { width: 0, height: 0 };
  }

  const values = viewBoxMatch[1]
    .trim()
    .split(/\s+/)
    .map((value) => Number(value));

  if (values.length !== 4 || values.some((value) => Number.isNaN(value))) {
    return { width: 0, height: 0 };
  }

  return {
    width: Math.round(Math.abs(values[2])),
    height: Math.round(Math.abs(values[3])),
  };
}

function loadRasterDimensions(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read image dimensions."));
    };

    image.src = objectUrl;
  });
}

function makeForegroundMask(imageData) {
  const { data, width, height } = imageData;
  const mask = new Uint8Array(width * height);
  let borderR = 0;
  let borderG = 0;
  let borderB = 0;
  let borderCount = 0;

  function addBorderPixel(index) {
    const alpha = data[index + 3];
    if (alpha < 8) {
      return;
    }
    borderR += data[index];
    borderG += data[index + 1];
    borderB += data[index + 2];
    borderCount += 1;
  }

  for (let x = 0; x < width; x += 1) {
    addBorderPixel((x * 4) >>> 0);
    addBorderPixel((((height - 1) * width + x) * 4) >>> 0);
  }
  for (let y = 0; y < height; y += 1) {
    addBorderPixel((y * width * 4) >>> 0);
    addBorderPixel(((y * width + (width - 1)) * 4) >>> 0);
  }

  const avgR = borderCount > 0 ? borderR / borderCount : 255;
  const avgG = borderCount > 0 ? borderG / borderCount : 255;
  const avgB = borderCount > 0 ? borderB / borderCount : 255;

  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    const alpha = data[offset + 3];

    if (alpha < 16) {
      mask[index] = 0;
      continue;
    }

    const dr = data[offset] - avgR;
    const dg = data[offset + 1] - avgG;
    const db = data[offset + 2] - avgB;
    const distance = Math.sqrt(dr * dr + dg * dg + db * db);
    mask[index] = distance > 28 || alpha < 240 ? 1 : 0;
  }

  return { mask, width, height };
}

function findMaskCenter(mask, width, height) {
  let sumX = 0;
  let sumY = 0;
  let total = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (mask[index] === 0) {
        continue;
      }
      sumX += x;
      sumY += y;
      total += 1;
    }
  }

  if (total === 0) {
    return null;
  }

  return {
    x: sumX / total,
    y: sumY / total,
    total,
  };
}

function dedupeContour(points) {
  const deduped = [];
  for (const point of points) {
    const previous = deduped[deduped.length - 1];
    if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) {
      deduped.push(point);
    }
  }
  return deduped;
}

function extractSilhouetteFromBitmap(image) {
  const scale = Math.min(
    1,
    SILHOUETTE_RENDER_SIZE / image.naturalWidth,
    SILHOUETTE_RENDER_SIZE / image.naturalHeight,
  );
  const width = Math.max(8, Math.round(image.naturalWidth * scale));
  const height = Math.max(8, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    return null;
  }

  context.drawImage(image, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  const foreground = makeForegroundMask(imageData);
  const center = findMaskCenter(foreground.mask, width, height);

  if (!center || center.total < 20) {
    return null;
  }

  const maxRadius = Math.hypot(width, height);
  const points = [];

  for (let sample = 0; sample < SILHOUETTE_SAMPLES; sample += 1) {
    const angle = (sample / SILHOUETTE_SAMPLES) * Math.PI * 2;
    let hit = null;

    for (let radius = 0; radius <= maxRadius; radius += 1) {
      const x = Math.round(center.x + Math.cos(angle) * radius);
      const y = Math.round(center.y + Math.sin(angle) * radius);

      if (x < 0 || y < 0 || x >= width || y >= height) {
        break;
      }

      const index = y * width + x;
      if (foreground.mask[index] === 1) {
        hit = [x, y];
      }
    }

    if (hit) {
      points.push([
        Number((hit[0] / width).toFixed(4)),
        Number((hit[1] / height).toFixed(4)),
      ]);
    }
  }

  const contour = dedupeContour(points);
  if (contour.length < 8) {
    return null;
  }

  return {
    algorithm: "radial-mask-v1",
    pointCount: contour.length,
    points: contour,
  };
}

async function loadImageForSilhouette(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not decode image for silhouette extraction."));
    };

    image.src = objectUrl;
  });
}

async function readImageDimensions(file, bytes) {
  if (file.type === "image/svg+xml") {
    const svgText = new TextDecoder().decode(bytes);
    const widthMatch = svgText.match(/\bwidth\s*=\s*"([^"]+)"/i);
    const heightMatch = svgText.match(/\bheight\s*=\s*"([^"]+)"/i);
    const parsedWidth = parseSvgDimension(widthMatch?.[1] ?? "");
    const parsedHeight = parseSvgDimension(heightMatch?.[1] ?? "");
    const viewBox = getSvgViewBoxDimensions(svgText);

    return {
      width: parsedWidth || viewBox.width,
      height: parsedHeight || viewBox.height,
    };
  }

  return loadRasterDimensions(file);
}

function toSha256Hex(buffer) {
  return crypto.subtle.digest("SHA-256", buffer).then((digest) =>
    Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(""),
  );
}

function cleanCaption(caption) {
  return String(caption ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 160);
}

export function validateReferenceImageFile(file) {
  if (!file) {
    return "";
  }

  if (!REFERENCE_IMAGE_ACCEPT.includes(file.type)) {
    return "Reference image must be PNG, JPEG, WEBP, or SVG.";
  }

  if (file.size <= 0) {
    return "Reference image is empty.";
  }

  if (file.size > REFERENCE_IMAGE_MAX_BYTES) {
    return "Reference image must be 8MB or smaller.";
  }

  return "";
}

export async function buildReferenceImageMetadata(file, caption = "") {
  if (!file) {
    return null;
  }

  const validationError = validateReferenceImageFile(file);
  if (validationError) {
    throw new Error(validationError);
  }

  const bytes = await file.arrayBuffer();
  const dimensions = await readImageDimensions(file, bytes);

  if (
    dimensions.width < REFERENCE_IMAGE_MIN_DIMENSION ||
    dimensions.height < REFERENCE_IMAGE_MIN_DIMENSION
  ) {
    throw new Error("Reference image must be at least 128x128 pixels.");
  }

  if (
    dimensions.width > REFERENCE_IMAGE_MAX_DIMENSION ||
    dimensions.height > REFERENCE_IMAGE_MAX_DIMENSION
  ) {
    throw new Error("Reference image must be at most 4096x4096 pixels.");
  }

  const image = await loadImageForSilhouette(file);
  const silhouette = extractSilhouetteFromBitmap(image);

  return {
    fileName: file.name ?? "reference-image",
    mimeType: file.type,
    sizeBytes: file.size,
    width: dimensions.width,
    height: dimensions.height,
    sha256: await toSha256Hex(bytes),
    caption: cleanCaption(caption),
    silhouette,
  };
}
