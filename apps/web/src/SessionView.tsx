import type { Session } from "@quorumind/core";
import { totalCost } from "@quorumind/core/session";
import { type FormEvent, type KeyboardEvent, useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { navigate, useSessions } from "./App.tsx";
import { AccessContext, AccessLine, FULL_ACCESS } from "./access.tsx";
import { ApiError, api, type Feedback, type PriceQuote, type SessionAccess, type Share, type SharedView as SharedData } from "./api.ts";
import { ClientReport } from "./ClientReport.tsx";
import { Costs } from "./Costs.tsx";
import { RetryIcon } from "./components/Icons.tsx";
import { Loader, Skeleton } from "./components/Logo.tsx";
import { Debate } from "./Debate.tsx";
import { failureText, sessionErrorText } from "./errors.ts";
import { formatPrice, formatUsd } from "./format.ts";
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
  const [extras, setExtras] = useState<{
    share: Share | null;
    feedback: Feedback[];
    price: PriceQuote | null;
    revisionPrice: PriceQuote | null;
    providerCosts: boolean;
    access: SessionAccess | null;
  }>({
    share: null,
    feedback: [],
    price: null,
    revisionPrice: null,
    // Known once the session is loaded: a hosted session never shows a provider cost, even briefly.
    providerCosts: false,
    access: null,
  });
  const title = session ? (session.sheet?.projectName ?? session.idea) : "";
  useEffect(() => {
    if (session) upsert({ id: session.id, idea: title, phase: session.phase, updatedAt: session.updatedAt });
  }, [session, title, upsert]);
  useEffect(() => {
    api.session(id).then(
      (body) =>
        setExtras({
          share: body.share,
          feedback: body.feedback,
          price: body.price,
          revisionPrice: body.revisionPrice ?? null,
          providerCosts: body.providerCosts,
          access: body.access ?? FULL_ACCESS,
        }),
      () => undefined,
    );
  }, [id]);
  // Read-only until the server says what this person may do with the session.
  return (
    <AccessContext.Provider value={extras.access ?? { ...FULL_ACCESS, canEdit: false }}>
      <SessionBody
        session={session}
        live={live}
        connected={connected}
        missing={missing}
        share={extras.share}
        onShare={(share) => setExtras((current) => ({ ...current, share }))}
        onAccess={(access) => setExtras((current) => ({ ...current, access }))}
        feedback={extras.feedback}
        price={extras.price}
        revisionPrice={extras.revisionPrice}
        providerCosts={extras.providerCosts}
      />
    </AccessContext.Provider>
  );
}

/** A session someone shared: read-only, without costs or attached documents. */
export function SharedView({ token }: { token: string }) {
  const { t } = useTranslation();
  const [grant, setGrant] = useState<string | null>(() => storedAccess(token));
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "open"; view: SharedData } | { kind: "locked" } | { kind: "expired" } | { kind: "missing" }
  >({ kind: "loading" });
  useEffect(() => {
    api.shared(token, grant).then(
      (view) => setState({ kind: "open", view }),
      (caught) => {
        const code = caught instanceof ApiError ? caught.code : null;
        setState({ kind: code === "password_required" ? "locked" : code === "share_expired" ? "expired" : "missing" });
      },
    );
  }, [token, grant]);

  if (state.kind === "locked") {
    return (
      <SharePassword
        token={token}
        onAccess={(granted) => {
          keepAccess(token, granted);
          setGrant(granted);
        }}
      />
    );
  }
  if (state.kind === "expired") {
    return (
      <div className="narrow stack">
        <p className="notice notice-error">{t("errors.share_expired")}</p>
      </div>
    );
  }
  const reportUrl = api.sharedReportUrl(token, grant);
  if (state.kind === "open" && state.view.share.mode === "client" && "deliverable" in state.view) {
    return (
      <div className="stack">
        <p className="notice">{t("share.clientReadOnly")}</p>
        <ClientReport deliverable={state.view.deliverable} reportUrl={reportUrl} />
      </div>
    );
  }
  const session = state.kind === "open" && "session" in state.view ? state.view.session : null;
  return (
    <div className="stack">
      <p className="notice">{t("share.readOnly")}</p>
      <SessionBody session={session} live={{}} connected missing={state.kind === "missing"} readOnly reportUrl={reportUrl} />
    </div>
  );
}

