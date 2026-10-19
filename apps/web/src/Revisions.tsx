import type { Session } from "@quorumind/core";
import { debateCurrency } from "@quorumind/core/costing";
import { type RevisionChanges, revisionChanges, unchanged } from "@quorumind/core/revisions";
import { currentProposals, currentRevision, sessionAtRevision } from "@quorumind/core/session";
import { type FormEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type PriceQuote } from "./api.ts";
import { RetryIcon } from "./components/Icons.tsx";
import { dayRange } from "./costing.tsx";
import { seatName } from "./Debate.tsx";
import { failureText, sessionErrorText } from "./errors.ts";
import { formatMoney, formatPrice } from "./format.ts";
import { changeLabel, versionLabel } from "./Scenarios.tsx";

// The versions of a verdict in the interface: which one is shown, the one being made, what changed since the one
// before, and the form that makes one from new facts.

const dateOf = (iso: string, language: string) => new Intl.DateTimeFormat(language, { dateStyle: "long" }).format(new Date(iso));

/** "Update the recommendation" (or another label), with the price of a revision when the host sells them. */
export function UpdateLabel({ price, label }: { price: PriceQuote | null | undefined; label?: string }) {
  const { t, i18n } = useTranslation();
  return (
    <>
      {label ?? t("revision.update")}
      {price ? (
        <span className="update-price">
          <span className="visually-hidden">, </span>
          {price.amount > 0 ? formatPrice(price.amount, price.currency, i18n.language) : price.label}
        </span>
      ) : null}
    </>
  );
}

/**
 * Above the verdict: the revision shown, a choice of the earlier ones, the revision being made or the one that
 * failed, with a retry for those who may change the session.
 */
