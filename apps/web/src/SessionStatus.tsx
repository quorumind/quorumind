import type { Session } from "@quorumind/core";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDownIcon, ArrowIcon, RetryIcon, WarningIcon } from "./components/Icons.tsx";
import { type DebateStep, debateWriters } from "./debateProgress.ts";
import type { LiveSpeech } from "./useSession.ts";

// Where a session stands, at the top of its page: the steps, the line saying what the debate does right now, the
// banners for what waits on the person (their answer, the verdict), and the connection when it drops.

export const STEPS = ["interview", "review", "debating", "complete"] as const;

/** The step a session is in, failed sessions included: where they stopped. */
export function stepIndex(session: Session): number {
  if (session.phase === "failed") {
    if (!session.sheet) return 0;
    if (!session.sheetConfirmedAt) return 1;
    return 2;
  }
  if (session.phase === "awaiting_answers") return 2;
  return STEPS.indexOf(session.phase as (typeof STEPS)[number]);
}

/** Whether something works on the session right now: the dot of its step breathes only then. */
export function isWorking(session: Session, live: LiveSpeech, connected: boolean): boolean {
  if (!connected) return false;
  if (session.phase === "debating" || Object.keys(live).length > 0) return true;
  if (session.phase !== "interview") return false;
  // The interviewer prepares its questions, unless they wait for the person's answers.
  const last = session.interview.at(-1);
  return !(last?.kind === "interviewer" && last.data.status === "ask");
}

/** The tab that shows what each step made: the interview, the requirements sheet, the debate, the verdict. */
const STEP_TABS = { interview: "interview", review: "requirements", debating: "debate", complete: "verdict" } as const;

/**
 * The four steps. The current one breathes only while something works on it; a debate waiting for the person names
 * that step "Your input" (for a reader it stays "Debate"), and a session that stopped marks its step as stopped, in
 * words and with an icon. A step reached opens its tab.
 */

export function Steps({
  session,
  working,
  yourTurn,
  tabs = [],
  active,
  onOpen,
}: {
  session: Session;
  working: boolean;
  /** The person is the one who answers the debate's questions: a waiting debate is their turn ("Your input"). */
  yourTurn: boolean;
  /** The tabs the session has, and the one shown: a step reached opens its tab, as the tabs below do. */
  tabs?: string[];
  active?: string;
  onOpen?: (tab: (typeof STEP_TABS)[keyof typeof STEP_TABS]) => void;
}) {
  const { t } = useTranslation();
  const current = stepIndex(session);
  return (
    <ol className="progress">
      {STEPS.map((step, index) => {
        const state =
          index < current
            ? "done"
            : index > current
              ? "todo"
              : session.phase === "failed"
                ? "failed"
                : session.phase === "awaiting_answers" && yourTurn
                  ? "waiting"
                  : "current";
        return (
          <li
            key={step}
            data-state={state}
            data-live={state === "current" && working ? "true" : undefined}
            aria-current={index === current ? "step" : undefined}
          >
            {state === "failed" ? (
              <span className="progress-icon">
                <WarningIcon />
              </span>
            ) : (
              <span className="progress-dot" aria-hidden="true" />
            )}
            {onOpen && index <= current && tabs.includes(STEP_TABS[step]) && STEP_TABS[step] !== active ? (
              <button type="button" className="progress-link" aria-controls="tab-panel" onClick={() => onOpen(STEP_TABS[step])}>
                {state === "waiting" ? t("phase.awaiting_answers") : t(`phase.${step}`)}
              </button>
            ) : state === "waiting" ? (
              t("phase.awaiting_answers")
            ) : (
              t(`phase.${step}`)
            )}
            {state === "failed" ? <span className="progress-flag">{t("phase.failed")}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The visible line under the steps while the debate runs: the step and round, then who writes. It is not a live
 * region: who writes changes often, and the page announces only each new step (SessionBody's announcer).
 */
export function DebateProgress({
  session,
  live,
  step,
  connected,
  waitsForPerson,
}: {
  session: Session;
  live: LiveSpeech;
  step: DebateStep | null;
  connected: boolean;
  /** The person answers the debate's question themselves: the banner says it, this line does not repeat it. */
  waitsForPerson: boolean;
}) {
  const { t, i18n } = useTranslation();
  if (session.phase === "awaiting_answers") {
    if (waitsForPerson) return null;
    return <p className="debate-progress">{t("progress.awaitingAuthor")}</p>;
  }
  if (!step) return null;
  // While the connection is down, what was being written is stale: the line keeps only the step.
  const writers = connected ? debateWriters(session, live, t, i18n.language) : "";
  return (
    <p className="debate-progress" data-stale={connected ? undefined : "true"}>
      <span className="debate-progress-step">{step.label}</span>
      {writers ? <span className="debate-progress-who">{t("debate.writingNow", { names: writers })}</span> : null}
    </p>
  );
}

/** A banner at the top of the session for what waits on the person, with the one action that takes them to it. */
export function WaitBanner({
  id,
  title,
  lead,
  action,
  onAction,
}: {
  id: string;
  title: string;
  lead: ReactNode;
  action: string;
  onAction: () => void;
}) {
  return (
    <section className="wait-banner" aria-labelledby={id}>
      <div className="wait-banner-text">
        <h2 className="title" id={id} tabIndex={-1} data-focus-target>
          {title}
        </h2>
        <p>{lead}</p>
      </div>
      <button type="button" className="button button-primary" onClick={onAction}>
        {action}
        {id === AWAITING_ID ? <ArrowDownIcon /> : <ArrowIcon />}
      </button>
    </section>
  );
}

export const AWAITING_ID = "awaiting-title";
export const VERDICT_READY_ID = "verdict-ready-title";

/**
 * The live events dropped: said over the page, without moving it, with a way to reconnect at once rather than wait for
 * the next attempt (up to half a minute).
 */
export function ConnectionBanner({ connected, onReconnect }: { connected: boolean; onReconnect?: (() => void) | undefined }) {
  const { t } = useTranslation();
  return (
    <div className="connection-banner" data-shown={connected ? undefined : "true"}>
      <span role="status">{connected ? "" : t("error.network")}</span>
      {!connected && onReconnect ? (
        <button type="button" className="button button-secondary" onClick={onReconnect}>
          <RetryIcon />
          {t("error.reconnect")}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Which ends of a row that scrolls sideways have more beyond them ("start", "end", both or neither): the row fades
 * there, so that tabs cut by the edge of a phone read as more to scroll to.
 */
export function useScrollEdges(node: HTMLElement | null): string {
  const [edges, setEdges] = useState("");
  useEffect(() => {
    if (!node) return;
    const update = () => {
      // In right-to-left, scrollLeft runs from 0 to negative values: its size is what counts.
      const offset = Math.abs(node.scrollLeft);
      const start = offset > 1;
      const end = offset + node.clientWidth < node.scrollWidth - 1;
      setEdges([start ? "start" : "", end ? "end" : ""].filter(Boolean).join(" "));
    };
    update();
    node.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(node);
    return () => {
      node.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [node]);
  return edges;
}
