/**
 * Copies a text, and says whether it worked. A page served over plain http on a local network has no clipboard
 * access, and a browser can refuse it: the caller then selects the text for the person to copy by hand.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
