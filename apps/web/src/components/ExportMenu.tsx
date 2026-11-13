import { type KeyboardEvent, type MouseEvent, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DownloadIcon } from "./Icons.tsx";
import { Mark } from "./Logo.tsx";

type ExportKey = "markdown" | "pdf" | "word" | "adr" | "handoff" | "jira" | "linear" | "github" | "proposalWord" | "proposalPdf";
type Audience = "cto" | "executive" | "client";

interface ExportItem {
  key: ExportKey | `brief-${Audience}`;
  /** Set for reader versions, whose label names the reader. */
  label?: string;
  hint?: string;
  path: string;
  /** Opens in a new tab instead of downloading: the PDF goes through the browser's print dialog. */
  newTab?: boolean;
  needsVerdict?: boolean;
  /** A zip the server builds on request: it can take seconds, so the entry shows its preparation. */
  archive?: boolean;
  /** A document for the client: it names the client, when the agency did. */
  forClient?: boolean;
}

const ITEMS: ExportItem[] = [
  { key: "markdown", path: "report.md" },
  { key: "pdf", path: "report.html?print=1", newTab: true },
  { key: "word", path: "report.docx" },
  { key: "adr", path: "adr.md", needsVerdict: true },
  { key: "handoff", path: "handoff.zip", needsVerdict: true, archive: true },
  { key: "proposalWord", path: "proposal.docx", needsVerdict: true, forClient: true },
  { key: "proposalPdf", path: "proposal.html?print=1", newTab: true, needsVerdict: true, forClient: true },
  // The roadmap for issue trackers.
  { key: "jira", path: "jira.csv", needsVerdict: true },
  { key: "linear", path: "linear.csv", needsVerdict: true },
  { key: "github", path: "github-issues.zip", needsVerdict: true, archive: true },
];

/** What an audit exports: its report, in each format. */
const AUDIT_EXPORTS: ExportKey[] = ["markdown", "pdf", "word"];

/** The file name the server gave the download, or the last part of its path. */
function fileNameOf(response: Response, path: string) {
  const header = response.headers.get("content-disposition") ?? "";
  const quoted = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header)?.[1];
  if (quoted) {
    try {
      return decodeURIComponent(quoted);
    } catch {
      return quoted;
    }
  }
  return path.split("?")[0]?.split("/").pop() ?? "download";
}

const ChevronIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d="M6.5 9.5L12 15l5.5-5.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const NewTabIcon = () => (
  <svg
    className="flip-rtl"
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    aria-hidden="true"
  >
    <path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * The "Export" disclosure of a session: a menu button following the WAI-ARIA pattern (arrow keys,
 * Home and End move between items, Escape closes and returns focus to the button, Tab leaves).
 */
