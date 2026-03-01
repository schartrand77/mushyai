import { defaultApiClient } from "./api.js";
import { renderAppView } from "./components/AppView.js";
import { queryElements } from "./components/elements.js";
import { bindHistoryControls } from "./components/HistoryControls.js";
import {
  bindCalibration,
  bindJobForm,
  bindPromptDraftInputs,
  readFormValues,
  resetForm,
} from "./components/JobForm.js";
import { inspectImageFile, validateCalibrationImage } from "./media.js";
import { buildPreviewModel } from "./models.js";
import {
  advanceJob,
  createCalibrationJobFromGeneration,
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

export {
  advanceJob,
  buildPreviewModel,
  createCalibrationJobFromGeneration,
  createInitialState,
  createJobFromGeneration,
  defaultApiClient,
  formatDate,
  getStageIndex,
  inspectImageFile,
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
  validateCalibrationImage,
  validatePrompt,
};

export function createApp({
  document,
  storage = window.localStorage,
  clock = () => new Date(),
  inspectFile = inspectImageFile,
  apiClient = defaultApiClient,
}) {
  const elements = queryElements(document);
  let state = loadState(storage);
  let timer = null;
  let draftTimer = null;
  let draftRequestId = 0;
  let draftGeneration = null;
  let lastDraftSignature = "";

  function getActiveJob() {
    return state.jobs.find((job) => job.id === state.activeJobId) ?? null;
  }

  function getDraftJob() {
    if (!draftGeneration) {
      return null;
    }

    const values = readFormValues(elements);
    return {
      id: "draft-preview",
      prompt: values.prompt.trim(),
      summary: draftGeneration.summary,
      stylePreset: values.stylePreset,
      topology: values.topology,
      textureDetail: values.textureDetail,
      stage: "draft",
      result: draftGeneration,
    };
  }

  function render() {
    renderAppView(
      elements,
      {
        ...state,
        draftJob: getActiveJob() ? null : getDraftJob(),
      },
      getActiveJob(),
      dispatch,
    );
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

  function queueDraftInterpretation() {
    const values = readFormValues(elements);
    const error = validatePrompt(values.prompt);

    if (draftTimer) {
      clearTimeout(draftTimer);
      draftTimer = null;
    }

    if (error) {
      draftGeneration = null;
      lastDraftSignature = "";
      render();
      return;
    }

    const signature = JSON.stringify(values);
    if (signature === lastDraftSignature && draftGeneration) {
      return;
    }

    const requestId = ++draftRequestId;
    draftTimer = setTimeout(async () => {
      try {
        const generation = await apiClient("/api/generate", values);

        if (requestId !== draftRequestId) {
          return;
        }

        lastDraftSignature = signature;
        draftGeneration = generation;
        render();
      } catch {
        if (requestId !== draftRequestId) {
          return;
        }

        draftGeneration = null;
        render();
      }
    }, 250);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const values = readFormValues(elements);
    const error = validatePrompt(values.prompt);

    if (error) {
      dispatch({ type: "messageChanged", message: error });
      return;
    }

    elements.submit.disabled = true;
    dispatch({
      type: "messageChanged",
      message: "Generating deterministic 3D spec...",
    });

    try {
      const signature = JSON.stringify(values);
      const generation =
        draftGeneration && lastDraftSignature === signature
          ? draftGeneration
          : await apiClient("/api/generate", values);
      const job = createJobFromGeneration(values, generation, clock());
      draftGeneration = null;
      lastDraftSignature = "";
      dispatch({
        type: "jobQueued",
        job,
        message: "Job queued. Deterministic generator responded successfully.",
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

  async function handleCalibration() {
    const file = elements.calibrationImage.files?.[0];

    elements.runCalibration.disabled = true;
    elements.calibrationFeedback.textContent = "";

    try {
      const metadata = await inspectFile(file);
      const validationError = validateCalibrationImage(metadata);

      if (validationError) {
        elements.calibrationFeedback.textContent = validationError;
        return;
      }

      const generation = await apiClient("/api/calibrate", {
        fileName: file.name,
        width: metadata.width,
        height: metadata.height,
      });
      const job = createCalibrationJobFromGeneration(file, generation, clock());
      dispatch({
        type: "jobQueued",
        job,
        message: "Calibration queued. Perfect cube reference locked.",
      });
      elements.calibrationFeedback.textContent = `Calibration queued from ${file.name}.`;
      elements.calibrationImage.value = "";
    } catch (error) {
      elements.calibrationFeedback.textContent = error.message;
    } finally {
      elements.runCalibration.disabled = false;
    }
  }

  const unbindJobForm = bindJobForm(elements, handleSubmit);
  const unbindDraftInputs = bindPromptDraftInputs(
    elements,
    queueDraftInterpretation,
  );
  const unbindCalibration = bindCalibration(elements, handleCalibration);
  const unbindHistory = bindHistoryControls(elements, () =>
    dispatch({ type: "clearCompleted" }),
  );

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
      unbindJobForm();
      unbindDraftInputs();
      unbindCalibration();
      unbindHistory();
    },
  };
}
