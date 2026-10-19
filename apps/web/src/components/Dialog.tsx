import { type KeyboardEvent, type ReactNode, type RefObject, useCallback, useRef } from "react";

// A modal dialog that keeps the keyboard inside it while open and gives the focus back to what opened it.

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogHandle {
  ref: RefObject<HTMLDialogElement | null>;
  open: () => void;
  close: () => void;
}

/** Opens and closes a dialog, remembering what had the focus before. */
export function useDialog(): DialogHandle & { opener: RefObject<HTMLElement | null> } {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const open = useCallback(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
  }, []);
  const close = useCallback(() => ref.current?.close(), []);
  return { ref, open, close, opener };
}

/** Tab and Shift+Tab go round the dialog's controls instead of leaving it. */
function trapTab(event: KeyboardEvent<HTMLDialogElement>) {
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
  onClose,
  children,
}: {
  dialog: ReturnType<typeof useDialog>;
  labelledBy: string;
  onClose?: () => void;
  children: ReactNode;
}) {
  return (
    <dialog
      ref={dialog.ref}
      className="dialog"
      aria-labelledby={labelledBy}
      onKeyDown={trapTab}
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