export function RevisionBar({
  session,
  shown,
  onShow,
  canEdit,
  providerCosts,
  price,
}: {
  session: Session;
  shown: number;
  onShow: (number: number) => void;
  canEdit: boolean;
  providerCosts: boolean;
  price: PriceQuote | null | undefined;
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adopting, setAdopting] = useState(false);
  const revisions = session.revisions;
  // The current revision: the adopted scenario, or the latest one that is not a scenario.
  const latest = currentRevision(session);
  const current = revisions.find((revision) => revision.number === shown) ?? latest;
  const revising = session.revising;
  if (!current || !latest) return null;

  const adopt = async (number: number | null) => {
    setAdopting(true);
    setError(null);
    try {
      await api.adopt(session.id, number);
      // Shown until the session says the choice is current; from then on the page follows the current revision.
      onShow(number ?? revisions.findLast((revision) => revision.reason !== "scenario")?.number ?? latest.number);
    } catch (caught) {
      setError(failureText(t, caught));
    } finally {
      setAdopting(false);
    }
  };

  const retry = async () => {
    if (!revising) return;
    setPending(true);
    setError(null);
    try {
      if (revising.inputs.questionnaireId) await api.reviseFromAnswers(session.id, revising.inputs.questionnaireId);
      else if (revising.scenario) await api.scenario(session.id, { ...revising.scenario, basedOn: revising.basedOn });
      else await api.revise(session.id, { facts: revising.inputs.facts, note: revising.inputs.note });
    } catch (caught) {
      setError(failureText(t, caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="revision-bar stack">
      <div className="row revision-head">
        <span className="chip label">
          {t("revision.label", { number: current.number, date: dateOf(current.createdAt, i18n.language) })}
        </span>
        <span className="field-hint">
          {current.scenario ? t("scenario.named", { title: current.scenario.title }) : t(`revision.reason.${current.reason}`)}
        </span>
        {session.adopted === current.number ? <span className="chip status-done">{t("scenario.adopted")}</span> : null}
        {revisions.length > 1 ? (
          <span className="revision-pick">
            <label className="field-hint" htmlFor={`${id}-revision`}>
              {t("revision.show")}
            </label>
            <select
              id={`${id}-revision`}
              className="select"
              value={current.number}
              onChange={(event) => onShow(Number(event.target.value))}
            >
              {[...revisions].reverse().map((revision) => (
                <option key={revision.number} value={revision.number}>
                  {revision.scenario
                    ? versionLabel(revision, t)
                    : t("revision.label", { number: revision.number, date: dateOf(revision.createdAt, i18n.language) })}
                  {revision.number === latest.number ? ` (${t("revision.latest")})` : ""}
                </option>
              ))}
            </select>
          </span>
        ) : null}
      </div>
      {current.scenario ? (
        <div className="notice stack scenario-notice" style={{ margin: 0 }}>
          <span>{session.adopted === current.number ? t("scenario.viewingAdopted") : t("scenario.viewing")}</span>
          <ul style={{ margin: 0 }}>
            {current.scenario.changes.map((change) => (
              <li key={JSON.stringify(change)}>{changeLabel(change, t, i18n.language)}</li>
            ))}
            {current.scenario.question ? <li>{current.scenario.question}</li> : null}
          </ul>
          {canEdit ? (
            <div>
              <button
                type="button"
                className="button button-secondary"
                disabled={adopting || Boolean(revising && !revising.error)}
                onClick={() => adopt(session.adopted === current.number ? null : current.number)}
              >
                {session.adopted === current.number ? t("scenario.unadopt") : t("scenario.adopt")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {error && !revising?.error ? (
        <p className="notice notice-error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
      {current.number !== latest.number ? (
        <p className="notice" style={{ margin: 0 }}>
          {t("revision.viewingOld", { number: current.number, latest: latest.number })}{" "}
          <button type="button" className="button button-quiet" onClick={() => onShow(latest.number)}>
            {t("revision.backToLatest")}
          </button>
        </p>
      ) : null}
      {revising && !revising.error ? (
        <p className="notice revision-working" role="status" style={{ margin: 0 }}>
          {revising.scenario ? t("scenario.working") : t("revision.working")}
        </p>
      ) : null}
      {revising?.error ? (
        <div className="notice notice-error stack" role="alert">
          <span>{t("revision.failed", { reason: sessionErrorText(t, revising.error, providerCosts, i18n.language) })}</span>
          {error ? <span>{error}</span> : null}
          {canEdit ? (
            <div>
              <button type="button" className="button button-secondary" onClick={retry} disabled={pending}>
                <RetryIcon />
                {t("revision.retry")}
                {price && price.amount > 0 ? (
                  <span className="update-price">{formatPrice(price.amount, price.currency, i18n.language)}</span>
                ) : null}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** What a revision changed since the one it starts from; nothing for the debate's own verdict. */
export function WhatChanged({ session, number }: { session: Session; number: number }) {
  const { t, i18n } = useTranslation();
  const changes = revisionChanges(session, number);
  const revision = session.revisions.find((item) => item.number === number);
  if (!changes || !revision) return null;
  const view = sessionAtRevision(session, number) ?? session;
  const proposals = currentProposals(view);
  const option = (seat: string | null) => {
    if (!seat) return t("revision.noRecommendation");
    const title = proposals[seat]?.title;
    return title ? `${seatName(seat, t)} (${title})` : seatName(seat, t);
  };
  const arrow = (from: string, to: string) => t("revision.fromTo", { from, to });
  const score = (value: number | null) => (value === null ? "–" : value.toLocaleString(i18n.language, { maximumFractionDigits: 1 }));
  const currency = debateCurrency(session);
  const range = (value: RevisionChanges["costs"][number]["from"]) =>
    value ? `${formatMoney(value.low, currency, i18n.language)} – ${formatMoney(value.high, currency, i18n.language)}` : "–";
  const weeks = (value: RevisionChanges["schedules"][number]["from"]) =>
    value ? t("debate.weeks", { range: dayRange(value, i18n.language) }) : "–";
  const groups: [string, string[]][] = [
    [
      t("revision.recommendation"),
      changes.recommendation ? [arrow(option(changes.recommendation.from), option(changes.recommendation.to))] : [],
    ],
    [
      t("revision.feasibility"),
      changes.feasibility.map((item) => `${seatName(item.seat, t)}: ${arrow(t(`feasibility.${item.from}`), t(`feasibility.${item.to}`))}`),
    ],
    [
      t("revision.scores"),
      [
        ...changes.weighted.map(
          (item) => `${t("revision.weighted", { option: seatName(item.seat, t) })}: ${arrow(score(item.from), score(item.to))}`,
        ),
        ...changes.scores.map((item) => `${seatName(item.seat, t)} · ${item.criterion}: ${arrow(score(item.from), score(item.to))}`),
      ],
    ],
    [t("revision.risksAdded"), changes.risks.added.map((risk) => risk.risk)],
    [t("revision.risksRemoved"), changes.risks.removed.map((risk) => risk.risk)],
    [
      t("revision.risksChanged"),
      changes.risks.changed.map(
        (item) =>
          `${item.risk}: ${arrow(`${t(`level.${item.from.likelihood}`)} / ${t(`level.${item.from.impact}`)}`, `${t(`level.${item.to.likelihood}`)} / ${t(`level.${item.to.impact}`)}`)}`,
      ),
    ],
    [
      t("revision.costs"),
      changes.costs.map(
        (item) => `${t("revision.monthly", { option: seatName(item.seat, t) })}: ${arrow(range(item.from), range(item.to))}`,
      ),
    ],
    [
      t("revision.schedules"),
      (changes.schedules ?? []).map(
        (item) => `${t("revision.buildTime", { option: seatName(item.seat, t) })}: ${arrow(weeks(item.from), weeks(item.to))}`,
      ),
    ],
    [t("revision.answered"), changes.questions.answered],
    [t("revision.added"), changes.questions.added],
  ];
  // A scenario's changes are listed by the revision bar; its question is its own note.
  const facts = revision.scenario ? [] : revision.inputs.facts;

  return (
    <section className="card what-changed stack" aria-labelledby={`changes-${number}`}>
      <h2 className="heading" id={`changes-${number}`}>
        {t("revision.whatChanged", { number: changes.since })}
      </h2>
      {unchanged(changes) ? (
        <p style={{ margin: 0 }}>{t("revision.noChange")}</p>
      ) : (
        <div className="changes">
          {groups
            .filter(([, items]) => items.length > 0)
            .map(([title, items]) => (
              <div key={title} className="change-group">
                <h3 className="title">{title}</h3>
                <ul>
                  {items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      )}
      {facts.length > 0 || (revision.inputs.note && !revision.scenario) ? (
        <details>
          <summary>{t("revision.facts")}</summary>
          <dl className="facts-list">
            {facts.map((fact) => (
              <div key={`${fact.question}-${fact.answer}`}>
                {fact.question ? <dt>{fact.question}</dt> : null}
                <dd>
                  {fact.answer || "–"}
                  {fact.comment ? <span className="field-hint"> ({fact.comment})</span> : null}
                </dd>
              </div>
            ))}
            {revision.inputs.note ? (
              <div>
                <dd>{revision.inputs.note}</dd>
              </div>
            ) : null}
          </dl>
        </details>
      ) : null}
    </section>
  );
}

/** New facts stated by the person (a correction, something learnt since the debate): a revision of the verdict. */
export function NewFacts({ session, price }: { session: Session; price: PriceQuote | null | undefined }) {
  const { t } = useTranslation();
  const id = useId();
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = Boolean(session.revising && !session.revising.error);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.revise(session.id, { facts: [], note: note.trim() });
      setNote("");
    } catch (caught) {
      setError(failureText(t, caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit}>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-note`}>
          {t("revision.editLabel")}
        </label>
        <textarea
          id={`${id}-note`}
          className="textarea"
          rows={3}
          maxLength={4000}
          value={note}
          aria-describedby={`${id}-hint`}
          onChange={(event) => setNote(event.target.value)}
        />
        <span id={`${id}-hint`} className="field-hint">
          {t("revision.editHint")}
        </span>
      </div>
      {error ? (
        <p className="notice notice-error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
      <div>
        <button type="submit" className="button button-secondary" disabled={pending || busy || !note.trim()}>
          <UpdateLabel price={price} />
        </button>
      </div>
    </form>
  );
}
