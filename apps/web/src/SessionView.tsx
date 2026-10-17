import type { Session } from "@quorumind/core";
import { totalCost } from "@quorumind/core/session";
import { type KeyboardEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { navigate, useSessions } from "./App.tsx";
import { api, type Feedback, type Share } from "./api.ts";
import { Costs } from "./Costs.tsx";
import { RetryIcon } from "./components/Icons.tsx";
import { Loader, Skeleton } from "./components/Logo.tsx";
import { Debate } from "./Debate.tsx";
import { formatUsd } from "./format.ts";
import { Interview } from "./Interview.tsx";
import { Review } from "./Review.tsx";
import { SessionActions } from "./SessionActions.tsx";
import { SheetView } from "./SheetView.tsx";
import { type LiveSpeech, useSession } from "./useSession.ts";
import { Verdict } from "./Verdict.tsx";

const STEPS = ["interview", "review", "debating", "complete"] as const;
type Tab = "verdict" | "debate" | "requirements" | "interview" | "costs";

function stepIndex(session: Session): number {
  if (session.phase === "failed") {
    if (!session.sheet) return 0;
    if (!session.sheetConfirmedAt) return 1;
    return 2;
  }
  if (session.phase === "awaiting_answers") return 2;
  return STEPS.indexOf(session.phase as (typeof STEPS)[number]);
}

function availableTabs(session: Session): Tab[] {
  const tabs: Tab[] = [];
  if (session.verdict) tabs.push("verdict");
  if (session.debate.length > 0 || session.phase === "debating" || session.phase === "awaiting_answers") tabs.push("debate");
  if (session.sheet && (session.sheetConfirmedAt || session.phase === "review")) tabs.push("requirements");
  tabs.push("interview");
  if (session.usage.length > 0) tabs.push("costs");
  return tabs;
}

function defaultTab(session: Session): Tab {
  switch (session.phase) {
    case "interview":
      return "interview";
    case "review":
      return "requirements";
    case "debating":
    case "awaiting_answers":
      return "debate";
    case "complete":
      return "verdict";
    case "failed":
      return session.debate.length > 0 ? "debate" : session.sheet ? "requirements" : "interview";
  }
}

export function SessionView({ id }: { id: string }) {
  const { session, live, connected, missing } = useSession(id);
  const { upsert } = useSessions();
  const [extras, setExtras] = useState<{ share: Share | null; feedback: Feedback[] }>({ share: null, feedback: [] });
  const title = session ? (session.sheet?.projectName ?? session.idea) : "";
  useEffect(() => {
    if (session) upsert({ id: session.id, idea: title, phase: session.phase, updatedAt: session.updatedAt });
  }, [session, title, upsert]);
  useEffect(() => {
    api.session(id).then(
      (body) => setExtras({ share: body.share, feedback: body.feedback }),
      () => undefined,
    );
  }, [id]);
  return (
    <SessionBody
      session={session}
      live={live}
      connected={connected}
      missing={missing}
      share={extras.share}
      onShare={(share) => setExtras((current) => ({ ...current, share }))}
      feedback={extras.feedback}
    />
  );
}

/** A session someone shared: read-only, without costs or attached documents. */
export function SharedView({ token }: { token: string }) {
  const { t } = useTranslation();
  const [session, setSession] = useState<Session | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    api.shared(token).then(
      (body) => setSession(body.session),
      () => setMissing(true),
    );
  }, [token]);
  return (
    <div className="stack">
      <p className="notice">{t("share.readOnly")}</p>
      <SessionBody session={session} live={{}} connected missing={missing} readOnly reportUrl={api.sharedReportUrl(token)} />
    </div>
  );
}

