import { STAGES, getStageIndex, stageLabel } from "../state.js";

export function renderPipeline(elements, activeJob) {
  elements.pipelineStages.innerHTML = "";

  STAGES.slice(1).forEach((stage) => {
    const stageElement = document.createElement("div");
    const activeIndex = activeJob ? getStageIndex(activeJob.stage) : -1;
    const stageIndex = getStageIndex(stage.key);
    let visualState = "idle";

    if (activeJob) {
      if (stageIndex < activeIndex) {
        visualState = "complete";
      } else if (stageIndex === activeIndex) {
        visualState = stage.key === "complete" ? "complete" : "active";
      }
    }

    stageElement.className = "stage";
    stageElement.dataset.state = visualState;
    stageElement.innerHTML = `<span>${stage.label}</span><strong>${stage.progress}%</strong>`;
    elements.pipelineStages.append(stageElement);
  });

  if (!activeJob) {
    elements.emptyState.classList.remove("hidden");
    elements.pipelinePanel.classList.add("hidden");
    elements.activeJobBadge.textContent = "No active job";
    return;
  }

  elements.emptyState.classList.add("hidden");
  elements.pipelinePanel.classList.remove("hidden");
  elements.activePrompt.textContent = activeJob.summary;
  elements.activeProgress.textContent = `${activeJob.progress}%`;
  elements.progressFill.style.width = `${activeJob.progress}%`;
  elements.progressBar.setAttribute(
    "aria-valuenow",
    String(activeJob.progress),
  );
  elements.activeJobBadge.textContent = stageLabel(activeJob.stage);
}
