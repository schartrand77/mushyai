export function inspectImageFile(file, createObjectURL = URL.createObjectURL) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error("Select a reference image first."));
      return;
    }

    const objectUrl = createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("The selected file could not be read as an image."));
    };

    image.src = objectUrl;
  });
}

export function validateCalibrationImage(metadata) {
  if (!metadata || metadata.width <= 0 || metadata.height <= 0) {
    return "The selected image is invalid.";
  }

  if (metadata.width !== metadata.height) {
    return "Calibration requires a square image so the cube stays perfectly proportioned.";
  }

  return "";
}
