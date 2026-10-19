import type { Session } from "@quorumind/core";
import { DECISION_LIMITS, DECISION_STATUSES, type DecisionStatus, type RegisterEntry, registerEntry } from "@quorumind/core/decisions";
import type { TFunction } from "i18next";
import { type FormEvent, useCallback, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { authorName, useCanEdit } from "./access.tsx";
import { api, type DecisionAction, type DecisionFilters, type DecisionRow } from "./api.ts";
import { CheckIcon, DownloadIcon } from "./components/Icons.tsx";
import { PageHeading } from "./components/Page.tsx";
import { seatName } from "./Debate.tsx";
import { failureText } from "./errors.ts";

// The decision register in the interface: the decision of the session on screen (its status, who approved which
// version, its note and its review date), and the register of every decision the person may read, with its filters
// and its CSV export.

const NAME_KEY = "quorumind.approverName";
const dateOf = (iso: string, language: string) => new Intl.DateTimeFormat(language, { dateStyle: "long" }).format(new Date(iso));
const dayOf = (day: string, language: string) =>
  new Intl.DateTimeFormat(language, { dateStyle: "long", timeZone: "UTC" }).format(Date.parse(`${day}T00:00:00Z`));

function storedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Without storage, the name is asked again next time.
  }
}

/** The status of a decision as a chip, in words and color. */
export function StatusChip({ status }: { status: DecisionStatus }) {
  const { t } = useTranslation();
  return <span className={`chip decision-status decision-${status}`}>{t(`decision.status.${status}`)}</span>;
}

/** Who approved which version, or why it is not approved, in one line. */
function approvalText(entry: RegisterEntry, t: TFunction, language: string): string | null {
  if (entry.approval) {
    const date = dateOf(entry.approval.at, language);
    return entry.approval.name ? t("decision.approvedBy", { name: entry.approval.name, date }) : t("decision.approvedOn", { date });
  }
  if (entry.previousApproval) {
    return t("decision.outdated", { number: entry.previousApproval.revision, date: dateOf(entry.previousApproval.at, language) });
  }
  if (entry.request && entry.status === "proposed") {
    const date = dateOf(entry.request.at, language);
    return entry.request.name ? t("decision.requested", { name: entry.request.name, date }) : t("decision.requestedOn", { date });
  }
  return null;
}

