import { type KeyboardEvent, type ReactNode, type RefObject, useCallback, useRef } from "react";

// A modal dialog that keeps the keyboard inside it while open and gives the focus back to what opened it.

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogHandle {
  ref: RefObject<HTMLDialogElement | null>;
  /** `from`: the control that asked, when it may not have the focus (Safari does not focus a button on click); anything else is ignored. */
  open: (from?: unknown) => void;
  close: () => void;
}

/** Opens and closes a dialog, remembering what had the focus before. */
export function useDialog(): DialogHandle & { opener: RefObject<HTMLElement | null> } {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const open = useCallback((from?: unknown) => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    opener.current = from instanceof HTMLElement ? from : document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
  }, []);
  const close = useCallback(() => ref.current?.close(), []);
  return { ref, open, close, opener };
}

/**
 * Tab and Shift+Tab go round the dialog's controls instead of leaving it; Escape closes it. The browser closes a modal
 * dialog on Escape by itself: doing it here too keeps the behaviour the same wherever the dialog's own handling is
 * missing, and the dialog's `close` event (which gives the focus back) fires either way.
 */
function trapTab(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.currentTarget.close();
    return;
  }
  if (event.key !== "Tab") return;
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const first = items[0];
  const last = items.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function Dialog({
  dialog,
  labelledBy,
  describedBy,
  locked = false,
  onClose,
  children,
}: {
  dialog: ReturnType<typeof useDialog>;
  labelledBy: string;
  /** The element that says what the dialog is about (its consequence), read after its title. */
  describedBy?: string;
  /** An action is running in it: Escape does not close it until the action is over. */
  locked?: boolean;
  onClose?: () => void;
  children: ReactNode;
}) {
  return (
    <dialog
      ref={dialog.ref}
      className="dialog"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onKeyDown={(event) => {
        if (locked && event.key === "Escape") {
          event.preventDefault();
          return;
        }
        trapTab(event);
      }}
      onCancel={(event) => {
        if (locked) event.preventDefault();
      }}
      onClose={() => {
        onClose?.();
        const opener = dialog.opener.current;
        dialog.opener.current = null;
        if (opener?.isConnected) opener.focus();
      }}
    >
      {children}
    </dialog>
  );
}
