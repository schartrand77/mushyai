export function bindHistoryControls(
  elements,
  onClearCompleted,
  onClearPreview,
) {
  elements.clearHistory.addEventListener("click", onClearCompleted);
  elements.clearPreview.addEventListener("click", onClearPreview);

  return () => {
    elements.clearHistory.removeEventListener("click", onClearCompleted);
    elements.clearPreview.removeEventListener("click", onClearPreview);
  };
}
