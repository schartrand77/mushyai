export function renderSuggestions(elements, keywords, dispatch) {
  if (!elements.suggestions) {
    return;
  }

  elements.suggestions.innerHTML = "";

  if (keywords.length === 0) {
    return;
  }

  const doc = elements.prompt?.ownerDocument ?? document;
  const title = doc.createElement("h3");
  title.textContent = "Suggestions";
  elements.suggestions.append(title);

  const list = doc.createElement("ul");
  list.className = "suggestion-list";

  keywords.forEach((keyword) => {
    const item = doc.createElement("li");
    const button = doc.createElement("button");
    button.textContent = keyword;
    button.className = "suggestion-button";
    button.addEventListener("click", () => {
      const currentPrompt = elements.prompt.value;
      const newPrompt = currentPrompt ? `${currentPrompt} ${keyword}` : keyword;
      dispatch({ type: "fieldChanged", name: "prompt", value: newPrompt });
      elements.prompt.focus();
    });
    item.append(button);
    list.append(item);
  });

  elements.suggestions.append(list);
}
