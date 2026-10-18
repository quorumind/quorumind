import { type DragEvent, type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api.ts";
import { CONTEXT_LIMITS, type ContextDocument, contextApi } from "../contextApi.ts";
import { WarningIcon } from "./Icons.tsx";

export interface ContextPickerProps {
  value: ContextDocument[];
  onChange(next: ContextDocument[]): void;
  disabled?: boolean;
  /** Told when imports start and when the last one ends: a session must not start without its documents. */
  onBusyChange?(busy: boolean): void;
}

type Kind = ContextDocument["kind"];

interface Pending {
  key: number;
  kind: Kind;
  label: string;
  /** Share uploaded, from 0 to 1; null once the server is reading the document, or for an address. */
  progress: number | null;
  controller: AbortController;
}

interface Failure {
  key: number;
  label: string;
  code: string;
}

/** Error codes the interface explains; any other one gets the generic message. */
const ERROR_CODES = new Set([
  "unsupported_type",
  "too_large",
  "empty",
  "scanned",
  "encrypted",
  "fetch_failed",
  "blocked_address",
  "not_found",
  "rate_limited",
  "too_many_imports",
  "network",
  "limit",
]);

const PREVIEW_LINES = 12;
const PREVIEW_CHARS = 900;

function preview(text: string): string {
  const head = text.split("\n").slice(0, PREVIEW_LINES).join("\n");
  return head.length > PREVIEW_CHARS ? `${head.slice(0, PREVIEW_CHARS)}…` : head;
}

const extensionOf = (name: string) => /\.[^.]+$/.exec(name)?.[0]?.toLowerCase() ?? "";
const isGithub = (address: string) => /^(https?:\/\/)?(www\.)?github\.com\//i.test(address.trim());

// Outline glyphs on the same 24px grid and 1.5px stroke as Icons.tsx.
function Glyph({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function KindIcon({ kind }: { kind: Kind }) {
  switch (kind) {
    case "file":
      return (
        <Glyph>
          <path d="M14 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8z" />
          <path d="M14 3.5V8h4.5M9 12.5h6M9 16h6" />
        </Glyph>
      );
    case "url":
      return (
        <Glyph>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5z" />
        </Glyph>
      );
    case "github":
      return (
        <Glyph>
          <circle cx="7" cy="5.5" r="2" />
          <circle cx="7" cy="18.5" r="2" />
          <circle cx="17" cy="8.5" r="2" />
          <path d="M7 7.5v9M17 10.5c0 3.5-4 3-8.5 6.5" />
        </Glyph>
      );
    default:
      return (
        <Glyph>
          <path d="M5 6.5h14M5 10.5h14M5 14.5h14M5 18.5h8" />
        </Glyph>
      );
  }
}

const UploadGlyph = () => (
  <Glyph size={24}>
    <path d="M12 15.5V4.5M7.5 9L12 4.5 16.5 9M5 15.5v3a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-3" />
  </Glyph>
);

const CloseGlyph = () => (
  <Glyph>
    <path d="M7 7l10 10M17 7L7 17" />
  </Glyph>
);

/**
 * Attaches context documents to a session: uploaded files, web pages or GitHub repositories, pasted text.
 * The documents are extracted on the server and kept by the parent through `value` and `onChange`.
 */
export function ContextPicker({ value, onChange, disabled = false, onBusyChange }: ContextPickerProps) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const [pending, setPending] = useState<Pending[]>([]);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [url, setUrl] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteName, setPasteName] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [dragging, setDragging] = useState(false);
  const [openPreview, setOpenPreview] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const chooseButton = useRef<HTMLButtonElement>(null);
  const pasteToggle = useRef<HTMLButtonElement>(null);
  const pasteArea = useRef<HTMLTextAreaElement>(null);
  const nextKey = useRef(0);
  // Several imports can finish before the parent re-renders: always build on the latest list.
  const latest = useRef(value);
  const inFlight = useRef<Pending[]>([]);
  const focusAfterRemoval = useRef(false);

  useEffect(() => {
    latest.current = value;
    // After a removal, the button that had focus is gone: hand focus to a stable control, once it is enabled again.
    if (focusAfterRemoval.current) {
      focusAfterRemoval.current = false;
      chooseButton.current?.focus();
    }
  }, [value]);

  useEffect(() => {
    inFlight.current = pending;
  }, [pending]);

  const importing = pending.length > 0;
  useEffect(() => {
    onBusyChange?.(importing);
  }, [importing, onBusyChange]);

  // Leaving the page stops the imports still running.
  useEffect(
    () => () => {
      for (const item of inFlight.current) item.controller.abort();
    },
    [],
  );

  useEffect(() => {
    if (pasteOpen) pasteArea.current?.focus();
  }, [pasteOpen]);

  const numbers = new Intl.NumberFormat(i18n.language);
  const percent = new Intl.NumberFormat(i18n.language, { style: "percent" });
  const maxSize = new Intl.NumberFormat(i18n.language, { style: "unit", unit: "megabyte", maximumFractionDigits: 0 }).format(
    CONTEXT_LIMITS.fileBytes / 1024 / 1024,
  );
  const remaining = CONTEXT_LIMITS.documents - value.length - pending.length;
  const full = remaining <= 0;
  const locked = disabled || full;

  const fail = (label: string, code: string) => {
    const key = nextKey.current++;
    setFailures((current) => [...current, { key, label, code: ERROR_CODES.has(code) ? code : "generic" }]);
  };

  const run = async (
    kind: Kind,
    label: string,
    task: (signal: AbortSignal, progress: (share: number) => void) => Promise<ContextDocument>,
  ) => {
    const key = nextKey.current++;
    const controller = new AbortController();
    setPending((current) => [...current, { key, kind, label, progress: kind === "file" ? 0 : null, controller }]);
    setAnnouncement(t("context.adding", { name: label }));
    const update = (progress: number | null) =>
      setPending((current) => current.map((item) => (item.key === key ? { ...item, progress } : item)));
    try {
      // Once the file is sent, the server still has to read it.
      const document = await task(controller.signal, (share) => update(share >= 1 ? null : share));
      const next = [...latest.current, document];
      latest.current = next;
      onChange(next);
      setAnnouncement(t("context.added", { name: document.name }));
    } catch (error) {
      if (controller.signal.aborted) return;
      fail(label, error instanceof ApiError ? error.code : "network");
      setAnnouncement(t("context.failed", { name: label }));
    } finally {
      setPending((current) => current.filter((item) => item.key !== key));
    }
  };

  const addFiles = (files: Iterable<File>) => {
    let slots = remaining;
    for (const file of files) {
      if (slots <= 0) {
        fail(file.name, "limit");
        continue;
      }
      if (!(CONTEXT_LIMITS.extensions as readonly string[]).includes(extensionOf(file.name))) {
        fail(file.name, "unsupported_type");
        continue;
      }
      if (file.size > CONTEXT_LIMITS.fileBytes) {
        fail(file.name, "too_large");
        continue;
      }
      slots--;
      run("file", file.name, (signal, progress) => contextApi.uploadFile(file, progress, signal));
    }
  };

  const addUrl = () => {
    const address = url.trim();
    if (!address || locked) return;
    setUrl("");
    run(isGithub(address) ? "github" : "url", address, (signal) => contextApi.addUrl(address, signal));
  };

  const closePaste = () => {
    setPasteOpen(false);
    pasteToggle.current?.focus();
  };

  const addText = () => {
    if (!pasteText.trim() || locked) return;
    const name = pasteName.trim() || t("context.pasteDefaultName");
    const text = pasteText;
    setPasteText("");
    setPasteName("");
    closePaste();
    run("text", name, (signal) => contextApi.addText(name, text, signal));
  };

  const remove = (document: ContextDocument) => {
    const next = latest.current.filter((item) => item.id !== document.id);
    latest.current = next;
    onChange(next);
    setAnnouncement(t("context.removed", { name: document.name }));
    focusAfterRemoval.current = true;
  };

  // Enter must add the address, not submit the form the picker sits in.
  const onEnter = (action: () => void) => (event: KeyboardEvent) => {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      action();
    }
  };

  const onPasteKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closePaste();
    }
  };

  const onDragOver = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = locked ? "none" : "copy";
    if (!locked) setDragging(true);
  };
  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (!locked) addFiles(event.dataTransfer.files);
  };

  const errorText = (code: string) =>
    code === "limit" ? t("context.limit", { max: CONTEXT_LIMITS.documents }) : t(`context.errors.${code}`, { size: maxSize });

  return (
    <fieldset className="context-picker" disabled={disabled} aria-describedby={`${id}-note`}>
      <legend className="context-legend">
        <span className="field-label">{t("context.title")}</span>
        <span className="field-hint">{t("context.count", { used: value.length, max: CONTEXT_LIMITS.documents })}</span>
      </legend>
      <p className="field-hint context-lead">{t("context.lead")}</p>

      {/* biome-ignore lint/a11y/noStaticElementInteractions: dropping is a shortcut; the button inside does the same from the keyboard. */}
      <div
        className="context-drop"
        data-dragging={dragging}
        data-locked={locked}
        onDragEnter={onDragOver}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <UploadGlyph />
        <span className="context-drop-text">{t("context.drop")}</span>
        <button
          ref={chooseButton}
          type="button"
          className="button button-secondary"
          onClick={() => fileInput.current?.click()}
          disabled={locked}
        >
          {t("context.choose")}
        </button>
        <span className="field-hint">{t("context.fileTypes", { size: maxSize })}</span>
        <input
          ref={fileInput}
          type="file"
          accept={CONTEXT_LIMITS.extensions.join(",")}
          multiple
          hidden
          tabIndex={-1}
          onChange={(event) => {
            if (event.target.files) addFiles(Array.from(event.target.files));
            event.target.value = "";
          }}
        />
      </div>

      <div className="field">
        <label className="field-hint" htmlFor={`${id}-url`}>
          {t("context.urlLabel")}
        </label>
        <div className="context-url-row">
          <input
            id={`${id}-url`}
            className="input"
            type="text"
            inputMode="url"
            autoComplete="url"
            autoCapitalize="off"
            spellCheck={false}
            dir="ltr"
            placeholder={t("context.urlPlaceholder")}
            aria-describedby={`${id}-url-hint`}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={onEnter(addUrl)}
            disabled={locked}
          />
          <button type="button" className="button button-secondary" onClick={addUrl} disabled={locked || !url.trim()}>
            {t("context.addUrl")}
          </button>
        </div>
        <span id={`${id}-url-hint`} className="field-hint">
          {t("context.urlHint")}
        </span>
      </div>

      <div className="context-paste-block">
        <button
          ref={pasteToggle}
          type="button"
          className="button button-quiet"
          aria-expanded={pasteOpen}
          aria-controls={`${id}-paste`}
          onClick={() => setPasteOpen((open) => !open)}
          disabled={locked && !pasteOpen}
        >
          <KindIcon kind="text" />
          {t("context.paste")}
        </button>
        {pasteOpen ? (
          // biome-ignore lint/a11y/noStaticElementInteractions: Escape closes the panel from any of its fields.
          <div id={`${id}-paste`} className="context-paste" onKeyDown={onPasteKey}>
            <div className="field">
              <label className="field-hint" htmlFor={`${id}-paste-name`}>
                {t("context.pasteName")}
              </label>
              <input
                id={`${id}-paste-name`}
                className="input"
                type="text"
                maxLength={200}
                dir="auto"
                placeholder={t("context.pasteNamePlaceholder")}
                value={pasteName}
                onChange={(event) => setPasteName(event.target.value)}
                onKeyDown={onEnter(() => pasteArea.current?.focus())}
              />
            </div>
            <div className="field">
              <label className="field-hint" htmlFor={`${id}-paste-text`}>
                {t("context.pasteText")}
              </label>
              <textarea
                id={`${id}-paste-text`}
                ref={pasteArea}
                className="textarea"
                rows={6}
                dir="auto"
                value={pasteText}
                onChange={(event) => setPasteText(event.target.value)}
              />
            </div>
            <div className="row">
              <button type="button" className="button button-secondary" onClick={addText} disabled={locked || !pasteText.trim()}>
                {t("context.addText")}
              </button>
              <button type="button" className="button button-quiet" onClick={closePaste}>
                {t("context.cancel")}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {value.length + pending.length + failures.length > 0 ? (
        <ul className="context-list" aria-label={t("context.listLabel")}>
          {value.map((document) => {
            const previewId = `${id}-preview-${document.id}`;
            const open = openPreview === document.id;
            return (
              <li key={document.id} className="context-item">
                <div className="context-item-main">
                  <span className="context-kind" title={t(`context.kind.${document.kind}`)}>
                    <KindIcon kind={document.kind} />
                    <span className="visually-hidden">{t(`context.kind.${document.kind}`)}</span>
                  </span>
                  <span className="context-name" dir="auto" title={document.source ?? document.name}>
                    {document.name}
                  </span>
                  <span className="context-size">{t("context.characters", { size: numbers.format(document.text.length) })}</span>
                  <span className="context-actions">
                    <button
                      type="button"
                      className="context-action"
                      aria-expanded={open}
                      aria-controls={previewId}
                      onClick={() => setOpenPreview(open ? null : document.id)}
                    >
                      {open ? t("context.hidePreview") : t("context.preview")}
                    </button>
                    <button
                      type="button"
                      className="context-action context-icon-action"
                      aria-label={t("context.remove", { name: document.name })}
                      title={t("context.remove", { name: document.name })}
                      onClick={() => remove(document)}
                    >
                      <CloseGlyph />
                    </button>
                  </span>
                </div>
                {document.truncated ? <p className="context-truncated">{t("context.truncated")}</p> : null}
                {open ? (
                  <section id={previewId} aria-label={t("context.previewLabel", { name: document.name })}>
                    <pre className="context-preview" dir="auto">
                      {preview(document.text)}
                    </pre>
                  </section>
                ) : null}
              </li>
            );
          })}
          {pending.map((item) => (
            <li key={`pending-${item.key}`} className="context-item" aria-busy="true">
              <div className="context-item-main">
                <span className="context-kind">
                  <span className="context-spinner" aria-hidden="true" />
                </span>
                <span className="context-name" dir="auto" title={item.label}>
                  {item.label}
                </span>
                <span className="context-size">
                  {item.progress !== null
                    ? t("context.uploading", { percent: percent.format(item.progress) })
                    : item.kind === "file" || item.kind === "text"
                      ? t("context.reading")
                      : t("context.fetching")}
                </span>
                <span className="context-actions">
                  <button
                    type="button"
                    className="context-action context-icon-action"
                    aria-label={t("context.stop", { name: item.label })}
                    title={t("context.stop", { name: item.label })}
                    onClick={() => item.controller.abort()}
                  >
                    <CloseGlyph />
                  </button>
                </span>
              </div>
              {item.progress !== null ? (
                <progress
                  className="context-progress"
                  max={1}
                  value={item.progress}
                  aria-label={t("context.adding", { name: item.label })}
                />
              ) : null}
            </li>
          ))}
          {failures.map((failure) => (
            <li key={`failure-${failure.key}`} className="context-item context-item-error">
              <div className="context-item-main">
                <span className="context-kind">
                  <WarningIcon />
                </span>
                <span className="context-name" dir="auto" title={failure.label}>
                  {failure.label}
                </span>
                <span className="context-actions">
                  <button
                    type="button"
                    className="context-action context-icon-action"
                    aria-label={t("context.dismiss")}
                    title={t("context.dismiss")}
                    onClick={() => setFailures((current) => current.filter((item) => item.key !== failure.key))}
                  >
                    <CloseGlyph />
                  </button>
                </span>
              </div>
              <p className="context-error" role="alert">
                {errorText(failure.code)}
              </p>
            </li>
          ))}
        </ul>
      ) : null}

      {full ? <p className="field-hint context-full">{t("context.limit", { max: CONTEXT_LIMITS.documents })}</p> : null}
      <p id={`${id}-note`} className="context-note">
        {t("context.privacy")}
      </p>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </fieldset>
  );
}