export function ExportMenu({
  sessionId,
  hasVerdict,
  briefs = [],
  revision = null,
  client = null,
  audit = false,
}: {
  sessionId: string;
  hasVerdict: boolean;
  briefs?: Audience[];
  /** An earlier revision of the verdict on screen: every document is that revision's. */
  revision?: number | null;
  /** Who the client proposal is prepared for. */
  client?: string | null;
  /** An audit: its report in each format, without the documents of a decision (ADR, hand-off, client proposal, roadmap). */
  audit?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [initial, setInitial] = useState<"first" | "last">("first");
  // The archive being built and the one that could not be: shown on its entry, which stays where the focus is.
  const [preparing, setPreparing] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const base = `/api/sessions/${encodeURIComponent(sessionId)}`;
  // The reader versions already written in the app, as printable documents.
  const entries: ExportItem[] = [
    ...(audit ? ITEMS.filter((item) => AUDIT_EXPORTS.includes(item.key as ExportKey)) : ITEMS),
    ...briefs.map((audience) => ({
      key: `brief-${audience}` as const,
      path: `report.html?print=1&audience=${audience}`,
      newTab: true,
      label: t("export.briefPdf", { audience: t(`brief.audience.${audience}`) }),
      hint: t("export.briefPdfHint"),
    })),
  ];

  const hrefOf = (item: ExportItem) => {
    const query = new URLSearchParams();
    if (revision !== null) query.set("revision", String(revision));
    if (item.forClient && client) query.set("client", client);
    const extra = query.toString();
    return extra ? `${base}/${item.path}${item.path.includes("?") ? "&" : "?"}${extra}` : `${base}/${item.path}`;
  };

  // An archive is fetched, then handed to the browser as a file: the entry has something to show meanwhile.
  const prepare = async (event: MouseEvent<HTMLAnchorElement>, item: ExportItem) => {
    event.preventDefault();
    if (preparing) return;
    setPreparing(item.key);
    setFailed(null);
    try {
      const response = await fetch(hrefOf(item));
      if (!response.ok) throw new Error(String(response.status));
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = fileNameOf(response, item.path);
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setPreparing(null);
      close(true);
    } catch {
      setPreparing(null);
      setFailed(item.key);
    }
  };

  const items = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  const focusAt = (index: number) => {
    const list = items();
    if (list.length > 0) list[(index + list.length) % list.length]?.focus();
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: focusAt reads the DOM and only has to run when the menu opens.
  useEffect(() => {
    if (!open) return;
    focusAt(initial === "first" ? 0 : -1);
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open, initial]);

  const show = (at: "first" | "last") => {
    setInitial(at);
    setOpen(true);
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  const onButtonKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      show(event.key === "ArrowDown" ? "first" : "last");
    }
  };

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const current = list.indexOf(document.activeElement as HTMLElement);
    const moves: Record<string, number> = { ArrowDown: current + 1, ArrowUp: current - 1, Home: 0, End: list.length - 1 };
    if (event.key in moves) {
      event.preventDefault();
      focusAt(moves[event.key] as number);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") {
      close(false);
    }
  };

  return (
    <div className="export-menu" ref={root}>
      <button
        ref={button}
        type="button"
        className="button button-secondary"
        id={`${id}-button`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={`${id}-menu`}
        onClick={() => (open ? close(false) : show("first"))}
        onKeyDown={onButtonKey}
      >
        <DownloadIcon />
        {t("export.button")}
        <ChevronIcon />
      </button>
      {open ? (
        <div
          ref={menu}
          id={`${id}-menu`}
          role="menu"
          aria-labelledby={`${id}-button`}
          className="export-list"
          onKeyDown={onMenuKey}
          tabIndex={-1}
        >
          {entries.map((item) => {
            const disabled = Boolean(item.needsVerdict && !hasVerdict);
            const hintId = `${id}-${item.key}-hint`;
            const content = (
              <>
                <span className="export-icon">
                  {preparing === item.key ? <Mark busy /> : item.newTab ? <NewTabIcon /> : <DownloadIcon />}
                </span>
                <span className="export-text">
                  <span className="export-label">
                    {item.label ?? t(`export.${item.key}`)}
                    {item.newTab ? <span className="visually-hidden"> ({t("export.newTab")})</span> : null}
                  </span>
                  <span className="export-hint" id={hintId} aria-live="polite">
                    {disabled
                      ? t("export.needsVerdict")
                      : preparing === item.key
                        ? t("common.preparing")
                        : failed === item.key
                          ? t("export.failed")
                          : (item.hint ?? t(`export.${item.key}Hint`))}
                  </span>
                </span>
              </>
            );
            return disabled ? (
              <span key={item.key} role="menuitem" tabIndex={-1} aria-disabled="true" aria-describedby={hintId} className="export-item">
                {content}
              </span>
            ) : (
              <a
                key={item.key}
                role="menuitem"
                tabIndex={-1}
                className="export-item"
                aria-describedby={hintId}
                href={hrefOf(item)}
                aria-busy={preparing === item.key || undefined}
                {...(item.newTab ? { target: "_blank", rel: "noopener" } : { download: "" })}
                onClick={(event) => (item.archive ? prepare(event, item) : close(true))}
              >
                {content}
              </a>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
