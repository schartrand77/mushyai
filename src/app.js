import { defaultApiClient } from "./api.js";
import { renderAppView } from "./components/AppView.js";
import { queryElements } from "./components/elements.js";
import { bindHistoryControls } from "./components/HistoryControls.js";
import {
  bindJobForm,
  bindPromptDraftInputs,
  readFormValues,
  resetForm,
} from "./components/JobForm.js";
import { renderSuggestions } from "./components/Suggestions.js";
import { buildPreviewModel } from "./models.js";
import { buildReferenceImageMetadata } from "./referenceImage.js";
import {
  advanceJob,
  createInitialState,
  createJobFromGeneration,
  formatDate,
  getStageIndex,
  loadState,
  normalizeState,
  prettyJson,
  reducer,
  saveState,
  sortJobs,
  stageLabel,
  STORAGE_KEY,
  STAGES,
  summarizePrompt,
  validatePrompt,
} from "./state.js";
import { getFavoriteKeywords } from "./suggestions.js";

export {
  advanceJob,
  buildPreviewModel,
  createInitialState,
  createJobFromGeneration,
  defaultApiClient,
  formatDate,
  getStageIndex,
  loadState,
  normalizeState,
  prettyJson,
  reducer,
  saveState,
  sortJobs,
  stageLabel,
  STORAGE_KEY,
  STAGES,
  summarizePrompt,
  validatePrompt,
};

