import type { Session } from "@quorumind/core";
import { totalCost } from "@quorumind/core/session";
import { type KeyboardEvent, type ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { navigate, replaceRoute, useSessions } from "./App.tsx";
import { AccessContext, AccessLine, FULL_ACCESS } from "./access.tsx";
import { ApiError, api, type Feedback, MAX_BUDGET_USD, type PriceQuote, type SessionAccess, type Share } from "./api.ts";
import { capOf, capRange, MIN_BUDGET_USD } from "./budget.ts";
import { Costs } from "./Costs.tsx";
import { BusyButton } from "./components/BusyButton.tsx";
import { focusIsFree, focusTarget } from "./components/focus.ts";
import { PlusIcon, RetryIcon } from "./components/Icons.tsx";
import { Skeleton } from "./components/Logo.tsx";
import { consumeNavigation, PageHeading } from "./components/Page.tsx";
import { FeedConnected } from "./components/RevisionStatus.tsx";
import { Debate, QUESTIONS_ID } from "./Debate.tsx";
import { type DebateStep, debateStep } from "./debateProgress.ts";
import { failurePlace, failureText, sessionErrorText } from "./errors.ts";
import { formatPrice, formatUsd } from "./format.ts";
import { Interview } from "./Interview.tsx";
import { Review } from "./Review.tsx";
import { SessionActions } from "./SessionActions.tsx";
import {
  AWAITING_ID,
  ConnectionBanner,
  DebateProgress,
  isWorking,
  Steps,
  useScrollEdges,
  VERDICT_READY_ID,
  WaitBanner,
} from "./SessionStatus.tsx";
import { SheetView } from "./SheetView.tsx";
import { type LiveSpeech, useSession } from "./useSession.ts";
import { useSessionDetails } from "./useSessionDetails.ts";
import { Verdict } from "./Verdict.tsx";

type Tab = "verdict" | "debate" | "requirements" | "interview" | "costs";
const TABS: Tab[] = ["verdict", "debate", "requirements", "interview", "costs"];
const asTab = (value: string | undefined): Tab | null => (TABS.includes(value as Tab) ? (value as Tab) : null);

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

/**
 * The page on its way, in the page's own shape (meta line, title, tabs, panel) so that nothing jumps when it
 * arrives. The label is for screen readers: the shapes say "loading" to everyone else.
 */
export function SessionSkeleton({ label }: { label: string }) {
  return (
    <div className="session session-skeleton" aria-busy="true">
      <p className="visually-hidden" role="status">
        {label}
      </p>
      <div className="session-head" aria-hidden="true">
        <div className="row session-meta-row">
          <span className="skeleton-line skeleton-progress" />
          <span className="skeleton-line skeleton-cost" />
        </div>
        <div className="session-title-row">
          <span className="skeleton-line skeleton-title" />
        </div>
      </div>
      <div className="tabs" aria-hidden="true">
        {["a", "b", "c", "d"].map((key) => (
          <span key={key} className="tab skeleton-tab">
            <span className="skeleton-line" />
          </span>
        ))}
      </div>
      <div aria-hidden="true" className="stack-lg">
        <Skeleton lines={4} card />
        <Skeleton lines={3} card />
      </div>
    </div>
  );
}

/** The content entrances of a first showing: items of a tab that was already shown are settled, not replayed. */
const TAB_ENTRANCES = ".question, .priority, .map-topic";

/**
 * The panel of the tab shown. When a tab is shown again (the person went elsewhere and came back), what its content
 * already holds is marked `data-settled` before the first paint and stands at rest; a question, a priority or a topic
 * that arrives afterwards still comes in (CSS skips only [data-settled]).
 */
export function TabPanel({ tab, tabbed, children }: { tab: Tab; tabbed: boolean; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const visited = useRef(new Set<Tab>());
  useLayoutEffect(() => {
    if (visited.current.has(tab)) {
      for (const item of panel.current?.querySelectorAll(TAB_ENTRANCES) ?? []) item.setAttribute("data-settled", "true");
    }
    visited.current.add(tab);
  }, [tab]);
  return (
    <div ref={panel} id="tab-panel" {...(tabbed ? { role: "tabpanel", "aria-labelledby": `tab-${tab}` } : {})}>
      {children}
    </div>
  );
}

/** `tab`: the tab in the address (#/s/<id>/<tab>); without it, the tab of the session's phase. */
export function SessionView({ id, tab }: { id: string; tab?: string | undefined }) {
  const { session, live, connected, missing, reconnect } = useSession(id);
  const { upsert } = useSessions();
  const { details, failed, retry, update } = useSessionDetails(id, session);
  const title = session ? sessionTitle(session) : "";
  useEffect(() => {
    if (session) upsert({ id: session.id, idea: title, phase: session.phase, updatedAt: session.updatedAt });
  }, [session, title, upsert]);
  const onShare = useCallback((share: Share | null) => update({ share }), [update]);
  const onAccess = useCallback((access: SessionAccess) => update({ access }), [update]);
  const onTabChange = useCallback((next: Tab | null) => replaceRoute(next ? `s/${id}/${next}` : `s/${id}`), [id]);
  if (missing) return <SessionMissing id={id} />;
  // Read-only until the server says what this person may do with the session; if it cannot be asked, the page says so.
  return (
    <AccessContext.Provider value={details?.access ?? PENDING_ACCESS}>
      <SessionBody
        session={session}
        live={live}
        connected={connected}
        onReconnect={reconnect}
        routeTab={tab}
        onTabChange={onTabChange}
        share={details?.share ?? null}
        onShare={onShare}
        onAccess={onAccess}
        feedback={details?.feedback ?? NO_FEEDBACK}
        price={details?.price ?? null}
        revisionPrice={details?.revisionPrice ?? null}
        // Known once the details are loaded: a hosted session never shows a provider cost, even briefly.
        providerCosts={details?.providerCosts ?? false}
        detailsFailed={failed && details === null}
        accessKnown={details !== null}
        onRetryDetails={retry}
      />
    </AccessContext.Provider>
  );
}

/**
 * A session that cannot be opened, said as a page of its own. Its server tells a member of its workspace that it is
 * private (ask its author); anyone else learns only that there is nothing at this address.
 */
function SessionMissing({ id }: { id: string }) {
  const { t } = useTranslation();
  const { shared } = useSessions();
  const [reason, setReason] = useState<"private" | "missing" | null>(null);
  useEffect(() => {
    let live = true;
    api.session(id).then(
      () => live && setReason("missing"),
      (caught) => live && setReason(caught instanceof ApiError && caught.code === "private_session" ? "private" : "missing"),
    );
    return () => {
      live = false;
    };
  }, [id]);
  if (!reason) return <SessionSkeleton label={t("common.loading")} />;
  return (
    <div className="narrow stack-lg not-found">
      <div className="stack">
        <PageHeading title={reason === "private" ? t("notFound.privateTitle") : t("notFound.sessionTitle")} />
        <p className="lead">
          {reason === "private" ? t("notFound.privateLead") : shared ? t("notFound.sessionLeadShared") : t("notFound.sessionLead")}
        </p>
      </div>
      <div className="row">
        <a className="button button-primary" href="#/sessions">
          {t("notFound.debates")}
        </a>
        <a className="button button-secondary" href="#/">
          <PlusIcon />
          {t("notFound.newDebate")}
        </a>
      </div>
    </div>
  );
}

/** While the server has not said what the person may do: their own session, read-only for now. */
const PENDING_ACCESS: SessionAccess = { ...FULL_ACCESS, canEdit: false };
const NO_FEEDBACK: Feedback[] = [];

/** The name of a session: its project's, or the idea it started from. */
export const sessionTitle = (session: Session) => session.sheet?.projectName?.trim() || session.idea;

export type { Tab as SessionTab };

/**
 * After the debate stopped or failed, when the keyboard was on what went away (the Stop button): its Retry button, the
 * next thing the person may want, else the page's heading. A focused button says only its name, so the alert above it
 * is not read twice. The stop's dialog may still be open when the failure arrives (its button, disabled while the stop
 * is sent, already dropped the focus): nothing outside a modal dialog can take the focus, so it is placed once the
 * dialog closed, since the button the dialog would give it back to is gone. A person who went elsewhere keeps their place.
 */
function focusAfterFailure() {
  const dialog = document.querySelector("dialog[open]");
  const place = () => {
    // The person left the page before the dialog closed: its page is gone, and so is the reason to move the focus.
    if (dialog && !dialog.isConnected) return;
    // Left on a button of the closed dialog, the focus is nowhere the person can see.
    if (!focusIsFree() && !dialog?.contains(document.activeElement)) return;
    const retry = document.querySelector<HTMLElement>("[data-retry]");
    if (retry) retry.focus();
    else {
      const heading = document.querySelector<HTMLElement>("h1[tabindex='-1']");
      if (heading) focusTarget(heading);
    }
  };
  // After the dialog's own handler, which gives the focus back to its opener when that is still there.
  if (dialog) dialog.addEventListener("close", () => setTimeout(place), { once: true });
  else place();
}

/** The body of a session page: its header, its tabs and the tab shown. Read-only for a share link. */
export function SessionBody({
  session,
  live,
  connected,
  onReconnect,
  routeTab,
  onTabChange,
  readOnly = false,
  share = null,
  onShare,
  onAccess,
  feedback = [],
  reportUrl,
  price = null,
  revisionPrice = null,
  providerCosts = true,
  detailsFailed = false,
  onRetryDetails,
  accessKnown = true,
}: {
  session: Session | null;
  live: LiveSpeech;
  connected: boolean;
  /** Opens the live events again at once, instead of waiting for the next attempt. */
  onReconnect?: () => void;
  /** The tab the address names, if any: shown when the session has it, the phase's own tab otherwise. */
  routeTab?: string | undefined;
  /** The person chose a tab (null: the phase's own), for the address to say it. */
  onTabChange?: (tab: Tab | null) => void;
  readOnly?: boolean;
  share?: Share | null;
  onShare?: (share: Share | null) => void;
  /** The author made the session private, or shared it with their workspace again. */
  onAccess?: (access: SessionAccess) => void;
  feedback?: Feedback[];
  reportUrl?: string;
  /** The price the host sells this debate at, shown instead of its provider cost. */
  price?: PriceQuote | null;
  /** The price of the next revision of the verdict, on the button that makes it. */
  revisionPrice?: PriceQuote | null;
  /** False when provider costs are not shown (the host sets a price of its own). */
  providerCosts?: boolean;
  /** What the person may do with the session could not be loaded yet: it is shown read-only meanwhile. */
  detailsFailed?: boolean;
  onRetryDetails?: () => void;
  /** False until the server said what this person may do: "your" turn or the author's is not said meanwhile. */
  accessKnown?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const access = useContext(AccessContext);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [newCap, setNewCap] = useState("");
  const [newCapBad, setNewCapBad] = useState(false);
  // The tab the person chose, null for the one of the phase. The address names it, so a reload or a link opens it.
  const [tab, setTab] = useState<Tab | null>(() => asTab(routeTab));
  const requested = useRef(asTab(routeTab));
  requested.current = asTab(routeTab);
  // A tab this session has, for whoever reads it.
  const usable = (name: Tab | null) =>
    name !== null && session !== null && availableTabs(session).some((one) => one === name && (!readOnly || one !== "costs"));
  // The verdict arrived while the person read another tab they had chosen: they are told, not moved.
  const [verdictReady, setVerdictReady] = useState(false);
  // Where the person asked to go from a banner, done once the tab that holds it is shown.
  const [jump, setJump] = useState<"question" | "verdict" | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [tabList, setTabList] = useState<HTMLDivElement | null>(null);
  const tabEdges = useScrollEdges(tabList);

  const phase = session?.phase;
  // The verdict has just been rendered while this page was open (the phase turned "complete" under the reader's eyes),
  // not found there on opening or on a return to its tab: only the first plays an entrance.
  const phaseSeen = useRef(phase);
  const verdictArrived = useRef(false);
  if (phaseSeen.current !== phase) {
    verdictArrived.current = phaseSeen.current !== undefined && phase === "complete";
    phaseSeen.current = phase;
  }
  const title = session ? sessionTitle(session) : "";
  const canAnswer = !readOnly && access.canEdit;
  // The step shown and announced: the furthest the debate reached in this phase. Between a role's last word and its
  // saved entry, or after a reconnection (nobody writing yet), what is computed may lag: it never takes the line back.
  const computed = session ? debateStep(session, live, t) : null;
  const furthest = useRef<{ phase: typeof phase; step: DebateStep | null }>({ phase: undefined, step: null });
  if (furthest.current.phase !== phase) furthest.current = { phase, step: null };
  if (computed && (!furthest.current.step || computed.order >= furthest.current.step.order)) furthest.current.step = computed;
  const step = computed ? furthest.current.step : null;
  // One polite voice: the same words said again (a second question) are changed invisibly so that they are heard.
  const announce = useCallback((text: string) => setAnnouncement((current) => (current === text ? `${text}\u00a0` : text)), []);

  // Each new phase opens the tab where things happen, unless the debate stopped on its own (for a question or its
  // verdict) while the person read a tab they had chosen: then a banner says so and the tab stays.
  const previousPhase = useRef(phase);
  // The order of the last step announced: undefined until a first one is seen (the page just opened: not news), null
  // once a new phase began (its first step is news).
  const lastAnnounced = useRef<number | null | undefined>(undefined);
  const arrived = useRef<{ phase: NonNullable<typeof phase>; from: typeof phase; wait: boolean } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a change of phase counts, read with the tab chosen then.
  useEffect(() => {
    const from = previousPhase.current;
    previousPhase.current = phase;
    const kept = from !== undefined && tab !== null && (phase === "complete" || phase === "awaiting_answers");
    // On opening, the tab the address names, unless it is the phase's own anyway, unknown, or one this session does not
    // have: the address then drops it, in place.
    const wanted = requested.current;
    const opened = from === undefined && session && wanted !== defaultTab(session) && usable(wanted) ? wanted : null;
    // Nothing to choose until the session is there: the tab of the address waits for it.
    if (!kept && phase !== undefined) setTab(opened);
    if (from === undefined && phase !== undefined && routeTab !== undefined && opened === null) tabChanged.current?.(null);
    // A new phase starts its steps afresh (the revisions after an answer, a retry): its first step is news.
    if (from !== undefined && from !== phase) lastAnnounced.current = null;
    const ready = kept && phase === "complete" && tab !== "verdict";
    setVerdictReady(ready);
    setJump(null);
    // A first load is not a change: the page's heading has the focus after a navigation, and nothing is announced.
    // What follows waits for the next render when this one still shows the old tab or not yet the verdict's banner.
    arrived.current = phase && from !== undefined && from !== phase ? { phase, from, wait: (!kept && tab !== null) || ready } : null;
  }, [phase]);

  // Once the new phase is on screen: the focus goes to what appeared if the person's own focus went away with what
  // disappeared (the button they pressed), without scrolling; otherwise the change is announced, politely, once.
  useEffect(() => {
    const change = arrived.current;
    if (!change) return;
    if (change.wait) {
      change.wait = false;
      return;
    }
    arrived.current = null;
    const panel = document.getElementById("tab-panel");
    const target = (() => {
      switch (change.phase) {
        case "review":
          return panel?.querySelector<HTMLElement>("h2") ?? null;
        case "debating": {
          // After the person answered the debate's question, their answers stand where the form was.
          const answers = panel?.querySelectorAll<HTMLElement>("[data-answers]");
          return change.from === "awaiting_answers" && answers?.length ? (answers[answers.length - 1] as HTMLElement) : null;
        }
        case "awaiting_answers":
          return document.getElementById(AWAITING_ID);
        case "complete":
          return document.getElementById(VERDICT_READY_ID) ?? panel?.querySelector<HTMLElement>(".verdict-panel h2") ?? null;
        default:
          return null;
      }
    })();
    if (change.phase === "complete" && !document.getElementById(VERDICT_READY_ID) && panel) {
      // The verdict replaced the transcript the person followed: its top under its tabs, not the middle of it
      // (instant: this is an arrival, not a move the person asked for).
      const top = panel.parentElement?.querySelector<HTMLElement>("[role=tablist]") ?? panel;
      if (top.getBoundingClientRect().top < 0) top.scrollIntoView({ block: "start" });
    }
    // A failure is an alert, said once by itself; moving the focus to it would say it twice. The focus still must not
    // fall to the page with the Stop button that went away: it goes to the way on.
    if (change.phase === "failed") {
      focusAfterFailure();
      return;
    }
    const free = focusIsFree();
    const heading = document.querySelector<HTMLElement>("h1[tabindex='-1']");
    if (free && (target ?? heading)) focusTarget((target ?? heading) as HTMLElement);
    // A focused heading reads itself out.
    const said = free && target !== null;
    if (!said && change.phase === "awaiting_answers") announce(canAnswer ? t("progress.awaiting") : t("progress.awaitingAuthor"));
    if (!said && change.phase === "complete") announce(t("progress.verdictReady"));
  });

  // The address follows the tab, in place of the current entry: no new entry and no focus move for a tab. The tab
  // named by an address that changed (a link to another tab of this session) is shown in turn.
  const tabChanged = useRef(onTabChange);
  tabChanged.current = onTabChange;
  const firstTab = useRef(true);
  useEffect(() => {
    if (firstTab.current) {
      firstTab.current = false;
      return;
    }
    tabChanged.current?.(tab);
  }, [tab]);
  const firstRoute = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a change of address counts; the opening tab is set with the phase.
  useEffect(() => {
    if (firstRoute.current) {
      firstRoute.current = false;
      return;
    }
    // Another tab of the same page: no page heading takes the focus for this change, now or at a later page.
    consumeNavigation();
    if (phase === undefined) return;
    const next = asTab(routeTab);
    const shown = usable(next) ? next : null;
    setTab(shown);
    if (routeTab !== undefined && shown === null) tabChanged.current?.(null);
  }, [routeTab]);

  // Each new step of a running debate is announced once, only when it moves the debate forward. The step the page opens
  // on is not news, nor the one found again after a reconnection (the session as it is now, events missed meanwhile).
  const wasConnected = useRef(connected);
  const rebase = useRef(false);
  useEffect(() => {
    if (connected && !wasConnected.current) rebase.current = true;
    wasConnected.current = connected;
  }, [connected]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the session sent on reconnection is the new baseline.
  useEffect(() => {
    if (!rebase.current || !session) return;
    rebase.current = false;
    if (step) lastAnnounced.current = Math.max(lastAnnounced.current ?? step.order, step.order);
  }, [session]);
  const stepOrder = step?.order;
  // biome-ignore lint/correctness/useExhaustiveDependencies: announced when the step moves, not when its words change.
  useEffect(() => {
    if (!step || rebase.current) return;
    const last = lastAnnounced.current;
    if (last === undefined) {
      lastAnnounced.current = step.order;
      return;
    }
    if (last !== null && step.order <= last) return;
    lastAnnounced.current = step.order;
    announce(step.label);
  }, [stepOrder]);

  // A banner's action, once its tab is shown: the questions come into view with the focus on their heading; the
  // verdict opens at its top with the focus on its recommendation.
  useEffect(() => {
    if (!jump) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const target =
      jump === "question"
        ? document.getElementById(`${QUESTIONS_ID}-title`)
        : document.querySelector<HTMLElement>("#tab-panel .verdict-panel h2");
    if (!target) return;
    setJump(null);
    const scrolled =
      jump === "question"
        ? document.getElementById(QUESTIONS_ID)
        : (document.querySelector<HTMLElement>(".session [role=tablist]") ?? document.getElementById("tab-panel"));
    scrolled?.scrollIntoView({ block: jump === "question" ? "center" : "start", behavior: reduce ? "auto" : "smooth" });
    focusTarget(target);
  });

  if (!session) {
    return <SessionSkeleton label={t("common.loading")} />;
  }

  const cost = totalCost(session);
  const tabs = availableTabs(session).filter((name) => !readOnly || name !== "costs");
  const active = tab && tabs.includes(tab) ? tab : defaultTab(session);
  const awaitsPerson = session.phase === "awaiting_answers" && canAnswer;

  // A self-hosted server lets the person raise the cap a debate reached; a host selling debates keeps it fixed.
  const raisable = session.error?.code === "budget_exceeded" && providerCosts;
  const cap = capOf(newCap, newCapBad);
  const range = capRange(i18n.language);
  const retry = async () => {
    // An entry that is not a valid amount never turns into "keep the old cap": the person fixes it first.
    if (raisable && cap.invalid) return document.getElementById("new-cap")?.focus();
    setRetrying(true);
    setRetryError(null);
    try {
      await api.resume(session.id, raisable && cap.amount !== null ? cap.amount : undefined);
      setNewCap("");
      setNewCapBad(false);
    } catch (caught) {
      setRetryError(failureText(t, caught));
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
          {session.european ? (
            <span className="chip label" title={t("european.hint")}>
              {t("european.badge")}
            </span>
          ) : null}
          <Steps
            session={session}
            working={isWorking(session, live, connected)}
            yourTurn={canAnswer || !accessKnown}
            tabs={tabs}
            active={active}
            onOpen={setTab}
          />
          {readOnly ? null : price ? (
            <span className="cost muted">
              <span>{price.label}</span>
              {price.amount > 0 ? <span className="figure">{formatPrice(price.amount, price.currency, i18n.language)}</span> : null}
            </span>
          ) : providerCosts ? (
            <span className="cost muted">
              <span>{t("cost.label")}</span>
              <span className="figure">{formatUsd(cost.usd, i18n.language)}</span>
              {session.budgetUsd !== null ? <span>({t("cost.cap", { cap: formatUsd(session.budgetUsd, i18n.language) })})</span> : null}
            </span>
          ) : null}
        </div>
        <DebateProgress
          session={session}
          live={live}
          step={step}
          connected={connected}
          // Until the server says who may answer, nothing is said of whose answer the debate waits for.
          waitsForPerson={canAnswer || !accessKnown}
        />
        <div className="session-title-row">
          {/* While the debate waits for the person's answer, the browser tab says so, as a mail client counts the unread. */}
          <PageHeading
            title={awaitsPerson ? `(${new Intl.NumberFormat(i18n.language).format(1)}) ${title}` : title}
            className={title.length > 60 ? "display display-long" : "display"}
          >
            {title}
          </PageHeading>
          {readOnly ? null : <SessionActions session={session} share={share} onShare={onShare ?? (() => undefined)} />}
        </div>
        {readOnly || !onAccess ? null : <AccessLine id={session.id} access={access} onChange={onAccess} />}
        {session.parentId && !readOnly ? (
          <p className="field-hint" style={{ margin: 0 }}>
            <a href={`#/s/${session.parentId}`} onClick={() => navigate(`s/${session.parentId}`)}>
              {t("session.fromEarlier")}
            </a>
          </p>
        ) : null}
        {detailsFailed && !readOnly ? (
          <div className="notice notice-error row" role="alert">
            <span>{t("session.detailsFailed")}</span>
            {onRetryDetails ? (
              <button type="button" className="button button-secondary" onClick={onRetryDetails}>
                <RetryIcon />
                {t("common.retry")}
              </button>
            ) : null}
          </div>
        ) : null}
        {awaitsPerson ? (
          <WaitBanner
            id={AWAITING_ID}
            title={t("awaiting.title")}
            lead={t("awaiting.lead")}
            action={t("awaiting.go")}
            onAction={() => {
              // The debate is this phase's own tab: going there is not a choice of tab to keep when the verdict comes.
              setTab(null);
              setJump("question");
            }}
          />
        ) : null}
        {verdictReady && active !== "verdict" ? (
          <WaitBanner
            id={VERDICT_READY_ID}
            title={t("progress.verdictReady")}
            lead={t("verdictReady.lead")}
            action={t("verdictReady.go")}
            onAction={() => {
              setVerdictReady(false);
              setTab("verdict");
              setJump("verdict");
            }}
          />
        ) : null}
        {session.phase === "failed" && !readOnly ? (
          <div className="notice notice-error stack" role="alert">
            <strong id="session-error-title">{t("error.title")}</strong>
            <span>{sessionErrorText(t, session.error, providerCosts, i18n.language)}</span>
            {raisable && access.canEdit ? <span id="new-cap-hint">{t("error.newCapHint")}</span> : null}
            {session.error?.params?.model || failurePlace(t, session) ? (
              <span className="session-error-place">
                {failurePlace(t, session)}
                {session.error?.params?.model ? (
                  <>
                    {" "}
                    {/* Isolated: a model's name runs left to right inside a right-to-left sentence. */}
                    <bdi className="muted mono">
                      ({session.error.params.provider} · {session.error.params.model})
                    </bdi>
                  </>
                ) : null}
              </span>
            ) : null}
            {retryError ? <span>{retryError}</span> : null}
            {access.canEdit ? (
              <div className="row">
                {raisable ? (
                  <div className="field">
                    <label className="field-hint" htmlFor="new-cap">
                      {t("error.newCap")}
                    </label>
                    <input
                      id="new-cap"
                      className="input"
                      type="number"
                      min={MIN_BUDGET_USD}
                      max={MAX_BUDGET_USD}
                      step="any"
                      inputMode="decimal"
                      placeholder={session.budgetUsd === null ? "" : formatUsd(session.budgetUsd, i18n.language)}
                      value={newCap}
                      aria-invalid={cap.invalid}
                      aria-describedby={cap.invalid ? "new-cap-hint new-cap-error" : "new-cap-hint"}
                      onChange={(event) => {
                        setNewCap(event.target.value);
                        setNewCapBad(event.target.validity.badInput);
                      }}
                    />
                    {cap.invalid ? (
                      <span id="new-cap-error" className="field-error">
                        {t("common.budgetRange", range)}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                <BusyButton className="button button-secondary" onClick={retry} busy={retrying} data-retry>
                  <RetryIcon />
                  {t("error.retry")}
                </BusyButton>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* The one polite voice of the page: each new step of the debate, the question for the person, the verdict. */}
      <p className="visually-hidden" role="status">
        {announcement}
      </p>
      <ConnectionBanner connected={connected} onReconnect={onReconnect} />

      {tabs.length > 1 ? (
        <div className="tabs" role="tablist" aria-label={title} ref={setTabList} data-edges={tabEdges || undefined}>
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

      <FeedConnected.Provider value={connected}>
        <TabPanel tab={active} tabbed={tabs.length > 1}>
          {active === "verdict" && session.verdict ? (
            <Verdict
              session={session}
              readOnly={readOnly}
              arrival={verdictArrived.current}
              feedback={feedback}
              revisionPrice={revisionPrice}
              providerCosts={providerCosts}
              {...(reportUrl ? { reportUrl } : {})}
            />
          ) : null}
          {active === "debate" ? <Debate session={session} live={live} readOnly={readOnly} connected={connected} /> : null}
          {active === "requirements" && session.sheet ? (
            session.phase === "review" && !readOnly && access.canEdit ? (
              <Review session={session} />
            ) : (
              <SheetView sheet={session.sheet} />
            )
          ) : null}
          {active === "interview" ? <Interview session={session} live={live} readOnly={readOnly} /> : null}
          {active === "costs" ? <Costs session={session} providerCosts={providerCosts} /> : null}
        </TabPanel>
      </FeedConnected.Provider>
    </div>
  );
}
