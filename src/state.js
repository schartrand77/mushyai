export const STORAGE_KEY = "mushyai/private-control-room";

export const STAGES = [
  { key: "queued", label: "Queued", progress: 5 },
  { key: "input", label: "Input cleanup", progress: 20 },
  { key: "reconstruction", label: "Mesh reconstruction", progress: 48 },
  { key: "texturing", label: "Texture baking", progress: 76 },
  { key: "export", label: "Export packaging", progress: 94 },
  { key: "complete", label: "Complete", progress: 100 },
];

export const DEFAULT_FORM = {
  prompt: "",
  referenceCaption: "",
  stylePreset: "product",
  topology: "game-ready",
  textureDetail: "2k",
};

export function createInitialState() {
  return {
    form: { ...DEFAULT_FORM },
    jobs: [],
    activeJobId: null,
    draftJob: null,
    previewJob: null,
    lastMessage: "Ready for a new prompt.",
  };
}

export function validatePrompt(prompt) {
  const value = prompt.trim().replace(/\s+/g, " ");

  if (!value) {
    return "Enter a prompt before queueing a job.";
  }

  if (value.length < 3) {
    return "Use at least 3 characters so the prompt has a clear subject.";
  }

  if (!/[a-z0-9]{3}/i.test(value)) {
    return "Use a prompt with recognizable words or object names.";
  }

  return "";
}

export function summarizePrompt(prompt) {
  const clean = prompt.trim().replace(/\s+/g, " ");
  return clean.length > 72 ? `${clean.slice(0, 69)}...` : clean;
}

export function prettyJson(value) {
  return JSON.stringify(value ?? {}, null, 2);
}

function sanitizeSummary(summary, fallbackPrompt) {
  if (typeof summary === "string" && summary.trim()) {
    return summary.trim();
  }

  return summarizePrompt(fallbackPrompt);
}

export function createJobFromGeneration(values, generation, now = new Date()) {
  return {
    id: `job-${now.getTime()}`,
    prompt: values.prompt.trim(),
    summary: sanitizeSummary(generation?.summary, values.prompt),
    stylePreset: values.stylePreset,
    topology: values.topology,
    textureDetail: values.textureDetail,
    stage: "queued",
    progress: STAGES[0].progress,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    isFavorite: false,
    result: generation ?? null,
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

    return (
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    );
  });
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

function normalizeJob(job) {
  const safeStage = getStageIndex(job.stage) === -1 ? "queued" : job.stage;
  const safeStageIndex = getStageIndex(safeStage);

  return {
    ...job,
    stage: safeStage,
    progress:
      typeof job.progress === "number"
        ? Math.max(0, Math.min(100, job.progress))
        : STAGES[safeStageIndex].progress,
    isFavorite: job.isFavorite ?? false,
    result: job.result && typeof job.result === "object" ? job.result : null,
  };
}

function normalizePreviewJob(job) {
  if (!job || typeof job !== "object" || typeof job.id !== "string") {
    return null;
  }

  return normalizeJob(job);
}

export function normalizeState(input) {
  const base = createInitialState();

  if (!input || typeof input !== "object") {
    return base;
  }

  const jobs = Array.isArray(input.jobs)
    ? input.jobs
        .filter(
          (job) => job && typeof job === "object" && typeof job.id === "string",
        )
        .map(normalizeJob)
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
      jobs.some(
        (job) => job.id === input.activeJobId && job.stage !== "complete",
      )
        ? input.activeJobId
        : null,
    draftJob: normalizePreviewJob(input.draftJob),
    previewJob: normalizePreviewJob(input.previewJob),
    lastMessage:
      typeof input.lastMessage === "string" && input.lastMessage
        ? input.lastMessage
        : base.lastMessage,
  };
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
    case "draftChanged":
      return {
        ...state,
        draftJob: action.job ?? null,
      };
    case "jobQueued": {
      const nextJobs = sortJobs([action.job, ...state.jobs]);
      return {
        ...state,
        jobs: nextJobs,
        activeJobId: action.job.id,
        draftJob: null,
        lastMessage: action.message ?? "Job queued. Pipeline started.",
      };
    }
    case "jobFavorited": {
      const nextJobs = state.jobs.map((job) =>
        job.id === action.jobId ? { ...job, isFavorite: !job.isFavorite } : job,
      );
      return {
        ...state,
        jobs: nextJobs,
      };
    }
    case "jobAdvanced": {
      const nextJobs = sortJobs(
        state.jobs.map((job) =>
          job.id === action.job.id ? normalizeJob(action.job) : job,
        ),
      );
      const stillActive =
        action.job.stage === "complete" ? null : action.job.id;
      const blocked =
        action.job.stage === "complete" &&
        action.job.result?.export?.ready === false;
      const blockedReason =
        action.job.result?.export?.blockedReason ??
        "Quality gates did not pass. Export is blocked.";
      const remediation = Array.isArray(
        action.job.result?.qualityReport?.remediation,
      )
        ? action.job.result.qualityReport.remediation[0]
        : "";
      return {
        ...state,
        jobs: nextJobs,
        activeJobId: stillActive,
        previewJob:
          action.job.stage === "complete"
            ? normalizeJob(action.job)
            : state.previewJob,
        lastMessage:
          action.job.stage === "complete"
            ? blocked
              ? `${blockedReason}${remediation ? ` ${remediation}` : ""}`
              : "Job complete. Asset is ready for export."
            : `Active stage: ${stageLabel(action.job.stage)}.`,
      };
    }
    case "messageChanged":
      return {
        ...state,
        lastMessage: action.message,
      };
    case "previewPinned":
      return {
        ...state,
        previewJob: action.job ? normalizeJob(action.job) : state.previewJob,
      };
    case "previewCleared":
      return {
        ...state,
        previewJob: null,
        lastMessage: "Preview cleared.",
      };
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