// The access a protected link's password gives lasts a few hours: kept for the tab, so a reload does not ask again.
const accessKey = (token: string) => `quorumind.share.${token}`;
function storedAccess(token: string): string | null {
  try {
    return sessionStorage.getItem(accessKey(token));
  } catch {
    return null;
  }
}
function keepAccess(token: string, access: string) {
  try {
    sessionStorage.setItem(accessKey(token), access);
  } catch {
    // Not critical: the password is asked again after a reload.
  }
}

function SharePassword({ token, onAccess }: { token: string; onAccess: (access: string) => void }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const { access } = await api.shareAccess(token, password);
      onAccess(access ?? "");
    } catch (caught) {
      setError(failureText(t, caught));
    } finally {
      setPending(false);
    }
  };
  return (
    <form className="narrow card stack" onSubmit={submit}>
      <h1 className="heading">{t("share.lockedTitle")}</h1>
      <p style={{ margin: 0 }}>{t("share.lockedLead")}</p>
      <div className="field">
        <label className="field-label" htmlFor="share-password">
          {t("share.passwordLabel")}
        </label>
        <input
          id="share-password"
          className="input"
          type="password"
          autoComplete="current-password"
          maxLength={200}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      {error ? (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      ) : null}
      <div>
        <button type="submit" className="button button-primary" disabled={pending || !password}>
          {t("share.unlock")}
        </button>
      </div>
    </form>
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
  onAccess,
  feedback = [],
  reportUrl,
  price = null,
  revisionPrice = null,
  providerCosts = true,
}: {
  session: Session | null;
  live: LiveSpeech;
  connected: boolean;
  missing: boolean;
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
}) {
  const { t, i18n } = useTranslation();
  const access = useContext(AccessContext);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [newCap, setNewCap] = useState("");
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

  // A self-hosted server lets the person raise the cap a debate reached; a host selling debates keeps it fixed.
  const raisable = session.error?.code === "budget_exceeded" && providerCosts;
  const retry = async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      const cap = Number(newCap);
      await api.resume(session.id, raisable && newCap.trim() && cap > 0 ? cap : undefined);
      setNewCap("");
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
          {readOnly ? null : price ? (
            <span className="cost muted">
              <span>{price.label}</span>
              {price.amount > 0 ? <span className="mono">{formatPrice(price.amount, price.currency, i18n.language)}</span> : null}
            </span>
          ) : providerCosts ? (
            <span className="cost muted">
              <span>{t("cost.label")}</span>
              <span className="mono">{formatUsd(cost.usd, i18n.language)}</span>
              {session.budgetUsd !== null ? <span>({t("cost.cap", { cap: formatUsd(session.budgetUsd, i18n.language) })})</span> : null}
            </span>
          ) : null}
        </div>
        <div className="session-title-row">
          <h1 className="display">{title}</h1>
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
        {!connected ? (
          <p className="notice" role="status">
            {t("error.network")}
          </p>
        ) : null}
        {session.phase === "failed" && !readOnly ? (
          <div className="notice notice-error stack" role="alert">
            <strong>{t("error.title")}</strong>
            <span>
              {sessionErrorText(t, session.error, providerCosts, i18n.language)}
              {session.error?.params?.model ? (
                <>
                  {" "}
                  <span className="muted mono">
                    ({session.error.params.provider} · {session.error.params.model})
                  </span>
                </>
              ) : null}
            </span>
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
                      min="0"
                      step="0.5"
                      inputMode="decimal"
                      placeholder={session.budgetUsd === null ? "" : formatUsd(session.budgetUsd, i18n.language)}
                      value={newCap}
                      onChange={(event) => setNewCap(event.target.value)}
                    />
                  </div>
                ) : null}
                <button type="button" className="button button-secondary" onClick={retry} disabled={retrying}>
                  <RetryIcon />
                  {t("error.retry")}
                </button>
              </div>
            ) : null}
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
          <Verdict
            session={session}
            readOnly={readOnly}
            feedback={feedback}
            revisionPrice={revisionPrice}
            providerCosts={providerCosts}
            {...(reportUrl ? { reportUrl } : {})}
          />
        ) : null}
        {active === "debate" ? <Debate session={session} live={live} /> : null}
        {active === "requirements" && session.sheet ? (
          session.phase === "review" && !readOnly && access.canEdit ? (
            <Review session={session} />
          ) : (
            <SheetView sheet={session.sheet} />
          )
        ) : null}
        {active === "interview" ? <Interview session={session} live={live} /> : null}
        {active === "costs" ? <Costs session={session} providerCosts={providerCosts} /> : null}
      </div>
    </div>
  );
}
