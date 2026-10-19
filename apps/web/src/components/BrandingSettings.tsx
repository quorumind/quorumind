import {
  BRAND_NAME_MAX,
  type Branding,
  DEFAULT_BRANDING,
  LOGO_MAX_DATA_URL,
  LOGO_MAX_FILE_BYTES,
  LOGO_TYPES,
  QUORUMIND_ACCENT,
} from "@quorumind/core/branding";
import { type DragEvent, type FormEvent, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, api } from "../api.ts";
import { isHexColor, readableOn } from "../contrast.ts";
import { failureText } from "../errors.ts";
import { Dialog, useDialog } from "./Dialog.tsx";
import { CheckIcon, UploadIcon } from "./Icons.tsx";
import { LoadFailed } from "./LoadFailed.tsx";

type Status = { kind: "idle" } | { kind: "saving" } | { kind: "done"; message: string } | { kind: "error"; message: string };

/** A few accents that read well on a report, Quorumind's first. */
export const ACCENT_PRESETS = ["#2b44c4", "#0f766e", "#b23a1e", "#7c45b0", "#b45309", "#334155"] as const;

const TYPE_NAMES: Record<string, string> = { "image/png": "PNG", "image/jpeg": "JPEG", "image/svg+xml": "SVG" };

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/** The type and the size in bytes of an image saved as a data URL: what a base64 text of that length decodes to. */
function logoFacts(dataUrl: string): { type: string; bytes: number } {
  const [head = "", body = ""] = dataUrl.split(",", 2);
  const type = head.slice(5).split(";")[0] ?? "";
  const bytes = head.includes(";base64")
    ? Math.floor((body.length * 3) / 4) - (body.endsWith("==") ? 2 : body.endsWith("=") ? 1 : 0)
    : body.length;
  return { type: TYPE_NAMES[type] ?? type, bytes };
}