function SessionBody({
  session,
  live,
  connected,
  missing,
  readOnly = false,
  share = null,
  onShare,
  feedback = [],
  reportUrl,
}: {
  session: Session | null;
  live: LiveSpeech;
  connected: boolean;
  missing: boolean;
  readOnly?: boolean;
  share?: Share | null;
  onShare?: (share: Share | null) => void;
  feedback?: Feedback[];
  reportUrl?: string;
}) {
  const { t, i18n } = useTranslation();
  const [retrying, setRetrying] = useState(false);
  const [tab, setTab] = useState<Tab | null>(null);

  const phase = session?.phase;
  const title = session ? (session.sheet?.projectName ?? session.idea) : "";
  // Follow the session: each new phase opens the tab where things happen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the phase changes.
  useEffect(() => setTab(null), [phase]);

  if (missing) {
    return (
      <div className="narrow stack">
        <p className="notice notice-error">{t("common.notFound")}</p>
        <a href="#/">{t("common.back")}</a>
      </div>
    );
  }
  if (!session) {
    return (
      <div className="session-skeleton stack-lg">
        <Loader label={t("common.loading")} />
        <Skeleton lines={2} />
        <Skeleton lines={4} card />
        <Skeleton lines={3} card />
      </div>
    );
  }

  const current = stepIndex(session);
  const cost = totalCost(session);
  const tabs = availableTabs(session).filter((name) => !readOnly || name !== "costs");
  const active = tab && tabs.includes(tab) ? tab : defaultTab(session);

  const retry = async () => {
    setRetrying(true);
    try {
      await api.resume(session.id);
    } finally {
      setRetrying(false);
    }
  };

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = tabs.indexOf(active);
    const rtl = document.documentElement.dir === "rtl";
    const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1, Home: -index, End: tabs.length - 1 - index }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = tabs[(index + step + tabs.length) % tabs.length] as Tab;
    setTab(next);
    document.getElementById(`tab-${next}`)?.focus();
  };

  return (
    <div className="session">
      <div className="session-head">
        <div className="row session-meta-row">
          {session.demo ? <span className="chip label">{t("demo.badge")}</span> : null}
          {session.mode !== "standard" ? <span className="chip label">{t(`setup.mode.${session.mode}`)}</span> : null}
          <ol className="progress">
            {STEPS.map((step, index) => (
              <li
                key={step}
                data-state={index < current ? "done" : index === current ? "current" : "todo"}
                aria-current={index === current ? "step" : undefined}
              >
                {t(`phase.${step}`)}
              </li>
            ))}
          </ol>
          {readOnly ? null : (
            <span className="cost muted">
              <span>{t("cost.label")}</span>
              <span className="mono">{formatUsd(cost.usd, i18n.language)}</span>
              {session.budgetUsd !== null ? <span>({t("cost.cap", { cap: formatUsd(session.budgetUsd, i18n.language) })})</span> : null}
            </span>
          )}
        </div>
        <div className="session-title-row">
          <h1 className="display">{title}</h1>
          {readOnly ? null : <SessionActions session={session} share={share} onShare={onShare ?? (() => undefined)} />}
        </div>
        {session.parentId && !readOnly ? (
          <p className="field-hint" style={{ margin: 0 }}>
            <a href={`#/s/${session.parentId}`} onClick={() => navigate(`s/${session.parentId}`)}>
              {t("session.fromEarlier")}
            </a>
          </p>
        ) : null}
        {!connected ? (
          <p className="notice" role="status">
            {t("error.network")}
          </p>
        ) : null}
        {session.phase === "failed" && !readOnly ? (
          <div className="notice notice-error stack" role="alert">
            <strong>{t("error.title")}</strong>
            <span>
              {t(`error.${session.error?.code ?? "internal_error"}`)} <span className="muted">{session.error?.message}</span>
            </span>
            <div>
              <button type="button" className="button button-secondary" onClick={retry} disabled={retrying}>
                <RetryIcon />
                {t("error.retry")}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {tabs.length > 1 ? (
        <div className="tabs" role="tablist" aria-label={title}>
          {tabs.map((name) => (
            <button
              key={name}
              id={`tab-${name}`}
              type="button"
              role="tab"
              aria-selected={name === active}
              aria-controls="tab-panel"
              tabIndex={name === active ? 0 : -1}
              className="tab"
              onClick={() => setTab(name)}
              onKeyDown={onTabKey}
            >
              {t(`tabs.${name}`)}
            </button>
          ))}
        </div>
      ) : null}

      <div id="tab-panel" {...(tabs.length > 1 ? { role: "tabpanel", "aria-labelledby": `tab-${active}` } : {})}>
        {active === "verdict" && session.verdict ? (
          <Verdict session={session} readOnly={readOnly} feedback={feedback} {...(reportUrl ? { reportUrl } : {})} />
        ) : null}
        {active === "debate" ? <Debate session={session} live={live} /> : null}
        {active === "requirements" && session.sheet ? (
          session.phase === "review" && !readOnly ? (
            <Review session={session} />
          ) : (
            <SheetView sheet={session.sheet} />
          )
        ) : null}
        {active === "interview" ? <Interview session={session} live={live} /> : null}
        {active === "costs" ? <Costs session={session} /> : null}
      </div>
    </div>
  );
}
