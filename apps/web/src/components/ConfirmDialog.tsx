import { type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { BusyButton } from "./BusyButton.tsx";
import { Dialog, useDialog } from "./Dialog.tsx";

/**
 * The one confirmation for an action that cannot be undone or that takes effect at once for someone: a removal, a
 * revocation, a reset. It names the thing and the consequence, offers a button that says what it does ("Remove Bob",
 * never "OK"), starts on Cancel, closes with Escape and gives the focus back to what opened it.
 */
export function useConfirm<T>() {
  const dialog = useDialog();
  const [target, setTarget] = useState<T | null>(null);
  return {
    dialog,
    target,
    /** Asks about `item`; call it from the button's click, passing the button, so that the focus goes back to it. */
    ask: (item: T, from?: HTMLElement | null) => {
      setTarget(item);
      dialog.open(from);
    },
  };
}

/**
 * Where the focus goes once a confirmed action removed the row that opened the dialog: the row after it, else the one
 * before, else `fallback` (the list's heading, the form that adds one). `rows` finds the row from the opener.
 */
export function focusNeighbour(rows: string, fallback: () => HTMLElement | null) {
  return (opener: HTMLElement | null): HTMLElement | null => {
    const row = opener?.closest(rows);
    const sibling = row?.nextElementSibling ?? row?.previousElementSibling ?? null;
    return sibling?.querySelector<HTMLElement>("button:not([disabled]), select:not([disabled]), a[href]") ?? fallback();
  };
}

export function ConfirmDialog({
  confirm,
  title,
  confirmLabel,
  busyLabel,
  tone = "danger",
  errorText,
  focusAfter,
  onConfirm,
  children,
}: {
  confirm: Pick<ReturnType<typeof useConfirm<unknown>>, "dialog">;
  title: string;
  /** What the confirming button says: the action and its object. */
  confirmLabel: string;
  /** What it says while the action runs. */
  busyLabel?: string;
  tone?: "danger" | "primary";
  /** The words for a failed action, shown inside the dialog, which then stays open. */
  errorText?: (error: unknown) => string;
  /** Where the focus goes after the action, when the opener is gone or would be the wrong place. */
  focusAfter?: (opener: HTMLElement | null) => HTMLElement | null;
  /**
   * The action. While its promise is pending the dialog stays open with the button at work; it closes once the action
   * succeeds, and shows the error (and stays) when it throws. An action that returns nothing closes the dialog at once.
   */
  onConfirm: () => Promise<unknown> | void;
  /** The consequence, in a sentence. */
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const id = useId();
  const { dialog } = confirm;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setError(null);
    // Looked for before the action: it may remove the row the neighbours are found from.
    const next = focusAfter?.(dialog.opener.current ?? null);
    try {
      // Called inside the try: an action that throws at once shows its error like one whose promise rejects.
      const result = onConfirm();
      if (result) {
        setBusy(true);
        await result;
      }
    } catch (caught) {
      setError(errorText ? errorText(caught) : t("common.actionFailed"));
      setBusy(false);
      return;
    }
    setBusy(false);
    if (next) dialog.opener.current = next;
    dialog.close();
  };
  return (
    <Dialog
      dialog={dialog}
      labelledBy={`${id}-title`}
      describedBy={children ? `${id}-lead` : undefined}
      locked={busy}
      onClose={() => setError(null)}
    >
      <div className="stack">
        <h2 id={`${id}-title`} className="heading">
          {title}
        </h2>
        {children ? (
          <div id={`${id}-lead`} style={{ margin: 0 }}>
            {children}
          </div>
        ) : null}
        {error ? (
          <p className="notice notice-error" role="alert" style={{ margin: 0 }}>
            {error}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button type="button" className="button button-secondary" disabled={busy} onClick={dialog.close}>
            {t("common.cancel")}
          </button>
          <BusyButton
            className={`button ${tone === "danger" ? "button-danger" : "button-primary"}`}
            busy={busy}
            busyLabel={busyLabel}
            onClick={() => void run()}
          >
            {confirmLabel}
          </BusyButton>
        </div>
      </div>
    </Dialog>
  );
}
