import type { Session, VerdictRevision } from "@quorumind/core";
import type { ComparedOption, ComparedRequirements, RevisionComparison } from "@quorumind/core/compare";
import { complianceLabels } from "@quorumind/core/compliance-labels";
import { isLocale } from "@quorumind/core/locales";
import { SCENARIO_LIMITS, type ScenarioChange } from "@quorumind/core/scenarios";
import { currentRevision } from "@quorumind/core/session";
import type { TFunction } from "i18next";
import { type FormEvent, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type PriceQuote } from "./api.ts";
import { CrossIcon, DownloadIcon, PlusIcon } from "./components/Icons.tsx";
import { checkTexts, moneyRange } from "./costing.tsx";
import { seatName } from "./Debate.tsx";
import { failureText } from "./errors.ts";
import { formatMoney } from "./format.ts";
import { UpdateLabel } from "./Revisions.tsx";

// "What if" scenarios in the interface: the form that tries one, the names the versions go by, and two versions side
// by side with what differs highlighted (and announced, for those who do not see the highlight).

const signed = (value: number, language: string) => new Intl.NumberFormat(language, { signDisplay: "always" }).format(value);

/** One change of a scenario in the person's language, e.g. "Build budget −30 %". */
export function changeLabel(change: ScenarioChange, t: TFunction, language: string): string {
  if (change.kind === "team") return t("scenario.changeTeam", { delta: signed(change.delta, language) });
  if (change.kind === "budget") {
    const percent = new Intl.NumberFormat(language, { style: "percent", signDisplay: "always" }).format(change.percent / 100);
    return t(change.target === "build" ? "scenario.changeBuild" : "scenario.changeRun", { percent });
  }
  if (change.kind === "deadline") {
    const count = signed(change.delta, language);
    return t("scenario.changeDeadline", { delta: t(change.unit === "week" ? "scenario.weeks" : "scenario.months", { count }) });
  }
  return t("scenario.changeConstraint", { text: change.text });
}

/** How the interface names a version: "Revision 3", or "Scenario “Budget cut” · revision 4". */
export function versionLabel(revision: Pick<VerdictRevision, "number" | "scenario">, t: TFunction): string {
  return revision.scenario
    ? t("compare.scenarioVersion", { title: revision.scenario.title, number: revision.number })
    : t("compare.version", { number: revision.number });
}

type Draft =
  | { key: number; kind: "team"; value: string }
  | { key: number; kind: "build" | "run"; value: string }
  | { key: number; kind: "deadline"; value: string; unit: "week" | "month" }
  | { key: number; kind: "constraint"; value: string };

const KINDS = ["team", "build", "run", "deadline", "constraint"] as const;

/** The structured change a row of the form stands for, or null while it is incomplete. */
function changeOf(draft: Draft): ScenarioChange | null {
  if (draft.kind === "constraint") return draft.value.trim() ? { kind: "constraint", text: draft.value.trim() } : null;
  const value = Number(draft.value);
  if (!draft.value.trim() || !Number.isFinite(value) || value === 0) return null;
  if (draft.kind === "team") return Number.isInteger(value) ? { kind: "team", delta: value } : null;
  if (draft.kind === "deadline") return Number.isInteger(value) ? { kind: "deadline", delta: value, unit: draft.unit } : null;
  return { kind: "budget", target: draft.kind, percent: value };
}

