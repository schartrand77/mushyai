export function renderDebug(elements, debug) {
  elements.debugSubject.textContent = debug.subject;
  elements.debugModifiers.textContent = debug.modifiers;
  elements.debugJson.textContent = debug.json;
  elements.debugQuality.textContent = debug.quality;
  elements.debugScript.textContent = debug.script;
}
