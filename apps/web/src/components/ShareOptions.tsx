import { type KeyboardEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Share, ShareExpiry, ShareMode, ShareSettings } from "../api.ts";
import { BusyButton } from "./BusyButton.tsx";
import { FieldError, fieldProps } from "./Field.tsx";

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
  // Which button started the request in flight: that one waits, the others are only unavailable.
  const [acting, setActing] = useState<"create" | "password" | "remove" | null>(null);
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" });
  const tooShort = password.length > 0 && password.length < PASSWORD_MIN;
  const shortMessage = tooShort ? t("validation.passwordShort", { min: PASSWORD_MIN }) : null;
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
    setActing("password");
    onApply({ password });
    setPassword("");
  };
  const create = () => {
    setActing("create");
    onApply({ mode, expiresIn: expiry, ...(password ? { password } : {}) });
  };
  // Enter in the password field does what its button does: set the password, or create the protected link.
  const onPasswordKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (pending) return;
    if (share && password.length >= PASSWORD_MIN) applyPassword();
    else if (!share && !tooShort) create();
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
        <span id={`${id}-password-state`} className="field-hint">
          {share?.hasPassword ? t("share.passwordSet") : t("share.passwordNone")}
        </span>
        <div className="copy-row">
          <input
            id={`${id}-password`}
            className="input"
            type="password"
            autoComplete="new-password"
            maxLength={200}
            value={password}
            placeholder={share?.hasPassword ? t("share.passwordChange") : undefined}
            {...fieldProps(`${id}-password`, shortMessage, `${id}-password-state`, `${id}-password-hint`)}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={onPasswordKey}
          />
          {share ? (
            <BusyButton
              className="button button-secondary"
              busy={pending && acting === "password"}
              busyLabel={t("common.saving")}
              disabled={pending || password.length < PASSWORD_MIN}
              onClick={applyPassword}
            >
              {t("share.passwordApply")}
            </BusyButton>
          ) : null}
        </div>
        <span id={`${id}-password-hint`} className="field-hint">
          {t("share.passwordHint", { min: PASSWORD_MIN })}
        </span>
        <FieldError id={`${id}-password`} error={shortMessage} />
        {share?.hasPassword ? (
          <div>
            <BusyButton
              className="button button-quiet"
              busy={pending && acting === "remove"}
              busyLabel={t("common.saving")}
              disabled={pending}
              onClick={() => {
                setActing("remove");
                onApply({ password: null });
              }}
            >
              {t("share.passwordRemove")}
            </BusyButton>
          </div>
        ) : null}
      </div>

      {share ? null : (
        <div>
          <BusyButton busy={pending && acting === "create"} disabled={pending || tooShort} onClick={create}>
            {t("share.create")}
          </BusyButton>
        </div>
      )}
    </div>
  );
}
