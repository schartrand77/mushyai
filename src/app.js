export const STORAGE_KEY = "mushyai/private-control-room";

export const STAGES = [
  { key: "queued", label: "Queued", progress: 5 },
  { key: "input", label: "Input cleanup", progress: 20 },
  { key: "reconstruction", label: "Mesh reconstruction", progress: 48 },
  { key: "texturing", label: "Texture baking", progress: 76 },
  { key: "export", label: "Export packaging", progress: 94 },
  { key: "complete", label: "Complete", progress: 100 },
];

const DEFAULT_FORM = {
  prompt: "",
  stylePreset: "product",
  topology: "game-ready",
  textureDetail: "2k",
};

export function createCalibrationJob(file, now = new Date()) {
  const fileName = file?.name ?? "square-reference";
  return {
    id: `job-${now.getTime()}`,
    prompt: `Perfect 3D cube calibration generated from ${fileName}.`,
    summary: `Perfect cube calibration - ${fileName}`,
    stylePreset: "calibration",
    topology: "game-ready",
    textureDetail: "2k",
    stage: "queued",
    progress: 5,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export function createInitialState() {
  return {
    form: { ...DEFAULT_FORM },
    jobs: [],
    activeJobId: null,
    lastMessage: "Ready for a new prompt.",
  };
}

export function validatePrompt(prompt) {
  const value = prompt.trim();

  if (!value) {
    return "Enter a prompt before queueing a job.";
  }

  if (value.length < 12) {
    return "Use at least 12 characters so the prompt is specific enough.";
  }

  return "";
}

export function summarizePrompt(prompt) {
  const clean = prompt.trim().replace(/\s+/g, " ");
  return clean.length > 72 ? `${clean.slice(0, 69)}...` : clean;
}

export function createJob(values, now = new Date()) {
  return {
    id: `job-${now.getTime()}`,
    prompt: values.prompt.trim(),
    summary: summarizePrompt(values.prompt),
    stylePreset: values.stylePreset,
    topology: values.topology,
    textureDetail: values.textureDetail,
    stage: "queued",
    progress: 5,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export function getStageIndex(stageKey) {
  return STAGES.findIndex((stage) => stage.key === stageKey);
}

export function advanceJob(job, now = new Date()) {
  const currentIndex = getStageIndex(job.stage);

  if (currentIndex === -1 || currentIndex >= STAGES.length - 1) {
    return { ...job, updatedAt: now.toISOString() };
  }

  const nextStage = STAGES[currentIndex + 1];
  return {
    ...job,
    stage: nextStage.key,
    progress: nextStage.progress,
    updatedAt: now.toISOString(),
  };
}

export function sortJobs(jobs) {
  return [...jobs].sort((left, right) => {
    if (left.stage === "complete" && right.stage !== "complete") {
      return 1;
    }

    if (left.stage !== "complete" && right.stage === "complete") {
      return -1;
    }

    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
}

export function reducer(state, action) {
  switch (action.type) {
    case "hydrate":
      return normalizeState(action.payload);
    case "fieldChanged":
      return {
        ...state,
        form: {
          ...state.form,
          [action.name]: action.value,
        },
      };
    case "jobQueued": {
      const nextJobs = sortJobs([action.job, ...state.jobs]);
      return {
        ...state,
        jobs: nextJobs,
        activeJobId: action.job.id,
        lastMessage: "Job queued. Pipeline started.",
      };
    }
    case "jobAdvanced": {
      const nextJobs = sortJobs(
        state.jobs.map((job) => (job.id === action.job.id ? action.job : job)),
      );
      const stillActive = action.job.stage === "complete" ? null : action.job.id;
      return {
        ...state,
        jobs: nextJobs,
        activeJobId: stillActive,
        lastMessage:
          action.job.stage === "complete"
            ? "Job complete. Asset is ready for export."
            : `Active stage: ${stageLabel(action.job.stage)}.`,
      };
    }
    case "clearCompleted":
      return {
        ...state,
        jobs: state.jobs.filter((job) => job.stage !== "complete"),
        lastMessage: "Completed jobs cleared.",
      };
    default:
      return state;
  }
}

export function stageLabel(stageKey) {
  return STAGES.find((stage) => stage.key === stageKey)?.label ?? stageKey;
}

export function formatDate(value) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function normalizeState(input) {
  const base = createInitialState();

  if (!input || typeof input !== "object") {
    return base;
  }

  const jobs = Array.isArray(input.jobs)
    ? input.jobs
        .filter((job) => job && typeof job === "object" && typeof job.id === "string")
        .map((job) => {
          const safeStage = getStageIndex(job.stage) === -1 ? "queued" : job.stage;
          const safeStageIndex = getStageIndex(safeStage);
          return {
            ...job,
            stage: safeStage,
            progress:
              typeof job.progress === "number"
                ? Math.max(0, Math.min(100, job.progress))
                : STAGES[safeStageIndex].progress,
          };
        })
    : [];

  return {
    ...base,
    ...input,
    form: {
      ...base.form,
      ...(input.form ?? {}),
    },
    jobs: sortJobs(jobs),
    activeJobId:
      typeof input.activeJobId === "string" &&
      jobs.some((job) => job.id === input.activeJobId && job.stage !== "complete")
        ? input.activeJobId
        : null,
    lastMessage:
      typeof input.lastMessage === "string" && input.lastMessage
        ? input.lastMessage
        : base.lastMessage,
  };
}

export function loadState(storage = window.localStorage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return raw ? normalizeState(JSON.parse(raw)) : createInitialState();
  } catch {
    return createInitialState();
  }
}

export function saveState(state, storage = window.localStorage) {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

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

export function createApp({
  document,
  storage = window.localStorage,
  clock = () => new Date(),
  inspectFile = inspectImageFile,
}) {
  const elements = {
    form: document.querySelector("#job-form"),
    prompt: document.querySelector("#prompt"),
    stylePreset: document.querySelector("#stylePreset"),
    topology: document.querySelector("#topology"),
    textureDetail: document.querySelector("#textureDetail"),
    calibrationImage: document.querySelector("#calibrationImage"),
    calibrationFeedback: document.querySelector("#calibration-feedback"),
    runCalibration: document.querySelector("#run-calibration"),
    feedback: document.querySelector("#form-feedback"),
    submit: document.querySelector("#submit-job"),
    clearHistory: document.querySelector("#clear-history"),
    jobList: document.querySelector("#job-list"),
    emptyState: document.querySelector("#empty-state"),
    pipelinePanel: document.querySelector("#pipeline-panel"),
    activePrompt: document.querySelector("#active-prompt"),
    activeProgress: document.querySelector("#active-progress"),
    progressFill: document.querySelector("#progress-fill"),
    progressBar: document.querySelector('[role="progressbar"]'),
    pipelineStages: document.querySelector("#pipeline-stages"),
    activeJobBadge: document.querySelector("#active-job-badge"),
  };

  let state = loadState(storage);
  let timer = null;

  function dispatch(action) {
    state = reducer(state, action);
    saveState(state, storage);
    render();
    syncTimer();
  }

  function getActiveJob() {
    return state.jobs.find((job) => job.id === state.activeJobId) ?? null;
  }

  function syncTimer() {
    const activeJob = getActiveJob();

    if (!activeJob && timer) {
      clearInterval(timer);
      timer = null;
      return;
    }

    if (activeJob && !timer) {
      timer = setInterval(() => {
        const current = getActiveJob();
        if (!current) {
          return;
        }

        dispatch({
          type: "jobAdvanced",
          job: advanceJob(current, clock()),
        });
      }, 1200);
    }
  }

  function renderPipeline(activeJob) {
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
  }

  function renderJobs() {
    elements.jobList.innerHTML = "";

    if (state.jobs.length === 0) {
      const empty = document.createElement("li");
      empty.className = "job-item";
      empty.innerHTML = "<p class='empty-state'>No jobs yet. Your private queue is empty.</p>";
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

  function render() {
    const activeJob = getActiveJob();
    elements.feedback.textContent = state.lastMessage;

    renderJobs();
    renderPipeline(activeJob);

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
    elements.progressBar.setAttribute("aria-valuenow", String(activeJob.progress));
    elements.activeJobBadge.textContent = stageLabel(activeJob.stage);
  }

  function handleSubmit(event) {
    event.preventDefault();
    const values = {
      prompt: elements.prompt.value,
      stylePreset: elements.stylePreset.value,
      topology: elements.topology.value,
      textureDetail: elements.textureDetail.value,
    };
    const error = validatePrompt(values.prompt);

    if (error) {
      state = {
        ...state,
        lastMessage: error,
      };
      render();
      return;
    }

    const job = createJob(values, clock());
    dispatch({ type: "jobQueued", job });
    elements.form.reset();
    elements.stylePreset.value = DEFAULT_FORM.stylePreset;
    elements.topology.value = DEFAULT_FORM.topology;
    elements.textureDetail.value = DEFAULT_FORM.textureDetail;
    elements.prompt.focus();
  }

  async function handleCalibration() {
    const file = elements.calibrationImage.files?.[0];

    try {
      const metadata = await inspectFile(file);
      const validationError = validateCalibrationImage(metadata);

      if (validationError) {
        elements.calibrationFeedback.textContent = validationError;
        return;
      }

      const job = createCalibrationJob(file, clock());
      dispatch({ type: "jobQueued", job });
      elements.calibrationFeedback.textContent = `Calibration queued from ${file.name}.`;
      elements.calibrationImage.value = "";
    } catch (error) {
      elements.calibrationFeedback.textContent = error.message;
    }
  }

  elements.form.addEventListener("submit", handleSubmit);
  elements.runCalibration.addEventListener("click", handleCalibration);
  elements.clearHistory.addEventListener("click", () => dispatch({ type: "clearCompleted" }));

  render();
  syncTimer();

  return {
    getState: () => state,
    destroy: () => {
      if (timer) {
        clearInterval(timer);
      }
      elements.form.removeEventListener("submit", handleSubmit);
      elements.runCalibration.removeEventListener("click", handleCalibration);
    },
  };
}
