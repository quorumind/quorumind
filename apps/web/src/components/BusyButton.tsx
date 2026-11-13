import { type ButtonHTMLAttributes, type MouseEvent, type ReactNode, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Mark } from "./Logo.tsx";

export interface BusyButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-busy" | "aria-disabled"> {
  /** The submission is on its way: the button shows the waiting label and a small busy mark, and ignores clicks. */
  busy?: boolean;
  /**
   * What the button says while it waits ("Saving…", "Sending…"). Without it, the generic "Working…" of the interface
   * language. Always say what is going on when the button's own name is more precise than that.
   */
  busyLabel?: ReactNode;
  /**
   * Whether the waiting label is also announced politely to screen readers (a visually hidden status). Turn it off
   * where a nearby status line already says the same thing, so that it is not read twice.
   */
  announce?: boolean;
  /** The button's label when it is not waiting. */
  children?: ReactNode;
}

/**
 * The one button for an action that takes time (a submission, a revision, a save). While `busy` it:
 * - says what it is doing (`busyLabel`) next to a small mark at work,
 * - carries `aria-busy` and `aria-disabled`, and stays a real, focusable button: the keyboard user is still on it when
 *   the answer comes (a `disabled` button drops the focus to the page),
 * - ignores clicks and the submit they would start, so a double click or an Enter sends once.
 *
 * `disabled` keeps its usual meaning (the action is not available yet) and applies only while the button is idle: a
 * busy button is never `disabled`. `className` defaults to a primary button; `type` to "button" like any button
 * would, so pass `type="submit"` for a form's button. Later screens reuse it as is: `<BusyButton busy={pending}>`.
 */
export function BusyButton({
  busy = false,
  busyLabel,
  disabled,
  className = "button button-primary",
  type = "button",
  onClick,
  announce = true,
  children,
  ...rest
}: BusyButtonProps) {
  const { t } = useTranslation();
  const node = useRef<HTMLButtonElement>(null);
  const idleWidth = useRef(0);
  // The waiting label and the mark must not resize the button: it keeps the width its idle label gave it.
  useLayoutEffect(() => {
    const button = node.current;
    if (!button) return;
    if (busy) button.style.minInlineSize = idleWidth.current ? `${idleWidth.current}px` : "";
    else {
      button.style.minInlineSize = "";
      idleWidth.current = button.getBoundingClientRect().width;
    }
  });
  const label = busyLabel ?? t("common.working");
  const click = (event: MouseEvent<HTMLButtonElement>) => {
    if (busy) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };
  return (
    <>
      <button
        {...rest}
        ref={node}
        type={type}
        className={className}
        disabled={busy ? undefined : disabled}
        aria-busy={busy || undefined}
        aria-disabled={busy || undefined}
        data-busy={busy || undefined}
        onClick={click}
      >
        {busy ? (
          <>
            <span className="button-mark">
              <Mark busy />
            </span>
            {label}
          </>
        ) : (
          children
        )}
      </button>
      {announce ? (
        <span className="visually-hidden" role="status">
          {busy ? label : ""}
        </span>
      ) : null}
    </>
  );
}