export function createApp({
  document,
  storage = window.localStorage,
  clock = () => new Date(),
  apiClient = defaultApiClient,
  referenceImageBuilder = buildReferenceImageMetadata,
}) {
  const elements = queryElements(document);
  let state = loadState(storage);
  let timer = null;
  let draftTimer = null;
  let latestDraftRequestId = 0;
  let lastDownloadUrl = null;

  function getActiveJob() {
    return state.jobs.find((job) => job.id === state.activeJobId) ?? null;
  }

  function validateSubmission(values) {
    if (values.referenceImageFile) {
      return "";
    }

    return validatePrompt(values.prompt);
  }

  function render() {
    renderAppView(elements, state, getActiveJob(), dispatch);
    const keywords = getFavoriteKeywords(state.jobs);
    renderSuggestions(elements, keywords, dispatch);
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

  function dispatch(action) {
    state = reducer(state, action);
    saveState(state, storage);
    render();
    syncTimer();
  }

  function queueDraftGeneration() {
    const values = readFormValues(elements);
    const error = validatePrompt(values.prompt);

    dispatch({ type: "fieldChanged", name: "prompt", value: values.prompt });
    dispatch({
      type: "fieldChanged",
      name: "referenceCaption",
      value: values.referenceCaption,
    });
    dispatch({
      type: "fieldChanged",
      name: "stylePreset",
      value: values.stylePreset,
    });
    dispatch({
      type: "fieldChanged",
      name: "topology",
      value: values.topology,
    });
    dispatch({
      type: "fieldChanged",
      name: "textureDetail",
      value: values.textureDetail,
    });

    if (draftTimer) {
      clearTimeout(draftTimer);
    }

    if (error) {
      latestDraftRequestId += 1;
      dispatch({ type: "draftChanged", job: null });
      return;
    }

    const requestId = latestDraftRequestId + 1;
    latestDraftRequestId = requestId;

    draftTimer = setTimeout(async () => {
      try {
        const generation = await apiClient("/api/generate", {
          prompt: values.prompt,
          stylePreset: values.stylePreset,
          topology: values.topology,
          textureDetail: values.textureDetail,
        });

        if (requestId !== latestDraftRequestId) {
          return;
        }

        const draftJob = {
          id: "draft-preview",
          prompt: values.prompt.trim(),
          summary: generation.summary,
          stylePreset: values.stylePreset,
          topology: values.topology,
          textureDetail: values.textureDetail,
          stage: "draft",
          progress: 0,
          createdAt: clock().toISOString(),
          updatedAt: clock().toISOString(),
          isFavorite: false,
          result: generation,
        };
        dispatch({ type: "draftChanged", job: draftJob });
      } catch {
        if (requestId !== latestDraftRequestId) {
          return;
        }

        dispatch({ type: "draftChanged", job: null });
      }
    }, 220);
  }

  function downloadPreviewModel() {
    const activeJob = getActiveJob();
    const previewJob = activeJob ?? state.draftJob ?? state.previewJob;
    const delivery = previewJob?.result?.delivery;
    const exportGate = previewJob?.result?.export;

    if (!delivery?.content || exportGate?.ready === false) {
      if (exportGate?.ready === false) {
        const remediation = Array.isArray(
          previewJob?.result?.qualityReport?.remediation,
        )
          ? previewJob.result.qualityReport.remediation[0]
          : "";
        dispatch({
          type: "messageChanged",
          message: remediation
            ? `Export blocked by quality gates. ${remediation}`
            : "Export blocked by quality gates.",
        });
      }
      return;
    }

    if (lastDownloadUrl) {
      URL.revokeObjectURL(lastDownloadUrl);
    }

    const blob = new Blob([delivery.content], {
      type: delivery.mimeType ?? "application/json",
    });
    const url = URL.createObjectURL(blob);
    lastDownloadUrl = url;
    const link = document.createElement("a");
    link.href = url;
    link.download = delivery.fileName ?? "mushyai-model.json";
    link.click();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const values = readFormValues(elements);
    const error = validateSubmission(values);

    if (error) {
      dispatch({ type: "messageChanged", message: error });
      return;
    }

    elements.submit.disabled = true;
    let payload = null;

    try {
      payload = {
        prompt: values.prompt,
        stylePreset: values.stylePreset,
        topology: values.topology,
        textureDetail: values.textureDetail,
      };

      if (values.referenceImageFile) {
        payload.referenceImage = await referenceImageBuilder(
          values.referenceImageFile,
          values.referenceCaption,
        );
      }
    } catch (error) {
      dispatch({
        type: "messageChanged",
        message: error.message || "Reference image validation failed.",
      });
      elements.submit.disabled = false;
      return;
    }

    dispatch({
      type: "messageChanged",
      message: payload.referenceImage
        ? "Generating deterministic 3D spec with reference provenance..."
        : "Generating deterministic 3D spec...",
    });

    try {
      const generation = await apiClient("/api/generate", payload);
      const job = createJobFromGeneration(values, generation, clock());
      const blockedMessage =
        generation.export?.ready === false
          ? `Job queued, but export is blocked. ${generation.qualityReport?.remediation?.[0] ?? "Improve source image and retry."}`
          : "";
      dispatch({
        type: "jobQueued",
        job,
        message: blockedMessage
          ? blockedMessage
          : payload.referenceImage
            ? "Job queued. Reference metadata was attached for provenance."
            : "Job queued. Deterministic generator responded successfully.",
      });
      resetForm(elements);
    } catch (requestError) {
      dispatch({
        type: "messageChanged",
        message: requestError.message || "Generation request failed.",
      });
    } finally {
      elements.submit.disabled = false;
    }
  }

  const unbindJobForm = bindJobForm(elements, handleSubmit);
  const unbindDraftInputs = bindPromptDraftInputs(
    elements,
    queueDraftGeneration,
  );
  const unbindHistory = bindHistoryControls(
    elements,
    () => dispatch({ type: "clearCompleted" }),
    () => dispatch({ type: "previewCleared" }),
  );
  elements.downloadModel.addEventListener("click", downloadPreviewModel);

  render();
  syncTimer();

  return {
    getState: () => state,
    destroy: () => {
      if (timer) {
        clearInterval(timer);
      }
      if (draftTimer) {
        clearTimeout(draftTimer);
      }
      if (lastDownloadUrl) {
        URL.revokeObjectURL(lastDownloadUrl);
      }
      unbindJobForm();
      unbindDraftInputs();
      unbindHistory();
      elements.downloadModel.removeEventListener("click", downloadPreviewModel);
    },
  };
}
