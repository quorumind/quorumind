import type { CSSProperties } from "react";
import { Trans, useTranslation } from "react-i18next";

/** The key that sends a form with Enter: Command on a Mac, Ctrl elsewhere (Strg on a German keyboard). */
function sendKey(language: string): string {
  const platform = typeof navigator === "undefined" ? "" : `${navigator.platform} ${navigator.userAgent}`;
  if (/Mac|iPhone|iPad/i.test(platform)) return "⌘";
  return language === "de" ? "Strg" : "Ctrl";
}

/**
 * "Ctrl+Enter to send" (⌘ on a Mac): the shortcut of a form, said where its button is. Hidden on a touch screen.
 * The key combination is an isolated left-to-right run (<bdi dir="ltr">): inside Arabic text, the bare "⌘+Enter"
 * would reorder to "Enter+⌘" because "⌘" and "+" take the direction of the sentence around them.
 */
export function ShortcutHint({ className = "form-shortcut", style }: { className?: string; style?: CSSProperties }) {
  const { t, i18n } = useTranslation();
  return (
    <span className={className} style={style}>
      <Trans t={t} i18nKey="validation.shortcut" values={{ key: sendKey(i18n.language) }} components={{ ltr: <bdi dir="ltr" /> }} />
    </span>
  );
}
