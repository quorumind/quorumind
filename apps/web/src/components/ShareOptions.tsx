import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Share, ShareExpiry, ShareMode, ShareSettings } from "../api.ts";

const MODES: ShareMode[] = ["client", "full"];
const EXPIRIES: ShareExpiry[] = ["7d", "30d", "never"];
const PASSWORD_MIN = 4;

/**
 * What a share link shows (the client deliverable, or the whole session), how long it works and the password it
 * asks for. Before the link exists, the choices go with its creation; afterwards each one applies at once.
 */
export function ShareOptions({
  share,
  pending,
  onApply,
}: {
  share: Share | null;
  pending: boolean;
  /** Creates the link with these settings, or changes it. */
  onApply: (settings: ShareSettings) => void;
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const [mode, setMode] = useState<ShareMode>(share?.mode ?? "client");
  const [expiry, setExpiry] = useState<ShareExpiry>("30d");
  const [password, setPassword] = useState("");
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" });
  const tooShort = password.length > 0 && password.length < PASSWORD_MIN;
  const currentMode = share?.mode ?? mode;

  const chooseMode = (next: ShareMode) => {
    setMode(next);
    if (share) onApply({ mode: next });
  };
  const chooseExpiry = (next: ShareExpiry) => {
    setExpiry(next);
    if (share) onApply({ expiresIn: next });
  };
  const applyPassword = () => {
    onApply({ password });
    setPassword("");
  };

  return (
    <div className="stack">
      <fieldset className="share-modes" disabled={pending}>
        <legend className="field-label">{t("share.modeLabel")}</legend>
        {MODES.map((value) => (
          <label key={value} className="check">
            <input type="radio" name={`${id}-mode`} value={value} checked={currentMode === value} onChange={() => chooseMode(value)} />
            <span>
              {t(`share.mode.${value}`)}
              <span className="field-hint">{t(`share.modeHint.${value}`)}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="field">
        <label className="field-label" htmlFor={`${id}-expiry`}>
          {t("share.expiryLabel")}
        </label>
        <select
          id={`${id}-expiry`}
          className="select"
          disabled={pending}
          // An existing link keeps its date until another duration is chosen.
          value={share ? (share.expiresAt === null ? "never" : "") : expiry}
          onChange={(event) => chooseExpiry(event.target.value as ShareExpiry)}
        >
          {share?.expiresAt ? (
            <option value="" disabled>
              {t("share.until", { date: date.format(new Date(share.expiresAt)) })}
            </option>
          ) : null}
          {EXPIRIES.map((value) => (
            <option key={value} value={value}>
              {t(`share.expiry.${value}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field-label" htmlFor={`${id}-password`}>
          {t("share.passwordLabel")}
        </label>
        {share?.hasPassword ? <span className="field-hint">{t("share.passwordSet")}</span> : null}
        <div className="copy-row">
          <input
            id={`${id}-password`}
            className="input"
            type="password"
            autoComplete="new-password"
            maxLength={200}
            value={password}
            placeholder={share?.hasPassword ? t("share.passwordChange") : t("share.passwordNone")}
            aria-invalid={tooShort}
            aria-describedby={`${id}-password-hint`}
            onChange={(event) => setPassword(event.target.value)}
          />
          {share ? (
            <button
              type="button"
              className="button button-secondary"
              disabled={pending || password.length < PASSWORD_MIN}
              onClick={applyPassword}
            >
              {t("share.passwordApply")}
            </button>
          ) : null}
        </div>
        <span id={`${id}-password-hint`} className="field-hint">
          {t("share.passwordHint", { min: PASSWORD_MIN })}
        </span>
        {share?.hasPassword ? (
          <div>
            <button type="button" className="button button-quiet" disabled={pending} onClick={() => onApply({ password: null })}>
              {t("share.passwordRemove")}
            </button>
          </div>
        ) : null}
      </div>

      {share ? null : (
        <div>
          <button
            type="button"
            className="button button-primary"
            disabled={pending || tooShort}
            onClick={() => onApply({ mode, expiresIn: expiry, ...(password ? { password } : {}) })}
          >
            {t("share.create")}
          </button>
        </div>
      )}
    </div>
  );
}
