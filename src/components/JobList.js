import { formatDate, stageLabel } from "../state.js";

export function renderJobs(elements, state) {
  elements.jobList.innerHTML = "";

  if (state.jobs.length === 0) {
    const empty = document.createElement("li");
    empty.className = "job-item";
    empty.innerHTML =
      "<p class='empty-state'>No jobs yet. Your private queue is empty.</p>";
    elements.jobList.append(empty);
    return;
  }

  state.jobs.forEach((job) => {
    const item = document.createElement("li");
    item.className = "job-item";
    item.innerHTML = `
      <div class="job-item-header">
        <div>
          <h3>${job.summary}</h3>
          <p class="job-config">${job.stylePreset} | ${job.topology} | ${job.textureDetail}</p>
        </div>
        <span class="job-status ${job.stage === "complete" ? "complete" : ""}">
          ${stageLabel(job.stage)}
        </span>
      </div>
      <p class="job-meta">Updated ${formatDate(job.updatedAt)} - ${job.progress}% complete</p>
    `;
    elements.jobList.append(item);
  });
}
