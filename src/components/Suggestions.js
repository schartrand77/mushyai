export function renderSuggestions(elements, keywords, dispatch) {
  elements.suggestions.innerHTML = "";

  if (keywords.length === 0) {
    return;
  }

  const title = document.createElement("h3");
  title.textContent = "Suggestions";
  elements.suggestions.append(title);

  const list = document.createElement("ul");
  list.className = "suggestion-list";

  keywords.forEach((keyword) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
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
