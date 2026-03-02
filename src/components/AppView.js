import { buildDebugModel, buildPreviewModel } from "../models.js";
import { renderDebug } from "./Debug.js";
import { renderJobs } from "./JobList.js";
import { renderPipeline } from "./Pipeline.js";
import { renderPreview } from "./Preview.js";

export function renderAppView(elements, state, activeJob, dispatch) {
  const renderTarget = activeJob ?? state.draftJob ?? state.previewJob ?? null;
  renderPreview(elements, buildPreviewModel(renderTarget));
  renderDebug(elements, buildDebugModel(renderTarget));
  renderJobs(elements, state, dispatch);
  renderPipeline(elements, activeJob);
  elements.feedback.textContent = state.lastMessage;
}