/** White-label settings of the exports: the agency's name, logo and accent color, with a preview of a report's header. */
export function BrandingSettings() {
  const { t, i18n } = useTranslation();
  const id = useId();
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
  // Nothing can be changed, nor saved, until the saved branding is loaded: saving the defaults would erase it.
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [logoError, setLogoError] = useState<string | null>(null);
  // The name of the file chosen in this visit; a logo saved earlier has none.
  const [logoName, setLogoName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  // The accent as typed: applied once it is a color.
  const [hex, setHex] = useState(QUORUMIND_ACCENT);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const fileInput = useRef<HTMLInputElement>(null);
  const resetDialog = useDialog();
  const maxKb = Math.round(LOGO_MAX_FILE_BYTES / 1000);
  const accent = branding.accent ?? QUORUMIND_ACCENT;
  const hexInvalid = !isHexColor(hex);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` asks again.
  useEffect(() => {
    let cancelled = false;
    setLoadFailed(false);
    api.branding().then(
      (body) => {
        if (cancelled) return;
        setBranding(body.branding);
        setHex(body.branding.accent ?? QUORUMIND_ACCENT);
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

  const chooseAccent = (color: string) => {
    setHex(color);
    if (isHexColor(color)) update({ accent: color.toLowerCase() });
  };

  const takeLogo = async (file: File | undefined) => {
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
    setLogoName(file.name);
    update({ logoDataUrl: dataUrl });
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (loaded) void takeLogo(event.dataTransfer.files[0]);
  };

  const submit = async (next: Branding, message: string) => {
    setStatus({ kind: "saving" });
    try {
      const saved = (await api.saveBranding(next)).branding;
      setBranding(saved);
      setHex(saved.accent ?? QUORUMIND_ACCENT);
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
    resetDialog.close();
    setLogoError(null);
    setLogoName(null);
    void submit(DEFAULT_BRANDING, t("branding.resetDone"));
  };

  const saving = status.kind === "saving";
  const facts = branding.logoDataUrl ? logoFacts(branding.logoDataUrl) : null;
  const size = facts
    ? new Intl.NumberFormat(i18n.language, { style: "unit", unit: "kilobyte", maximumFractionDigits: 0 }).format(
        Math.max(1, facts.bytes / 1000),
      )
    : "";
  const headingColor = readableOn(accent, ["#ffffff"]);
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: "long" }).format(new Date());

  return (
    <form className="branding card stack-lg" onSubmit={onSubmit} aria-busy={!loaded || saving}>
      <div className="stack" style={{ gap: "var(--space-2)" }}>
        <h2 className="heading">{t("branding.title")}</h2>
        <p className="field-hint" style={{ margin: 0 }}>
          {t("branding.lead")}
        </p>
      </div>
      {loadFailed ? <LoadFailed onRetry={() => setAttempt((count) => count + 1)} /> : null}

      <div className="branding-layout">
        <div className="stack-lg branding-fields">
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
            <span className="field-label" id={`${id}-logo-label`}>
              {t("branding.logo")}
            </span>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: dropping is a shortcut; the button inside does the same from the keyboard. */}
            <div
              className="logo-drop"
              data-dragging={dragging || undefined}
              data-filled={branding.logoDataUrl ? "" : undefined}
              onDragOver={(event) => {
                event.preventDefault();
                if (loaded) setDragging(true);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
              }}
              onDrop={onDrop}
            >
              <div className="logo-preview checkerboard">
                {branding.logoDataUrl ? (
                  <img src={branding.logoDataUrl} alt={t("branding.logoPreview")} />
                ) : (
                  <span className="field-hint">{t("branding.logoNone")}</span>
                )}
              </div>
              <div className="logo-drop-body">
                {branding.logoDataUrl ? (
                  <p className="logo-file">
                    <span className="logo-file-name">{logoName ?? t("branding.logoSaved")}</span>
                    <span className="field-hint">
                      {facts?.type} · {size}
                    </span>
                  </p>
                ) : (
                  <p className="field-hint logo-drop-text">{t("branding.logoDrop")}</p>
                )}
                <div className="row logo-actions">
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => fileInput.current?.click()}
                    disabled={!loaded}
                    aria-describedby={`${id}-logo-label ${id}-logo-hint${logoError ? ` ${id}-logo-error` : ""}`}
                  >
                    <UploadIcon />
                    {branding.logoDataUrl ? t("branding.logoReplace") : t("branding.logoChoose")}
                  </button>
                  {branding.logoDataUrl ? (
                    <button
                      type="button"
                      className="button button-quiet danger"
                      onClick={() => {
                        setLogoName(null);
                        update({ logoDataUrl: null });
                      }}
                    >
                      {t("branding.removeLogo")}
                    </button>
                  ) : null}
                </div>
              </div>
              <input
                ref={fileInput}
                type="file"
                className="visually-hidden"
                tabIndex={-1}
                aria-hidden="true"
                accept={LOGO_TYPES.join(",")}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  void takeLogo(file);
                }}
              />
            </div>
            <span className="field-hint" id={`${id}-logo-hint`}>
              {t("branding.logoHint", { size: maxKb })}
            </span>
            {logoError ? (
              <span className="branding-error" id={`${id}-logo-error`} role="alert">
                {logoError}
              </span>
            ) : null}
          </div>

          <fieldset className="field branding-accent-group" disabled={!loaded}>
            <legend className="field-label">{t("branding.accent")}</legend>
            <div className="branding-accent">
              <input
                type="color"
                className="accent-swatch"
                aria-label={t("branding.accentPicker")}
                value={accent}
                onChange={(event) => chooseAccent(event.target.value)}
              />
              <input
                id={`${id}-hex`}
                className="input mono accent-hex"
                dir="ltr"
                aria-label={t("branding.accentHex")}
                value={hex}
                maxLength={7}
                spellCheck={false}
                autoCapitalize="none"
                aria-invalid={hexInvalid || undefined}
                aria-describedby={`${id}-accent-hint${hexInvalid ? ` ${id}-accent-error` : ""}`}
                onChange={(event) => chooseAccent(event.target.value.trim())}
              />
              <fieldset className="accent-presets">
                <legend className="visually-hidden">{t("branding.presets")}</legend>
                {ACCENT_PRESETS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className="accent-preset"
                    style={{ background: color }}
                    aria-label={t("branding.preset", { color: color.toUpperCase() })}
                    aria-pressed={accent.toLowerCase() === color}
                    onClick={() => chooseAccent(color)}
                  >
                    {accent.toLowerCase() === color ? <CheckIcon /> : null}
                  </button>
                ))}
              </fieldset>
            </div>
            <span className="field-hint" id={`${id}-accent-hint`}>
              {t("branding.accentHint")}
            </span>
            {hexInvalid ? (
              <span className="branding-error" id={`${id}-accent-error`}>
                {t("branding.accentInvalid")}
              </span>
            ) : null}
          </fieldset>
        </div>

        {/* What a report's first lines look like with these choices: a page of paper, in both themes. */}
        <figure className="branding-preview" aria-labelledby={`${id}-preview`}>
          <figcaption className="field-label" id={`${id}-preview`}>
            {t("branding.preview")}
          </figcaption>
          <div className="report-sample" aria-hidden="true">
            <div className="report-sample-masthead">
              <span className="report-sample-brand">
                {branding.logoDataUrl ? <img src={branding.logoDataUrl} alt="" /> : null}
                {/* Without a name nor a logo, the reports keep Quorumind's. */}
                {branding.name?.trim() || (branding.logoDataUrl ? "" : "Quorumind")}
              </span>
              <span className="report-sample-date">{date}</span>
            </div>
            <p className="report-sample-title" style={{ color: headingColor, borderColor: accent }}>
              {t("branding.previewTitle")}
            </p>
            <div className="report-sample-lines">
              <i />
              <i />
              <i />
            </div>
            <div className="report-sample-verdict" style={{ borderInlineStartColor: accent }}>
              <i style={{ background: accent }} />
              <span />
            </div>
          </div>
        </figure>
      </div>

      <div className="row branding-actions">
        <button type="submit" className="button button-primary" disabled={!loaded || saving || hexInvalid}>
          {saving ? t("branding.saving") : t("branding.save")}
        </button>
        <button type="button" className="button button-quiet" onClick={resetDialog.open} disabled={!loaded || saving}>
          {t("branding.reset")}
        </button>
        <span role="status" className={status.kind === "error" ? "branding-error" : "field-hint"}>
          {status.kind === "done" || status.kind === "error" ? status.message : ""}
        </span>
      </div>

      <Dialog dialog={resetDialog} labelledBy={`${id}-reset-title`}>
        <div className="stack">
          <h2 id={`${id}-reset-title`} className="heading">
            {t("branding.resetTitle")}
          </h2>
          <p style={{ margin: 0 }}>{t("branding.resetLead")}</p>
          <div className="dialog-actions">
            <button type="button" className="button button-secondary" onClick={resetDialog.close}>
              {t("common.cancel")}
            </button>
            <button type="button" className="button button-primary" onClick={onReset}>
              {t("branding.resetConfirm")}
            </button>
          </div>
        </div>
      </Dialog>
    </form>
  );
}
