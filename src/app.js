import { defaultApiClient } from "./api.js";
import { renderAppView } from "./components/AppView.js";
import { queryElements } from "./components/elements.js";
import { bindHistoryControls } from "./components/HistoryControls.js";
import {
  bindCalibration,
  bindJobForm,
  readFormValues,
  resetForm,
} from "./components/JobForm.js";
import { renderSuggestions } from "./components/Suggestions.js";
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
import { getFavoriteKeywords } from "./suggestions.js";

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

  function getActiveJob() {
    return state.jobs.find((job) => job.id === state.activeJobId) ?? null;
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
      const generation = await apiClient("/api/generate", values);
      const job = createJobFromGeneration(values, generation, clock());
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
      unbindJobForm();
      unbindCalibration();
      unbindHistory();
    },
  };
}
