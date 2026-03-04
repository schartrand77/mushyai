import { DEFAULT_FORM } from "../state.js";

export function readFormValues(elements) {
  return {
    prompt: elements.prompt.value,
    referenceImageFile: elements.referenceImage.files?.[0] ?? null,
    referenceCaption: elements.referenceCaption.value,
    stylePreset: elements.stylePreset.value,
    topology: elements.topology.value,
    textureDetail: elements.textureDetail.value,
  };
}

export function resetForm(elements) {
  elements.form.reset();
  elements.stylePreset.value = DEFAULT_FORM.stylePreset;
  elements.topology.value = DEFAULT_FORM.topology;
  elements.textureDetail.value = DEFAULT_FORM.textureDetail;
  elements.referenceCaption.value = DEFAULT_FORM.referenceCaption;
  elements.prompt.focus();
}

export function bindJobForm(elements, onSubmit) {
  elements.form.addEventListener("submit", onSubmit);

  return () => {
    elements.form.removeEventListener("submit", onSubmit);
  };
}

export function bindPromptDraftInputs(elements, onInput) {
  const controls = [
    elements.prompt,
    elements.referenceImage,
    elements.referenceCaption,
    elements.stylePreset,
    elements.topology,
    elements.textureDetail,
  ];

  controls.forEach((control) => {
    control.addEventListener("input", onInput);
    control.addEventListener("change", onInput);
  });

  return () => {
    controls.forEach((control) => {
      control.removeEventListener("input", onInput);
      control.removeEventListener("change", onInput);
    });
  };
}
