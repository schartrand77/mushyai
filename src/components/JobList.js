import { formatDate, stageLabel } from "../state.js";

export function renderJobs(elements, state, dispatch) {
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
    if (job.isFavorite) {
      item.classList.add("is-favorite");
    }

    const starButton = document.createElement("button");
    starButton.className = "favorite-button";
    starButton.innerHTML = `
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    `;
    starButton.addEventListener("click", () => {
      dispatch({ type: "jobFavorited", jobId: job.id });
    });

    const header = document.createElement("div");
    header.className = "job-item-header";
    header.innerHTML = `
      <div>
        <h3>${job.summary}</h3>
        <p class="job-config">${job.stylePreset} | ${job.topology} | ${
          job.textureDetail
        }</p>
      </div>
      <span class="job-status ${job.stage === "complete" ? "complete" : ""}">
        ${stageLabel(job.stage)}
      </span>
    `;
    header.prepend(starButton);

    const meta = document.createElement("p");
    meta.className = "job-meta";
    meta.textContent = `Updated ${formatDate(job.updatedAt)} - ${
      job.progress
    }% complete`;

    item.append(header);
    item.append(meta);
    elements.jobList.append(item);
  });
}
