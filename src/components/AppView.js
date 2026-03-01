import { buildDebugModel, buildPreviewModel } from "../models.js";
import { renderDebug } from "./Debug.js";
import { renderJobs } from "./JobList.js";
import { renderPipeline } from "./Pipeline.js";
import { renderPreview } from "./Preview.js";

export function renderAppView(elements, state, activeJob, dispatch) {
  renderPreview(elements, buildPreviewModel(activeJob));
  renderDebug(elements, buildDebugModel(activeJob));
  renderJobs(elements, state, dispatch);
  renderPipeline(elements, activeJob);
  elements.feedback.textContent = state.lastMessage;
}
