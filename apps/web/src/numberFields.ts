/**
 * Number fields take amounts and counts, not exponents: "12e3" (and a sign typed by mistake) is refused where it is
 * typed or pasted. The mouse wheel over a focused field scrolls the page instead of changing the value: the field is
 * read-only for the wheel's turn, which is when the browser decides whether to change the value. The field keeps the
 * focus and the caret all along, so that nothing the person did meanwhile (moving to another element, typing) is
 * undone, and an input that was read-only already stays so.
 */
export function guardNumberFields(root: Document = document): () => void {
  const isNumberField = (target: EventTarget | null): target is HTMLInputElement =>
    target instanceof HTMLInputElement && target.type === "number";
  const onKeyDown = (event: KeyboardEvent) => {
    if (isNumberField(event.target) && !event.ctrlKey && !event.metaKey && /^[eE+]$/.test(event.key)) event.preventDefault();
  };
  const onPaste = (event: ClipboardEvent) => {
    if (!isNumberField(event.target)) return;
    const text = event.clipboardData?.getData("text") ?? "";
    if (!/^\s*-?[\d.,]*\s*$/.test(text)) event.preventDefault();
  };
  const onWheel = (event: WheelEvent) => {
    const field = event.target;
    if (!isNumberField(field) || root.activeElement !== field) return;
    if (field.readOnly) return;
    field.readOnly = true;
    requestAnimationFrame(() => {
      field.readOnly = false;
    });
  };
  root.addEventListener("keydown", onKeyDown);
  root.addEventListener("paste", onPaste);
  root.addEventListener("wheel", onWheel, { passive: true });
  return () => {
    root.removeEventListener("keydown", onKeyDown);
    root.removeEventListener("paste", onPaste);
    root.removeEventListener("wheel", onWheel);
  };
}
