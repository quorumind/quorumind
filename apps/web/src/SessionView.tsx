import type { Session } from "@quorumind/core";
import { totalCost } from "@quorumind/core/session";
import { type KeyboardEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessions } from "./App.tsx";
import { api } from "./api.ts";
import { Costs } from "./Costs.tsx";
import { RetryIcon } from "./components/Icons.tsx";
import { Debate } from "./Debate.tsx";
import { formatUsd } from "./format.ts";
import { Interview } from "./Interview.tsx";
import { Review } from "./Review.tsx";
import { SheetView } from "./SheetView.tsx";
import { useSession } from "./useSession.ts";
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
  const { t, i18n } = useTranslation();
  const { session, live, connected, missing } = useSession(id);
  const { upsert } = useSessions();
  const [retrying, setRetrying] = useState(false);
  const [tab, setTab] = useState<Tab | null>(null);

  const phase = session?.phase;
  const title = session ? (session.sheet?.projectName ?? session.idea) : "";
  // Follow the session: each new phase opens the tab where things happen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the phase changes.
  useEffect(() => setTab(null), [phase]);
  useEffect(() => {
    if (session) upsert({ id: session.id, idea: title, phase: session.phase, updatedAt: session.updatedAt });
  }, [session, title, upsert]);

  if (missing) {
    return (
      <div className="narrow stack">
        <p className="notice notice-error">{t("common.notFound")}</p>
        <a href="#/">{t("common.back")}</a>
      </div>
    );
  }
  if (!session) return <p className="muted">{t("common.loading")}</p>;

  const current = stepIndex(session);
  const cost = totalCost(session);
  const tabs = availableTabs(session);
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
          <span className="cost muted">
            <span>{t("cost.label")}</span>
            <span className="mono">{formatUsd(cost.usd, i18n.language)}</span>
            {session.budgetUsd !== null ? <span>({t("cost.cap", { cap: formatUsd(session.budgetUsd, i18n.language) })})</span> : null}
          </span>
        </div>
        <h1 className="display">{title}</h1>
        {!connected ? (
          <p className="notice" role="status">
            {t("error.network")}
          </p>
        ) : null}
        {session.phase === "failed" ? (
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
        {active === "verdict" && session.verdict ? <Verdict session={session} /> : null}
        {active === "debate" ? <Debate session={session} live={live} /> : null}
        {active === "requirements" && session.sheet ? (
          session.phase === "review" ? (
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
