import type { KeyboardEvent } from "react";

/**
 * The keyboard of a form whose submission costs something or cannot be undone: Enter in a one-line field only
 * edits, and Ctrl+Enter (Cmd+Enter) sends from anywhere in the form, as in the interview. A textarea keeps Enter
 * for its new line, and a button keeps it for its click.
 */
export function sendOnlyOnShortcut(event: KeyboardEvent<HTMLFormElement>, busy = false) {
  if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
    if (!busy) event.currentTarget.requestSubmit();
    return;
  }
  const target = event.target;
  // Every kind of field submits a form on Enter in a browser, a checkbox included.
  if (target instanceof HTMLInputElement && !["button", "submit", "reset", "image"].includes(target.type)) {
    event.preventDefault();
  }
}

/**
 * Ctrl+Enter (Cmd+Enter) sends the form from anywhere in it, as in the interview; Enter keeps its usual meaning. For a
 * form whose Enter already does what the person expects (a step's "Next", a search), where a send is worth a shortcut
 * of its own. A textarea keeps Enter for its new line.
 */
export function sendOnShortcut(event: KeyboardEvent<HTMLFormElement>, busy = false) {
  if (event.key !== "Enter" || event.nativeEvent.isComposing || !(event.ctrlKey || event.metaKey)) return;
  event.preventDefault();
  if (!busy) event.currentTarget.requestSubmit();
}
