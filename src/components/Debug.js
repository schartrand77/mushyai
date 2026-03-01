export function renderDebug(elements, debug) {
  elements.debugSubject.textContent = debug.subject;
  elements.debugModifiers.textContent = debug.modifiers;
  elements.debugJson.textContent = debug.json;
  elements.debugScript.textContent = debug.script;
}