/** Tries a "what if" on the verdict: a title, the question in the person's words, and changes to the numbers. */
export function ScenarioForm({ session, price }: { session: Session; price: PriceQuote | null | undefined }) {
  const { t } = useTranslation();
  const id = useId();
  const current = currentRevision(session);
  const [title, setTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [basedOn, setBasedOn] = useState<number>(current?.number ?? 1);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [next, setNext] = useState(1);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = Boolean(session.revising && !session.revising.error);
  const changes = drafts.map(changeOf);
  const complete = changes.every((change) => change !== null);
  const ready = title.trim() !== "" && complete && (changes.length > 0 || question.trim() !== "");

  const add = () => {
    setDrafts((items) => [...items, { key: next, kind: "team", value: "" }]);
    setNext(next + 1);
  };
  const update = (key: number, patch: Partial<Draft>) =>
    setDrafts((items) =>
      items.map((item) => {
        if (item.key !== key) return item;
        const merged = { ...item, ...patch } as Draft;
        return merged.kind === "deadline" ? { ...merged, unit: (merged as { unit?: "week" | "month" }).unit ?? "month" } : merged;
      }),
    );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    setPending(true);
    setError(null);
    try {
      await api.scenario(session.id, {
        title: title.trim(),
        question: question.trim() || null,
        changes: changes as ScenarioChange[],
        basedOn,
      });
      setTitle("");
      setQuestion("");
      setDrafts([]);
    } catch (caught) {
      setError(failureText(t, caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="stack scenario-form" onSubmit={submit} aria-describedby={`${id}-lead`}>
      <p id={`${id}-lead`} className="field-hint" style={{ margin: 0 }}>
        {t("scenario.lead")}
      </p>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-title`}>
          {t("scenario.name")}
        </label>
        <input
          id={`${id}-title`}
          className="input"
          maxLength={SCENARIO_LIMITS.title}
          value={title}
          placeholder={t("scenario.namePlaceholder")}
          onChange={(event) => setTitle(event.target.value)}
          required
        />
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-question`}>
          {t("scenario.question")}
        </label>
        <textarea
          id={`${id}-question`}
          className="textarea"
          rows={2}
          maxLength={SCENARIO_LIMITS.question}
          value={question}
          aria-describedby={`${id}-question-hint`}
          onChange={(event) => setQuestion(event.target.value)}
        />
        <span id={`${id}-question-hint`} className="field-hint">
          {t("scenario.questionHint")}
        </span>
      </div>
      <fieldset className="scenario-changes stack">
        <legend className="field-label">{t("scenario.changes")}</legend>
        {drafts.map((draft, index) => (
          <div key={draft.key} className="scenario-change">
            <label className="visually-hidden" htmlFor={`${id}-kind-${draft.key}`}>
              {t("scenario.kind", { number: index + 1 })}
            </label>
            <select
              id={`${id}-kind-${draft.key}`}
              className="select"
              value={draft.kind}
              onChange={(event) => update(draft.key, { kind: event.target.value as Draft["kind"], value: "" })}
            >
              {KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`scenario.kinds.${kind}`)}
                </option>
              ))}
            </select>
            <label className="visually-hidden" htmlFor={`${id}-value-${draft.key}`}>
              {t(`scenario.values.${draft.kind}`)}
            </label>
            {draft.kind === "constraint" ? (
              <input
                id={`${id}-value-${draft.key}`}
                className="input"
                maxLength={SCENARIO_LIMITS.constraint}
                value={draft.value}
                placeholder={t("scenario.constraintPlaceholder")}
                onChange={(event) => update(draft.key, { value: event.target.value })}
              />
            ) : (
              <input
                id={`${id}-value-${draft.key}`}
                className="input scenario-number"
                type="number"
                inputMode="decimal"
                step={1}
                min={draft.kind === "build" || draft.kind === "run" ? SCENARIO_LIMITS.minPercent : undefined}
                max={draft.kind === "build" || draft.kind === "run" ? SCENARIO_LIMITS.maxPercent : undefined}
                value={draft.value}
                placeholder={t(`scenario.placeholders.${draft.kind}`)}
                aria-invalid={draft.value.trim() !== "" && changeOf(draft) === null}
                onChange={(event) => update(draft.key, { value: event.target.value })}
              />
            )}
            {draft.kind === "build" || draft.kind === "run" ? (
              <span className="field-hint" aria-hidden="true">
                %
              </span>
            ) : null}
            {draft.kind === "deadline" ? (
              <>
                <label className="visually-hidden" htmlFor={`${id}-unit-${draft.key}`}>
                  {t("scenario.unit")}
                </label>
                <select
                  id={`${id}-unit-${draft.key}`}
                  className="select"
                  value={draft.unit}
                  onChange={(event) => update(draft.key, { unit: event.target.value as "week" | "month" })}
                >
                  <option value="week">{t("scenario.unitWeek")}</option>
                  <option value="month">{t("scenario.unitMonth")}</option>
                </select>
              </>
            ) : null}
            <button
              type="button"
              className="icon-button"
              aria-label={t("scenario.remove", { number: index + 1 })}
              title={t("scenario.remove", { number: index + 1 })}
              onClick={() => setDrafts((items) => items.filter((item) => item.key !== draft.key))}
            >
              <CrossIcon />
            </button>
          </div>
        ))}
        {drafts.length < SCENARIO_LIMITS.changes ? (
          <div>
            <button type="button" className="button button-quiet" onClick={add}>
              <PlusIcon />
              {t("scenario.addChange")}
            </button>
          </div>
        ) : null}
      </fieldset>
      {session.revisions.length > 1 ? (
        <div className="field">
          <label className="field-label" htmlFor={`${id}-base`}>
            {t("scenario.basedOn")}
          </label>
          <select id={`${id}-base`} className="select" value={basedOn} onChange={(event) => setBasedOn(Number(event.target.value))}>
            {[...session.revisions].reverse().map((revision) => (
              <option key={revision.number} value={revision.number}>
                {versionLabel(revision, t)}
                {revision.number === current?.number ? ` (${t("revision.latest")})` : ""}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {error ? (
        <p className="notice notice-error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
      <div>
        <button type="submit" className="button button-secondary" disabled={pending || busy || !ready}>
          <UpdateLabel price={price} label={t("scenario.submit")} />
        </button>
      </div>
    </form>
  );
}

/** A value that differs from the other side's: highlighted, and announced as such. */
function Cell({ text, differs }: { text: string; differs: boolean }) {
  const { t } = useTranslation();
  return differs ? (
    <td className="differs">
      <strong>{text}</strong>
      <span className="visually-hidden"> ({t("compare.differs")})</span>
    </td>
  ) : (
    <td>{text}</td>
  );
}

type Row = { label: string; left: string; right: string; differs: boolean };

function requirementRows(comparison: RevisionComparison, t: TFunction, language: string): Row[] {
  const money = (value: ComparedRequirements["build"]) => (value ? formatMoney(value.amount, value.currency, language) : "–");
  const run = (value: ComparedRequirements["run"]) =>
    value
      ? t(value.period === "year" ? "compare.perYear" : "compare.perMonth", { amount: formatMoney(value.amount, value.currency, language) })
      : "–";
  const deadline = (value: ComparedRequirements) =>
    value.deadline
      ? new Intl.DateTimeFormat(language, { dateStyle: "long", timeZone: "UTC" }).format(Date.parse(`${value.deadline}T00:00:00Z`))
      : value.duration
        ? t(value.duration.unit === "week" ? "scenario.weeks" : "scenario.months", { count: value.duration.amount })
        : "–";
  const { left, right, diff } = comparison;
  return [
    {
      label: t("compare.buildBudget"),
      left: money(left.requirements.build),
      right: money(right.requirements.build),
      differs: diff.requirements.build,
    },
    { label: t("compare.runBudget"), left: run(left.requirements.run), right: run(right.requirements.run), differs: diff.requirements.run },
    {
      label: t("compare.deadline"),
      left: deadline(left.requirements),
      right: deadline(right.requirements),
      differs: diff.requirements.deadline,
    },
    {
      label: t("compare.team"),
      left: left.requirements.team === null ? "–" : t("compare.teamOf", { count: left.requirements.team }),
      right: right.requirements.team === null ? "–" : t("compare.teamOf", { count: right.requirements.team }),
      differs: diff.requirements.team,
    },
    {
      label: t("compare.constraints"),
      left: left.requirements.hardConstraints.join(" · ") || "–",
      right: right.requirements.hardConstraints.join(" · ") || "–",
      differs: diff.requirements.constraints.added.length + diff.requirements.constraints.removed.length > 0,
    },
  ];
}

function optionRows(comparison: RevisionComparison, seat: string, t: TFunction, language: string, session: Session): Row[] {
  const was = comparison.left.options.find((option) => option.seat === seat) ?? null;
  const is = comparison.right.options.find((option) => option.seat === seat) ?? null;
  const diff = comparison.diff.options[seat];
  const value = (option: ComparedOption | null, get: (option: ComparedOption) => string) => (option ? get(option) : "–");
  const score = (value: number | null) => (value === null ? "–" : value.toLocaleString(language, { maximumFractionDigits: 1 }));
  const range = (value: ComparedOption["build"]) => (value ? moneyRange(value, value.currency, language) : "–");
  const weeks = (option: ComparedOption) =>
    option.weeks
      ? option.weeks.low === option.weeks.high
        ? t("scenario.weeks", { count: option.weeks.low })
        : t("compare.weeksRange", { low: option.weeks.low, high: option.weeks.high })
      : "–";
  const checks = (option: ComparedOption) =>
    checkTexts(option.checks ?? undefined, t, language)
      .map((item) => item.text)
      .join(" · ") || "–";
  const locale = isLocale(session.locale) ? session.locale : "en";
  const labels = complianceLabels(locale);
  const assessment = (option: ComparedOption, id: string) => {
    const status = option.compliance[id];
    return status ? labels.status[status] : labels.notAssessed;
  };
  return [
    {
      label: t("compare.feasibility"),
      left: value(was, (option) => (option.feasibility ? t(`feasibility.${option.feasibility}`) : t("compare.notRuled"))),
      right: value(is, (option) => (option.feasibility ? t(`feasibility.${option.feasibility}`) : t("compare.notRuled"))),
      differs: diff?.feasibility ?? false,
    },
    {
      label: t("compare.weighted"),
      left: value(was, (option) => score(option.weighted)),
      right: value(is, (option) => score(option.weighted)),
      differs: diff?.weighted ?? false,
    },
    ...comparison.criteria.map((criterion) => ({
      label: criterion,
      left: value(was, (option) => score(option.scores[criterion] ?? null)),
      right: value(is, (option) => score(option.scores[criterion] ?? null)),
      differs: diff?.scores.includes(criterion) ?? false,
    })),
    {
      label: t("compare.build"),
      left: value(was, (option) => range(option.build)),
      right: value(is, (option) => range(option.build)),
      differs: diff?.build ?? false,
    },
    {
      label: t("compare.monthly"),
      left: value(was, (option) => range(option.monthly)),
      right: value(is, (option) => range(option.monthly)),
      differs: diff?.monthly ?? false,
    },
    { label: t("compare.weeks"), left: value(was, weeks), right: value(is, weeks), differs: diff?.weeks ?? false },
    { label: t("checks.title"), left: value(was, checks), right: value(is, checks), differs: diff?.checks ?? false },
    ...comparison.compliance.map((id) => ({
      label: labels.requirements[id as keyof typeof labels.requirements] ?? id,
      left: value(was, (option) => assessment(option, id)),
      right: value(is, (option) => assessment(option, id)),
      differs: diff?.compliance.includes(id) ?? false,
    })),
  ];
}

function CompareTable({ caption, columns, rows }: { caption: string; columns: [string, string]; rows: Row[] }) {
  return (
    <div className="table-wrap">
      <table className="compare-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <td />
            <th scope="col">{columns[0]}</th>
            <th scope="col">{columns[1]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <Cell text={row.left} differs={row.differs} />
              <Cell text={row.right} differs={row.differs} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Two versions of the decision side by side: any two revisions or scenarios, the differences highlighted. */
export function ComparePanel({ session, initial }: { session: Session; initial?: [number, number] }) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const revisions = session.revisions;
  const current = currentRevision(session)?.number ?? 1;
  const fallback: [number, number] = initial ?? [revisions.find((revision) => revision.number !== current)?.number ?? current, current];
  const [left, setLeft] = useState(fallback[0]);
  const [right, setRight] = useState(fallback[1]);
  const [comparison, setComparison] = useState<RevisionComparison | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    api.compare(session.id, left, right).then(
      (body) => {
        if (live) setComparison(body.comparison);
      },
      (caught: unknown) => {
        if (live) setError(failureText(t, caught));
      },
    );
    return () => {
      live = false;
    };
  }, [session.id, left, right, t]);

  const name = (number: number) => {
    const revision = revisions.find((item) => item.number === number);
    return revision ? versionLabel(revision, t) : t("compare.version", { number });
  };
  const columns: [string, string] = [name(left), name(right)];
  const picker = (which: "left" | "right", value: number, set: (number: number) => void) => (
    <div className="field">
      <label className="field-label" htmlFor={`${id}-${which}`}>
        {t(`compare.${which}`)}
      </label>
      <select id={`${id}-${which}`} className="select" value={value} onChange={(event) => set(Number(event.target.value))}>
        {[...revisions].reverse().map((revision) => (
          <option key={revision.number} value={revision.number}>
            {versionLabel(revision, t)}
            {revision.number === current ? ` (${t("revision.latest")})` : ""}
          </option>
        ))}
      </select>
    </div>
  );
  const proposalTitle = (seat: string) =>
    comparison?.right.options.find((option) => option.seat === seat)?.title ??
    comparison?.left.options.find((option) => option.seat === seat)?.title;

  return (
    <section className="card stack compare" aria-labelledby={`${id}-title`}>
      <h2 className="heading" id={`${id}-title`}>
        {t("compare.title")}
      </h2>
      <div className="compare-pickers">
        {picker("left", left, setLeft)}
        {picker("right", right, setRight)}
      </div>
      {error ? (
        <p className="notice notice-error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
      {comparison ? (
        <>
          <p role="status" style={{ margin: 0 }}>
            <strong>{comparison.diff.count === 0 ? t("compare.none") : t("compare.summary", { count: comparison.diff.count })}</strong>{" "}
            <span className="field-hint">{t("compare.legend")}</span>
          </p>
          {[comparison.left, comparison.right].some((side) => side.scenario) ? (
            <div className="compare-versions">
              {(
                [
                  ["left", comparison.left, columns[0]],
                  ["right", comparison.right, columns[1]],
                ] as const
              ).map(([which, side, column]) => (
                <div key={which} className="compare-version">
                  <h3 className="title">{column}</h3>
                  {side.scenario ? (
                    <ul>
                      {side.scenario.changes.map((change) => (
                        <li key={JSON.stringify(change)}>{changeLabel(change, t, i18n.language)}</li>
                      ))}
                      {side.scenario.question ? <li>{side.scenario.question}</li> : null}
                    </ul>
                  ) : (
                    <p className="field-hint" style={{ margin: 0 }}>
                      {t(`revision.reason.${side.reason}`)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : null}
          <CompareTable
            caption={t("compare.recommendation")}
            columns={columns}
            rows={[
              {
                label: t("compare.recommendation"),
                left: comparison.left.recommendation.seat
                  ? `${seatName(comparison.left.recommendation.seat, t)} · ${comparison.left.recommendation.title ?? ""}`
                  : t("revision.noRecommendation"),
                right: comparison.right.recommendation.seat
                  ? `${seatName(comparison.right.recommendation.seat, t)} · ${comparison.right.recommendation.title ?? ""}`
                  : t("revision.noRecommendation"),
                differs: comparison.diff.recommendation,
              },
            ]}
          />
          <CompareTable caption={t("compare.requirements")} columns={columns} rows={requirementRows(comparison, t, i18n.language)} />
          {comparison.seats.map((seat) => (
            <CompareTable
              key={seat}
              caption={`${seatName(seat, t)}${proposalTitle(seat) ? ` · ${proposalTitle(seat)}` : ""}`}
              columns={columns}
              rows={optionRows(comparison, seat, t, i18n.language, session)}
            />
          ))}
          {comparison.diff.risks.removed.length + comparison.diff.risks.added.length + comparison.diff.risks.changed.length > 0 ? (
            <div className="changes">
              {(
                [
                  [t("compare.risksOnlyIn", { version: columns[0] }), comparison.diff.risks.removed.map((risk) => risk.risk)],
                  [t("compare.risksOnlyIn", { version: columns[1] }), comparison.diff.risks.added.map((risk) => risk.risk)],
                  [
                    t("revision.risksChanged"),
                    comparison.diff.risks.changed.map(
                      (item) =>
                        `${item.risk}: ${t("revision.fromTo", {
                          from: `${t(`level.${item.from.likelihood}`)} / ${t(`level.${item.from.impact}`)}`,
                          to: `${t(`level.${item.to.likelihood}`)} / ${t(`level.${item.to.impact}`)}`,
                        })}`,
                    ),
                  ],
                ] as [string, string[]][]
              )
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
          ) : null}
          <div className="row">
            <span className="field-hint">{t("compare.export")}</span>
            {(["md", "html", "pdf"] as const).map((format) => (
              <a
                key={format}
                className="button button-quiet"
                href={api.compareUrl(session.id, left, right, format)}
                {...(format === "md" ? { download: true } : { target: "_blank", rel: "noreferrer" })}
              >
                <DownloadIcon />
                {t(`compare.${format}`)}
              </a>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
