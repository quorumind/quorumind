import { type ReactNode, useId } from "react";

// Two controls every screen shares: a segmented control (one choice among a few, shown at once) and a switch (an
// option that is on or off, with what it does under its name).

/**
 * One choice among a few: buttons of a fieldset, the chosen one pressed. Each option has a `key` of its own, since its
 * value can be null or a boolean.
 */
export function Segmented<T>({
  legend,
  options,
  value,
  onChange,
  className,
  disabled,
}: {
  /** Read by screen readers only: the control's name. */
  legend: string;
  options: { key: string; value: T; label: ReactNode }[];
  value: T;
  onChange: (next: T) => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <fieldset className={className ? `segmented ${className}` : "segmented"} disabled={disabled}>
      <legend className="visually-hidden">{legend}</legend>
      {options.map((option) => (
        <button key={option.key} type="button" aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}

/** An option that is on or off: a checkbox drawn as a switch, named by its label and described by its hint. */
export function Switch({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <label className="switch-row" data-disabled={disabled || undefined}>
      <span className="switch-text">
        <span id={`${id}-label`} className="switch-label">
          {label}
        </span>
        {hint ? (
          <span id={`${id}-hint`} className="field-hint">
            {hint}
          </span>
        ) : null}
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        className="switch"
        checked={checked}
        disabled={disabled}
        aria-labelledby={`${id}-label`}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}
