import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api.ts";
import { WarningIcon } from "./Icons.tsx";

/**
 * The one validation pattern of the interface. A form carries `noValidate` (the browser's own bubbles speak the
 * browser's language, not the interface's, and vanish), checks its fields when it is sent, and shows what is wrong
 * under each field: the field gets `aria-invalid` and `aria-describedby`, and the first one at fault takes the focus.
 */

/** What is wrong, by the name the form gives each field. */
export type FieldErrors = Record<string, string>;

/** The error of a field as it is announced and styled: `aria-invalid` and the id of the message that explains it. */
export function fieldProps(id: string, error?: string | null, ...described: (string | false | null | undefined)[]) {
  const ids = [...described, error ? `${id}-error` : null].filter(Boolean).join(" ");
  return {
    ...(error ? { "aria-invalid": true as const } : {}),
    ...(ids ? { "aria-describedby": ids } : {}),
  };
}

/** The server's name for the field it refused (`params.field` of its 400), or null for any other failure. */
export function serverField(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const field = error.params?.field;
  return typeof field === "string" && field !== "" ? field : null;
}

/**
 * The errors of one form. `report` shows them and moves the focus to the first field at fault in page order; `clear`
 * removes one as soon as the person edits that field; `reportServer` attaches a refusal from the server to its field.
 */
export function useFieldErrors() {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [round, setRound] = useState(0);
  const form: RefObject<HTMLFormElement | null> = useRef(null);
  // After the render that marked the fields, so that `aria-invalid` is in the page when the focus looks for it.
  useEffect(() => {
    if (round === 0) return;
    const root: ParentNode = form.current ?? document;
    root.querySelector<HTMLElement>('[aria-invalid="true"], [data-field-error]')?.focus();
  }, [round]);
  const report = useCallback((next: FieldErrors) => {
    setErrors(next);
    if (Object.keys(next).length > 0) setRound((count) => count + 1);
  }, []);
  const clear = useCallback((name?: string) => {
    setErrors((current) => {
      if (name === undefined) return Object.keys(current).length > 0 ? {} : current;
      if (!(name in current)) return current;
      const { [name]: _gone, ...rest } = current;
      return rest;
    });
  }, []);
  /**
   * The refusal of a field the form has, shown on that field with `message`. `fields` maps the server's names to the
   * form's. False when the server named no field of this form: the caller shows it as a general error.
   */
  const reportServer = useCallback(
    (error: unknown, fields: Record<string, string>, message: string) => {
      const field = serverField(error);
      const mine = field === null ? undefined : fields[field];
      if (!mine) return false;
      report({ [mine]: message });
      return true;
    },
    [report],
  );
  return { errors, report, clear, reportServer, form };
}

/** The message under a field, with the id its control points at. Nothing when there is no error. */
export function FieldError({
  id,
  error,
  focusable = false,
}: {
  id: string;
  error?: string | null | undefined;
  /** For a group with no single control to mark (a list of documents): the message itself takes the focus. */
  focusable?: boolean;
}) {
  if (!error) return null;
  return (
    <span id={`${id}-error`} className="field-error" {...(focusable ? { tabIndex: -1, "data-field-error": "" } : {})}>
      <WarningIcon />
      {error}
    </span>
  );
}

export interface FieldControlProps {
  id: string;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
}

/**
 * A labelled field with its hint, its message and its counter wired to the control: the control is given the `id`,
 * `aria-invalid` and `aria-describedby` it needs.
 */
export function Field({
  id,
  label,
  hint,
  error,
  counter,
  className = "field",
  hideLabel = false,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null | undefined;
  /** The text counter, when the field has a limit: `<CharCounter id={id} value={…} max={…} />`. */
  counter?: ReactNode;
  className?: string;
  hideLabel?: boolean;
  children: (props: FieldControlProps) => ReactNode;
}) {
  return (
    <div className={className}>
      <label className={hideLabel ? "visually-hidden" : "field-label"} htmlFor={id}>
        {label}
      </label>
      {children({ id, ...fieldProps(id, error, hint ? `${id}-hint` : null, counter ? `${id}-counter` : null) })}
      {hint ? (
        <span id={`${id}-hint`} className="field-hint">
          {hint}
        </span>
      ) : null}
      <FieldError id={id} error={error} />
      {counter}
    </div>
  );
}

/** Where the counter shows itself, and where a screen reader is told. */
const SHOW_AT = 0.8;
const ANNOUNCE_AT = [0.9, 1] as const;

/**
 * "3 214 / 4 000", for a field that cuts what is typed past its limit. It shows from 80 % of the limit, and is read
 * out when the text passes 90 % and reaches the limit, not at every key. `value` is the field's text.
 */
export function CharCounter({ id, value, max }: { id: string; value: string; max: number }) {
  const { t, i18n } = useTranslation();
  const length = value.length;
  const ratio = length / max;
  const shown = ratio >= SHOW_AT;
  const level = ratio >= ANNOUNCE_AT[1] ? 2 : ratio >= ANNOUNCE_AT[0] ? 1 : 0;
  const numbers = new Intl.NumberFormat(i18n.language);
  const text = t("validation.counter", { used: numbers.format(length), max: numbers.format(max) });
  // The status only says something when the level changes; typing within a level leaves it as it was.
  const [said, setSaid] = useState("");
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a change of level is announced.
  useEffect(() => {
    setSaid(level === 0 ? "" : t(level === 2 ? "validation.counterFull" : "validation.counterNear", { max: numbers.format(max) }));
  }, [level, t, max]);
  return (
    <>
      {/* Not in the page below 80 %: a field's aria-describedby then points at nothing, and "0 / 4 000" is not read. */}
      {shown ? (
        <span id={`${id}-counter`} className={`field-counter${level === 2 ? " field-counter-full" : ""}`}>
          {text}
        </span>
      ) : null}
      <span className="visually-hidden" aria-live="polite">
        {said}
      </span>
    </>
  );
}
