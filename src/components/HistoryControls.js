export function bindHistoryControls(elements, onClearCompleted) {
  elements.clearHistory.addEventListener("click", onClearCompleted);

  return () => {
    elements.clearHistory.removeEventListener("click", onClearCompleted);
  };
}
