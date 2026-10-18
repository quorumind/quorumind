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

type Status = { kind: "idle" } | { kind: "saving" } | { kind: "done"; message: string } | { kind: "error"; message: string };

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

async function saveBranding(branding: Branding): Promise<Branding> {
  const response = await fetch("/api/branding", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(branding),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return ((await response.json()) as { branding: Branding }).branding;
}

/** White-label settings of the exports: the agency's name, logo and accent color. */
export function BrandingSettings() {
  const { t } = useTranslation();
  const id = useId();
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
  const [loaded, setLoaded] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const maxKb = Math.round(LOGO_MAX_FILE_BYTES / 1000);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/branding")
      .then((response) => (response.ok ? (response.json() as Promise<{ branding: Branding }>) : Promise.reject(new Error())))
      .then((body) => {
        if (!cancelled) setBranding(body.branding);
      })
      .catch(() => {
        if (!cancelled) setStatus({ kind: "error", message: t("error.request") });
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

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
    const dataUrl = await readAsDataUrl(file);
    if (dataUrl.length > LOGO_MAX_DATA_URL) return setLogoError(t("branding.logoTooLarge", { size: maxKb }));
    setLogoError(null);
    update({ logoDataUrl: dataUrl });
  };

  const submit = async (next: Branding, message: string) => {
    setStatus({ kind: "saving" });
    try {
      setBranding(await saveBranding(next));
      setStatus({ kind: "done", message });
    } catch {
      setStatus({ kind: "error", message: t("branding.error") });
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
