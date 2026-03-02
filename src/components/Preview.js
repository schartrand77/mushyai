export function renderPreview(elements, preview) {
  elements.previewScene.dataset.mode = preview.mode;
  elements.previewScene.dataset.shape = preview.shape;
  elements.previewScene.dataset.material = preview.material;
  elements.previewScene.style.setProperty("--preview-a", preview.accentA);
  elements.previewScene.style.setProperty("--preview-b", preview.accentB);
  elements.previewScene.style.setProperty("--preview-c", preview.accentC);
  elements.previewMode.textContent =
    preview.mode === "idle"
      ? "Idle"
      : preview.mode === "delivered"
        ? "Delivered"
        : "Live preview";
  elements.previewSubject.textContent = preview.subject;
  elements.previewCopy.textContent = preview.copy;
  elements.previewShape.textContent = preview.shapeLabel;
  elements.previewMaterial.textContent = preview.materialLabel;
  elements.previewStyle.textContent = preview.style;
  elements.previewTopology.textContent = preview.topology;
  elements.previewStageLabel.textContent = preview.stage;
  elements.downloadModel.disabled = !preview.canDownload;
  elements.clearPreview.disabled = preview.mode === "idle";
}
