import type { Session } from "@quorumind/core";
import { totalCost } from "@quorumind/core/session";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "./api.ts";
import { RetryIcon } from "./components/Icons.tsx";
import { Debate } from "./Debate.tsx";
import { formatUsd } from "./format.ts";
import { Interview } from "./Interview.tsx";
import { Review } from "./Review.tsx";
import { useSession } from "./useSession.ts";
import { Verdict } from "./Verdict.tsx";

const STEPS = ["interview", "review", "debating", "complete"] as const;

function stepIndex(session: Session): number {
  if (session.phase === "failed") {
    if (!session.sheet) return 0;
    if (!session.sheetConfirmedAt) return 1;
    return 2;
  }
  if (session.phase === "awaiting_answers") return 2;
  return STEPS.indexOf(session.phase as (typeof STEPS)[number]);
}

export function SessionView({ id }: { id: string }) {
  const { t, i18n } = useTranslation();
  const { session, live, connected, missing } = useSession(id);
  const [retrying, setRetrying] = useState(false);

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
  const title = session.sheet?.projectName ?? session.idea;

  const retry = async () => {
    setRetrying(true);
    try {
      await api.resume(session.id);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div>
      <div className="session-head">
        <div className="row">
          {session.demo ? <span className="chip label">{t("demo.badge")}</span> : null}
          <span className="cost muted">
            <span>{t("cost.label")}</span>
            <span className="mono">{formatUsd(cost.usd, i18n.language)}</span>
            {session.budgetUsd !== null ? <span>({t("cost.cap", { cap: formatUsd(session.budgetUsd, i18n.language) })})</span> : null}
          </span>
        </div>
        <h1 className="display">{title}</h1>
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
        {!cost.complete ? <p className="field-hint">{t("cost.partial")}</p> : null}
        {!connected ? (
          <p className="notice" role="status">
            {t("error.network")}
          </p>
        ) : null}
      </div>

      {session.phase === "failed" ? (
        <div className="notice notice-error stack" role="alert" style={{ marginBlockEnd: "var(--space-8)" }}>
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

      {session.phase === "interview" || (session.phase === "failed" && !session.sheet) ? <Interview session={session} live={live} /> : null}
      {session.phase === "review" ? <Review session={session} /> : null}
      {session.phase === "complete" && session.verdict ? <Verdict session={session} /> : null}
      {session.debate.length > 0 || session.phase === "debating" ? <Debate session={session} live={live} /> : null}
    </div>
  );
}
