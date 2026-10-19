import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { copyText } from "../clipboard.ts";
import { CheckIcon } from "./Icons.tsx";

/** A link to send, read-only, with its Copy button; when the browser cannot copy, the link is selected instead. */
export function CopyField({ value, label, copy, copied }: { value: string; label: string; copy: string; copied: string }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  useEffect(() => {
    if (state !== "done") return;
    const timer = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [state]);

  const onCopy = async () => {
    if (await copyText(value)) return setState("done");
    setState("failed");
    input.current?.focus();
    input.current?.select();
  };

  return (
    <div className="stack" style={{ gap: "var(--space-1)" }}>
      <div className="copy-row">
        <input ref={input} className="input mono" readOnly value={value} aria-label={label} onFocus={(event) => event.target.select()} />
        <button type="button" className="button button-secondary" onClick={onCopy}>
          {state === "done" ? (
            <span className="copied">
              <CheckIcon />
              {copied}
            </span>
          ) : (
            copy
          )}
        </button>
      </div>
      <span className="field-hint" role="status">
        {state === "failed" ? t("common.copyFailed") : ""}
      </span>
    </div>
  );
}
