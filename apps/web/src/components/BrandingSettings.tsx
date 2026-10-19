import {
  BRAND_NAME_MAX,
  type Branding,
  DEFAULT_BRANDING,
  LOGO_MAX_DATA_URL,
  LOGO_MAX_FILE_BYTES,
  LOGO_TYPES,
  QUORUMIND_ACCENT,
} from "@quorumind/core/branding";
import { type ChangeEvent, type FormEvent, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, api } from "../api.ts";
import { failureText } from "../errors.ts";
import { LoadFailed } from "./LoadFailed.tsx";

type Status = { kind: "idle" } | { kind: "saving" } | { kind: "done"; message: string } | { kind: "error"; message: string };

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/** White-label settings of the exports: the agency's name, logo and accent color. */
export function BrandingSettings() {
  const { t } = useTranslation();
  const id = useId();
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
  // Nothing can be changed, nor saved, until the saved branding is loaded: saving the defaults would erase it.
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const maxKb = Math.round(LOGO_MAX_FILE_BYTES / 1000);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` asks again.
  useEffect(() => {
    let cancelled = false;
    setLoadFailed(false);
    api.branding().then(
      (body) => {
        if (cancelled) return;
        setBranding(body.branding);
        setLoaded(true);
      },
      () => {
        if (!cancelled) setLoadFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const update = (patch: Partial<Branding>) => {
    setBranding((current) => ({ ...current, ...patch }));
    setStatus({ kind: "idle" });
  };

  const onLogo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!(LOGO_TYPES as readonly string[]).includes(file.type)) return setLogoError(t("branding.logoType"));
    if (file.size > LOGO_MAX_FILE_BYTES) return setLogoError(t("branding.logoTooLarge", { size: maxKb }));
    let dataUrl: string;
    try {
      dataUrl = await readAsDataUrl(file);
    } catch {
      return setLogoError(t("branding.logoType"));
    }
    if (dataUrl.length > LOGO_MAX_DATA_URL) return setLogoError(t("branding.logoTooLarge", { size: maxKb }));
    setLogoError(null);
    update({ logoDataUrl: dataUrl });
  };

  const submit = async (next: Branding, message: string) => {
    setStatus({ kind: "saving" });
    try {
      setBranding((await api.saveBranding(next)).branding);
      setStatus({ kind: "done", message });
    } catch (caught) {
      setStatus({ kind: "error", message: caught instanceof ApiError && caught.status > 0 ? failureText(t, caught) : t("branding.error") });
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit({ ...branding, name: branding.name?.trim() || null }, t("branding.saved"));
  };

  const onReset = () => {
    setLogoError(null);
    void submit(DEFAULT_BRANDING, t("branding.resetDone"));
  };

  const saving = status.kind === "saving";
  return (
    <form className="branding card stack" onSubmit={onSubmit} aria-busy={!loaded || saving}>
      <div className="stack" style={{ gap: "var(--space-2)" }}>
        <h2 className="heading">{t("branding.title")}</h2>
        <p className="field-hint" style={{ margin: 0 }}>
          {t("branding.lead")}
        </p>
      </div>
      {loadFailed ? <LoadFailed onRetry={() => setAttempt((count) => count + 1)} /> : null}

      <label className="field" htmlFor={`${id}-name`}>
        <span className="field-label">{t("branding.name")}</span>
        <input
          id={`${id}-name`}
          className="input"
          value={branding.name ?? ""}
          maxLength={BRAND_NAME_MAX}
          placeholder={t("branding.namePlaceholder")}
          onChange={(event) => update({ name: event.target.value || null })}
          disabled={!loaded}
        />
      </label>

      <div className="field">
        <label className="field-label" htmlFor={`${id}-logo`}>
          {t("branding.logo")}
        </label>
        <div className="branding-logo">
          <div className="branding-preview">
            {branding.logoDataUrl ? <img src={branding.logoDataUrl} alt={t("branding.logoPreview")} /> : <span aria-hidden="true">—</span>}
          </div>
          <div className="stack" style={{ gap: "var(--space-2)" }}>
            <input
              id={`${id}-logo`}
              type="file"
              accept={LOGO_TYPES.join(",")}
              onChange={onLogo}
              aria-describedby={`${id}-logo-hint${logoError ? ` ${id}-logo-error` : ""}`}
              aria-invalid={logoError ? true : undefined}
              disabled={!loaded}
            />
            <span className="field-hint" id={`${id}-logo-hint`}>
              {t("branding.logoHint", { size: maxKb })}
            </span>
            {logoError ? (
              <span className="branding-error" id={`${id}-logo-error`} role="alert">
                {logoError}
              </span>
            ) : null}
            {branding.logoDataUrl ? (
              <div>
                <button type="button" className="button button-quiet" onClick={() => update({ logoDataUrl: null })}>
                  {t("branding.removeLogo")}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="field">
        <label className="field-label" htmlFor={`${id}-accent`}>
          {t("branding.accent")}
        </label>
        <div className="branding-accent">
          <input
            id={`${id}-accent`}
            type="color"
            value={branding.accent ?? QUORUMIND_ACCENT}
            onChange={(event) => update({ accent: event.target.value })}
            aria-describedby={`${id}-accent-hint`}
            disabled={!loaded}
          />
          <span className="mono">{branding.accent ?? QUORUMIND_ACCENT}</span>
        </div>
        <span className="field-hint" id={`${id}-accent-hint`}>
          {t("branding.accentHint")}
        </span>
      </div>

      <div className="row">
        <button type="submit" className="button button-primary" disabled={!loaded || saving}>
          {saving ? t("branding.saving") : t("branding.save")}
        </button>
        <button type="button" className="button button-secondary" onClick={onReset} disabled={!loaded || saving}>
          {t("branding.reset")}
        </button>
        <span role="status" className={status.kind === "error" ? "branding-error" : "field-hint"}>
          {status.kind === "done" || status.kind === "error" ? status.message : ""}
        </span>
      </div>
    </form>
  );
}
