import { useEffect, useRef } from "react";

// Where the keyboard goes when what it was on goes away: a phase of the debate ends, a button that started an action
// is replaced by its result. The focus would fall to the page (WCAG 2.4.3); it goes to what appeared instead, and
// never leaves a control the person chose.

/**
 * Whether the focus may be moved for the person: it fell to the page (the control they used went away), or it is on a
 * heading the page itself focused. A field or a button they chose keeps it.
 */
export function focusIsFree(): boolean {
  const active = document.activeElement;
  if (!active || active === document.body || !active.isConnected) return true;
  return active.hasAttribute("data-focus-target") || (active.tagName === "H1" && active.getAttribute("tabindex") === "-1");
}

/** Focuses an element that is not a control (a heading, a message, a status line), without scrolling to it. */
export function focusTarget(element: HTMLElement) {
  if (!element.hasAttribute("tabindex")) element.tabIndex = -1;
  element.setAttribute("data-focus-target", "");
  element.focus({ preventScroll: true });
}

/**
 * When `key` changes (not on the first render), and the focus went away with what changed, puts it on what `target`
 * finds then: the heading of the card whose button was replaced, the status line of the work that started.
 */
export function useRefocus(key: unknown, target: () => HTMLElement | null) {
  const previous = useRef(key);
  const find = useRef(target);
  find.current = target;
  useEffect(() => {
    if (Object.is(previous.current, key)) return;
    previous.current = key;
    if (!focusIsFree()) return;
    const element = find.current();
    if (element) focusTarget(element);
  }, [key]);
}