function reviewText(entry: RegisterEntry, t: TFunction, language: string): string {
  return [
    entry.review.on ? t("decision.revisit", { date: dayOf(entry.review.on, language) }) : "",
    entry.review.when ? t("decision.revisitIf", { condition: entry.review.when }) : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The name a self-hosted server records for whoever approves: asked once, remembered in this browser. */
function useTypedName(): [boolean, string, (name: string) => void] {
  const [typed, setTyped] = useState(false);
  const [name, setName] = useState(storedName);
  useEffect(() => {
    api.config().then(
      (config) => setTyped(config.typedNames === true),
      () => undefined,
    );
  }, []);
  return [typed, name, setName];
}

/** The decision of the session on screen: its status, the steps the person may take, its note and its review. */
export function DecisionPanel({ session }: { session: Session }) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const canEdit = useCanEdit();
  const entry = registerEntry(session);
  const [typed, name, setName] = useTypedName();
  const [comment, setComment] = useState("");
  const [note, setNote] = useState(session.decision?.note ?? "");
  const [reviewOn, setReviewOn] = useState(session.decision?.review.on ?? "");
  const [reviewWhen, setReviewWhen] = useState(session.decision?.review.when ?? "");
  const [others, setOthers] = useState<DecisionRow[] | null>(null);
  const [replacement, setReplacement] = useState("");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!entry) return null;

  const run = async (work: () => Promise<unknown>) => {
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      await work();
      return true;
    } catch (caught) {
      setError(failureText(t, caught));
      return false;
    } finally {
      setPending(false);
    }
  };

  const act = async (action: DecisionAction) => {
    if (typed && name.trim()) rememberName(name.trim());
    const done = await run(() =>
      api.decide(session.id, action, {
        comment: comment.trim() || null,
        name: typed ? name.trim() || null : null,
        ...(action === "supersede" ? { by: replacement } : {}),
      }),
    );
    if (done) {
      setComment("");
      setOthers(null);
    }
  };

  const chooseReplacement = async () => {
    await run(async () => {
      const { decisions } = await api.decisions();
      setOthers(decisions.filter((row) => row.sessionId !== session.id));
    });
  };

  const saveDetails = async (event: FormEvent) => {
    event.preventDefault();
    const done = await run(() =>
      api.decisionDetails(session.id, { note: note.trim() || null, review: { on: reviewOn || null, when: reviewWhen.trim() || null } }),
    );
    if (done) setSaved(true);
  };

  const approval = approvalText(entry, t, i18n.language);
  const open = entry.status === "proposed" || entry.status === "approved";

  return (
    <section className="card stack decision-panel" aria-labelledby={`${id}-title`}>
      <div className="row">
        <h2 className="heading" id={`${id}-title`} style={{ margin: 0 }}>
          {t("decision.title")}
        </h2>
        <StatusChip status={entry.status} />
        <a className="button button-quiet" href="#/decisions" style={{ marginInlineStart: "auto" }}>
          {t("decision.openRegister")}
        </a>
      </div>
      {approval ? <p style={{ margin: 0 }}>{approval}</p> : null}
      {entry.approval?.comment ? (
        <p className="field-hint" style={{ margin: 0 }}>
          {entry.approval.comment}
        </p>
      ) : null}
      {entry.supersededBy ? (
        <p style={{ margin: 0 }}>
          <a href={`#/s/${entry.supersededBy}`}>
            {t("decision.supersededBy", { title: session.decision?.closure?.supersededTitle ?? "" })}
          </a>
        </p>
      ) : null}
      {reviewText(entry, t, i18n.language) ? (
        <p className="field-hint" style={{ margin: 0 }}>
          {reviewText(entry, t, i18n.language)}
        </p>
      ) : null}

      <div className="stack decision-actions">
        {typed ? (
          <div className="field">
            <label className="field-label" htmlFor={`${id}-name`}>
              {t("decision.yourName")}
            </label>
            <input
              id={`${id}-name`}
              className="input"
              maxLength={DECISION_LIMITS.name}
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
        ) : null}
        <div className="field">
          <label className="field-label" htmlFor={`${id}-comment`}>
            {t("decision.comment")}
          </label>
          <input
            id={`${id}-comment`}
            className="input"
            maxLength={DECISION_LIMITS.comment}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
        </div>
        <div className="row">
          {canEdit && entry.status === "proposed" ? (
            <button type="button" className="button button-primary" disabled={pending} onClick={() => act("approve")}>
              <CheckIcon />
              {t("decision.approve")}
            </button>
          ) : null}
          {!canEdit && entry.status === "proposed" ? (
            <button type="button" className="button button-secondary" disabled={pending} onClick={() => act("request")}>
              {t("decision.request")}
            </button>
          ) : null}
          {canEdit && open ? (
            <button type="button" className="button button-secondary" disabled={pending} onClick={() => act("reject")}>
              {t("decision.reject")}
            </button>
          ) : null}
          {canEdit && open && others === null ? (
            <button type="button" className="button button-quiet" disabled={pending} onClick={chooseReplacement}>
              {t("decision.supersede")}
            </button>
          ) : null}
          {canEdit && !open ? (
            <button type="button" className="button button-secondary" disabled={pending} onClick={() => act("reopen")}>
              {t("decision.reopen")}
            </button>
          ) : null}
          {canEdit && entry.status === "approved" ? (
            <button type="button" className="button button-quiet" disabled={pending} onClick={() => act("reopen")}>
              {t("decision.withdraw")}
            </button>
          ) : null}
        </div>
        {others !== null ? (
          others.length === 0 ? (
            <p className="field-hint" style={{ margin: 0 }}>
              {t("decision.noOther")}
            </p>
          ) : (
            <div className="row">
              <label className="field-label" htmlFor={`${id}-replacement`}>
                {t("decision.supersedeBy")}
              </label>
              <select
                id={`${id}-replacement`}
                className="select"
                value={replacement}
                onChange={(event) => setReplacement(event.target.value)}
              >
                <option value="">–</option>
                {others.map((row) => (
                  <option key={row.sessionId} value={row.sessionId}>
                    {row.title}
                  </option>
                ))}
              </select>
              <button type="button" className="button button-secondary" disabled={pending || !replacement} onClick={() => act("supersede")}>
                {t("decision.supersede")}
              </button>
            </div>
          )
        ) : null}
        {!canEdit ? (
          <p className="field-hint" style={{ margin: 0 }}>
            {t("decision.readOnly")}
          </p>
        ) : null}
      </div>

      {canEdit ? (
        <form className="stack" onSubmit={saveDetails}>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-note`}>
              {t("decision.note")}
            </label>
            <textarea
              id={`${id}-note`}
              className="textarea"
              rows={2}
              maxLength={DECISION_LIMITS.note}
              value={note}
              aria-describedby={`${id}-note-hint`}
              onChange={(event) => setNote(event.target.value)}
            />
            <span id={`${id}-note-hint`} className="field-hint">
              {t("decision.noteHint")}
            </span>
          </div>
          <div className="decision-review">
            <div className="field">
              <label className="field-label" htmlFor={`${id}-on`}>
                {t("decision.reviewOn")}
              </label>
              <input id={`${id}-on`} className="input" type="date" value={reviewOn} onChange={(event) => setReviewOn(event.target.value)} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor={`${id}-when`}>
                {t("decision.reviewWhen")}
              </label>
              <input
                id={`${id}-when`}
                className="input"
                maxLength={DECISION_LIMITS.when}
                value={reviewWhen}
                placeholder={t("decision.reviewWhenPlaceholder")}
                onChange={(event) => setReviewWhen(event.target.value)}
              />
            </div>
          </div>
          <span className="field-hint">{t("decision.reviewHint")}</span>
          <div className="row">
            <button type="submit" className="button button-secondary" disabled={pending}>
              {t("decision.save")}
            </button>
            {saved ? (
              <span role="status" className="field-hint">
                {t("decision.saved")}
              </span>
            ) : null}
          </div>
        </form>
      ) : null}
      {error ? (
        <p className="notice notice-error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** The register: one row per decision the person may read, with its filters and its CSV export. */
export function Register() {
  const { t, i18n } = useTranslation();
  const id = useId();
  const [filters, setFilters] = useState<DecisionFilters>({});
  const [rows, setRows] = useState<DecisionRow[] | null>(null);
  const [authors, setAuthors] = useState<{ id: string; name: string | null; email: string | null }[]>([]);
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api.decisions(filters).then(
      (body) => {
        setRows(body.decisions);
        setAuthors(body.authors);
        setShared(body.shared);
      },
      (caught: unknown) => setError(failureText(t, caught)),
    );
  }, [filters, t]);
  useEffect(load, [load]);

  const set = (patch: Partial<DecisionFilters>) =>
    setFilters((current) => {
      const next = { ...current, ...patch };
      for (const key of Object.keys(next) as (keyof DecisionFilters)[]) if (!next[key]) delete next[key];
      return next;
    });
  const filtered = Object.keys(filters).length > 0;

  return (
    <div className="stack-lg register">
      <header className="stack">
        <PageHeading title={t("register.title")} />
        <p className="field-hint" style={{ margin: 0 }}>
          {t("register.lead")}
        </p>
      </header>
      <fieldset className="register-filters">
        <legend className="visually-hidden">{t("register.filters")}</legend>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-status`}>
            {t("register.status")}
          </label>
          <select
            id={`${id}-status`}
            className="select"
            value={filters.status ?? ""}
            onChange={(event) => set({ status: (event.target.value || undefined) as DecisionStatus | undefined })}
          >
            <option value="">{t("register.anyStatus")}</option>
            {DECISION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`decision.status.${status}`)}
              </option>
            ))}
          </select>
        </div>
        {shared ? (
          <div className="field">
            <label className="field-label" htmlFor={`${id}-author`}>
              {t("register.author")}
            </label>
            <select
              id={`${id}-author`}
              className="select"
              value={filters.author ?? ""}
              onChange={(event) => set({ author: event.target.value || undefined })}
            >
              <option value="">{t("register.anyAuthor")}</option>
              <option value="me">{t("register.me")}</option>
              {authors.map((author) => (
                <option key={author.id} value={author.id}>
                  {authorName(author, t)}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="field">
          <label className="field-label" htmlFor={`${id}-from`}>
            {t("register.from")}
          </label>
          <input
            id={`${id}-from`}
            className="input"
            type="date"
            value={filters.from ?? ""}
            onChange={(event) => set({ from: event.target.value })}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-to`}>
            {t("register.to")}
          </label>
          <input
            id={`${id}-to`}
            className="input"
            type="date"
            value={filters.to ?? ""}
            onChange={(event) => set({ to: event.target.value })}
          />
        </div>
        <div className="register-tools">
          {filtered ? (
            <button type="button" className="button button-quiet" onClick={() => setFilters({})}>
              {t("register.clear")}
            </button>
          ) : null}
          <a className="button button-secondary" href={api.decisionsCsvUrl(filters, i18n.language)} download>
            <DownloadIcon />
            {t("register.csv")}
          </a>
        </div>
      </fieldset>
      {error ? (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      ) : null}
      {/* What the filters found, in one line rather than the whole table read out again. */}
      <p className={rows === null ? undefined : "visually-hidden"} role="status">
        {rows === null ? (error ? "" : t("register.loading")) : t("register.count", { count: rows.length })}
      </p>
      {rows?.length === 0 ? <p>{t("register.empty")}</p> : null}
      {rows && rows.length > 0 ? (
        <div className="table-wrap">
          <table className="register-table">
            <caption className="visually-hidden">{t("register.title")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("register.decision")}</th>
                <th scope="col">{t("register.recommendation")}</th>
                <th scope="col">{t("register.status")}</th>
                <th scope="col">{t("register.approval")}</th>
                <th scope="col">{t("register.review")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const replacement = row.supersededBy ? rows.find((other) => other.sessionId === row.supersededBy) : null;
                return (
                  <tr key={row.sessionId}>
                    <th scope="row">
                      <a href={`#/s/${row.sessionId}`}>{row.title}</a>
                      <span className="field-hint register-meta">
                        {row.revision.scenario
                          ? t("register.scenario", { title: row.revision.scenario, number: row.revision.number })
                          : t("register.version", { number: row.revision.number })}
                        {" · "}
                        {dateOf(row.decidedAt, i18n.language)}
                        {shared && !row.mine ? ` · ${authorName(row.author, t)}` : ""}
                      </span>
                      {row.note ? <span className="register-note">{row.note}</span> : null}
                    </th>
                    <td>
                      {row.recommendation
                        ? `${seatName(row.recommendation.seat, t)} · ${row.recommendation.title}`
                        : t("register.noRecommendation")}
                    </td>
                    <td>
                      <StatusChip status={row.status} />
                      {row.supersededBy ? (
                        <a className="register-link" href={`#/s/${row.supersededBy}`}>
                          {t("register.superseding")} {replacement?.title ?? ""}
                        </a>
                      ) : null}
                      {row.revisits ? (
                        <a className="register-link" href={`#/s/${row.revisits}`}>
                          {t("register.revisits")}
                        </a>
                      ) : null}
                    </td>
                    <td>{approvalText(row, t, i18n.language) ?? "–"}</td>
                    <td>{reviewText(row, t, i18n.language) || "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
