import type { BudgetPeriod, DurationUnit, RequirementsSheet, Session } from "@quorumind/core";
import { debateCurrency, sessionProfile } from "@quorumind/core/costing";
import { currencyCode } from "@quorumind/core/profile";
import { COMPLIANCE_KEYS } from "@quorumind/core/session";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "./api.ts";
import { CurrencySelect } from "./components/CurrencySelect.tsx";
import { ArrowIcon, CrossIcon } from "./components/Icons.tsx";
import { failureText } from "./errors.ts";

type ListField =
  | "goals"
  | "successCriteria"
  | "mustHave"
  | "niceToHave"
  | "outOfScope"
  | "existingInfrastructure"
  | "hardConstraints"
  | "softConstraints"
  | "assumptions";

const LISTS: { field: ListField; wide?: boolean }[] = [
  { field: "goals" },
  { field: "successCriteria" },
  { field: "mustHave" },
  { field: "niceToHave" },
  { field: "outOfScope" },
  { field: "existingInfrastructure" },
  { field: "hardConstraints", wide: true },
  { field: "softConstraints" },
  { field: "assumptions" },
];

const toLines = (items: string[]) => items.join("\n");
const fromLines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
const fromCommas = (text: string) =>
  text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
/** A number field's value: null when empty or not a non-negative number. */
const amountOf = (text: string): number | null => {
  const value = Number(text.replace(",", "."));
  return text.trim() === "" || !Number.isFinite(value) || value < 0 ? null : value;
};
const textOf = (value: number | null | undefined) => (value === null || value === undefined ? "" : String(value));

/** What the proposals will stay within, and the switch that sets the profile aside for this debate. */
function ProfileNotice({ session, ignore, onIgnore }: { session: Session; ignore: boolean; onIgnore: (ignore: boolean) => void }) {
  const { t, i18n } = useTranslation();
  const profile = sessionProfile({ profile: session.profile, ignoreProfile: false });
  if (!profile) return null;
  const rules = [
    profile.forbiddenTechnologies.length > 0 ? t("review.profile.forbidden", { list: profile.forbiddenTechnologies.join(", ") }) : "",
    profile.hosting.euOnly ? t("review.profile.euOnly") : "",
    profile.hosting.providers.length > 0 ? t("review.profile.providers", { list: profile.hosting.providers.join(", ") }) : "",
    profile.hosting.onPremises ? t("review.profile.onPremises") : "",
    profile.preferredTechnologies.length > 0 ? t("review.profile.preferred", { list: profile.preferredTechnologies.join(", ") }) : "",
    profile.roles.length > 0 ? t("review.profile.rates", { count: profile.roles.length, currency: profile.currency }) : "",
  ].filter(Boolean);
  const saved = profile.updatedAt
    ? new Intl.DateTimeFormat(i18n.language, { dateStyle: "long" }).format(new Date(profile.updatedAt))
    : null;
  return (
    <section className={`card stack profile-notice${ignore ? " profile-ignored" : ""}`} aria-labelledby="profile-notice-title">
      <div className="stack" style={{ gap: "var(--space-1)" }}>
        <h3 className="title" id="profile-notice-title" style={{ margin: 0 }}>
          {profile.name.trim() ? t("review.profile.titleNamed", { name: profile.name.trim() }) : t("review.profile.title")}
        </h3>
        <p style={{ margin: 0 }}>{t("review.profile.lead")}</p>
        {rules.length > 0 ? (
          <ul style={{ margin: 0 }}>
            {rules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        ) : null}
        {saved ? <span className="field-hint">{t("review.profile.saved", { date: saved })}</span> : null}
      </div>
      <label className="check">
        <input type="checkbox" checked={ignore} onChange={(event) => onIgnore(event.target.checked)} />
        <span>
          {t("review.profile.ignore")}
          <span className="field-hint">{t("review.profile.ignoreHint")}</span>
        </span>
      </label>
    </section>
  );
}

export function Review({ session }: { session: Session }) {
  const { t } = useTranslation();
  const initial = session.sheet as RequirementsSheet;
  const [sheet, setSheet] = useState<RequirementsSheet>(initial);
  const [priorityIds, setPriorityIds] = useState<number[]>(() => initial.priorities.map((_, index) => index));
  const [lists, setLists] = useState<Record<ListField, string>>(
    () => Object.fromEntries(LISTS.map(({ field }) => [field, toLines(initial[field])])) as Record<ListField, string>,
  );
  const [ignoreProfile, setIgnoreProfile] = useState(session.ignoreProfile);
  // The budget's amounts are typed as text and share one currency.
  const [budget, setBudget] = useState(() => ({
    build: textOf(initial.budget.build?.amount),
    run: textOf(initial.budget.run?.amount),
    period: (initial.budget.run?.period ?? "month") as BudgetPeriod,
    currency: initial.budget.build?.currency ?? initial.budget.run?.currency ?? debateCurrency({ ...session, currency: null }),
  }));
  const [numbers, setNumbers] = useState(() => ({
    usersLaunch: textOf(initial.users.launch),
    usersYear: textOf(initial.users.oneYear),
    people: textOf(initial.team.people),
    duration: textOf(initial.deadline.duration?.amount),
  }));
  const [unit, setUnit] = useState<DurationUnit>(initial.deadline.duration?.unit ?? "month");
  const [skills, setSkills] = useState(initial.team.skills.join(", "));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof RequirementsSheet>(key: K, value: RequirementsSheet[K]) =>
    setSheet((current) => ({ ...current, [key]: value }));
  const currency = currencyCode(budget.currency);
  const amountsTyped = budget.build.trim() !== "" || budget.run.trim() !== "";
  const currencyInvalid = amountsTyped && !currency;
  // What the debate's amounts will be in, as it will be fixed on confirmation.
  const debateIn = debateCurrency({
    ...session,
    currency: null,
    ignoreProfile,
    sheet: { ...sheet, budget: { ...sheet.budget, build: currency ? { amount: 1, currency } : null, run: null } },
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (currencyInvalid) return setError(t("review.currencyInvalid"));
    setSending(true);
    setError(null);
    const build = amountOf(budget.build);
    const run = amountOf(budget.run);
    const duration = amountOf(numbers.duration);
    const final: RequirementsSheet = {
      ...sheet,
      ...(Object.fromEntries(LISTS.map(({ field }) => [field, fromLines(lists[field])])) as Pick<RequirementsSheet, ListField>),
      priorities: sheet.priorities.filter((priority) => priority.criterion.trim()),
      users: { ...sheet.users, launch: amountOf(numbers.usersLaunch), oneYear: amountOf(numbers.usersYear) },
      budget: {
        build: build !== null && currency ? { amount: build, currency } : null,
        run: run !== null && currency ? { amount: run, currency, period: budget.period } : null,
        note: sheet.budget.note,
      },
      team: { ...sheet.team, people: amountOf(numbers.people), skills: fromCommas(skills) },
      // A date wins over a duration: it is the firmer of the two.
      deadline: {
        ...sheet.deadline,
        date: sheet.deadline.date || null,
        duration: !sheet.deadline.date && duration ? { amount: duration, unit } : null,
      },
    };
    try {
      await api.confirmSheet(session.id, final, ignoreProfile);
    } catch (caught) {
      setError(failureText(t, caught));
      setSending(false);
    }
  };

  const numberField = (id: keyof typeof numbers, label: string) => (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="input"
        type="number"
        min={0}
        inputMode="numeric"
        placeholder={t("review.unknown")}
        value={numbers[id]}
        onChange={(event) => setNumbers((current) => ({ ...current, [id]: event.target.value }))}
      />
    </div>
  );

  return (
    <form className="stack-lg" onSubmit={submit}>
      <div className="stack narrow" style={{ marginInline: 0 }}>
        <h2 className="heading">{t("review.title")}</h2>
        <p className="muted" style={{ margin: 0 }}>
          {t("review.lead")}
        </p>
      </div>

      <ProfileNotice session={session} ignore={ignoreProfile} onIgnore={setIgnoreProfile} />

      <div className="card sheet-grid">
        <div className="field">
          <label className="field-label" htmlFor="projectName">
            {t("review.fields.projectName")}
          </label>
          <input
            id="projectName"
            className="input"
            value={sheet.projectName}
            onChange={(event) => set("projectName", event.target.value)}
          />
        </div>
        <div className="field wide">
          <label className="field-label" htmlFor="summary">
            {t("review.fields.summary")}
          </label>
          <textarea
            id="summary"
            className="textarea"
            rows={3}
            value={sheet.summary}
            onChange={(event) => set("summary", event.target.value)}
          />
        </div>

        <fieldset className="field wide sheet-group">
          <legend className="field-label">{t("review.fields.budget")}</legend>
          <div className="sheet-inputs">
            <div className="field">
              <label className="field-label" htmlFor="buildBudget">
                {t("review.fields.buildBudget")}
              </label>
              <input
                id="buildBudget"
                className="input"
                type="number"
                min={0}
                inputMode="decimal"
                placeholder={t("review.unknown")}
                value={budget.build}
                onChange={(event) => setBudget((current) => ({ ...current, build: event.target.value }))}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="runBudget">
                {t("review.fields.runBudget")}
              </label>
              <div className="input-pair">
                <input
                  id="runBudget"
                  className="input"
                  type="number"
                  min={0}
                  inputMode="decimal"
                  placeholder={t("review.unknown")}
                  value={budget.run}
                  onChange={(event) => setBudget((current) => ({ ...current, run: event.target.value }))}
                />
                <select
                  className="select"
                  aria-label={t("review.fields.period")}
                  value={budget.period}
                  onChange={(event) => setBudget((current) => ({ ...current, period: event.target.value as BudgetPeriod }))}
                >
                  <option value="month">{t("review.period.month")}</option>
                  <option value="year">{t("review.period.year")}</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="budgetCurrency">
                {t("review.fields.currency")}
              </label>
              <CurrencySelect
                id="budgetCurrency"
                value={budget.currency}
                describedBy="budgetCurrency-hint"
                onChange={(code) => setBudget((current) => ({ ...current, currency: code }))}
              />
              <span className="field-hint" id="budgetCurrency-hint">
                {t("review.currencyHint")}
              </span>
            </div>
          </div>
          <label className="field-hint" htmlFor="budgetNote">
            {t("review.fields.note")}
          </label>
          <textarea
            id="budgetNote"
            className="textarea"
            rows={2}
            value={sheet.budget.note}
            onChange={(event) => set("budget", { ...sheet.budget, note: event.target.value })}
          />
        </fieldset>

        <fieldset className="field sheet-group">
          <legend className="field-label">{t("review.fields.users")}</legend>
          <div className="sheet-inputs">
            {numberField("usersLaunch", t("review.fields.usersLaunch"))}
            {numberField("usersYear", t("review.fields.usersYear"))}
          </div>
          <label className="field-hint" htmlFor="usersNote">
            {t("review.fields.usersNote")}
          </label>
          <textarea
            id="usersNote"
            className="textarea"
            rows={2}
            value={sheet.users.note}
            onChange={(event) => set("users", { ...sheet.users, note: event.target.value })}
          />
        </fieldset>

        <fieldset className="field sheet-group">
          <legend className="field-label">{t("review.fields.team")}</legend>
          <div className="sheet-inputs">
            {numberField("people", t("review.fields.people"))}
            <div className="field">
              <label className="field-label" htmlFor="skills">
                {t("review.fields.skills")}
              </label>
              <input
                id="skills"
                className="input"
                value={skills}
                aria-describedby="skills-hint"
                onChange={(event) => setSkills(event.target.value)}
              />
              <span className="field-hint" id="skills-hint">
                {t("review.commas")}
              </span>
            </div>
          </div>
          <label className="field-hint" htmlFor="teamNote">
            {t("review.fields.note")}
          </label>
          <textarea
            id="teamNote"
            className="textarea"
            rows={2}
            value={sheet.team.note}
            onChange={(event) => set("team", { ...sheet.team, note: event.target.value })}
          />
        </fieldset>

        <fieldset className="field sheet-group">
          <legend className="field-label">{t("review.fields.deadline")}</legend>
          <div className="sheet-inputs">
            <div className="field">
              <label className="field-label" htmlFor="deadlineDate">
                {t("review.fields.deadlineDate")}
              </label>
              <input
                id="deadlineDate"
                className="input"
                type="date"
                value={sheet.deadline.date ?? ""}
                onChange={(event) => set("deadline", { ...sheet.deadline, date: event.target.value || null })}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="duration">
                {t("review.fields.duration")}
              </label>
              <div className="input-pair">
                <input
                  id="duration"
                  className="input"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  placeholder={t("review.unknown")}
                  disabled={Boolean(sheet.deadline.date)}
                  value={numbers.duration}
                  onChange={(event) => setNumbers((current) => ({ ...current, duration: event.target.value }))}
                />
                <select
                  className="select"
                  aria-label={t("review.fields.unit")}
                  disabled={Boolean(sheet.deadline.date)}
                  value={unit}
                  onChange={(event) => setUnit(event.target.value as DurationUnit)}
                >
                  <option value="week">{t("review.unit.week")}</option>
                  <option value="month">{t("review.unit.month")}</option>
                </select>
              </div>
            </div>
          </div>
          <label className="field-hint" htmlFor="deadlineNote">
            {t("review.fields.note")}
          </label>
          <textarea
            id="deadlineNote"
            className="textarea"
            rows={2}
            value={sheet.deadline.note}
            onChange={(event) => set("deadline", { ...sheet.deadline, note: event.target.value })}
          />
        </fieldset>

        <fieldset className="field sheet-group">
          <legend className="field-label">{t("review.fields.compliance")}</legend>
          <div className="stack" style={{ gap: "var(--space-2)" }}>
            {COMPLIANCE_KEYS.map((key) => (
              <label className="check" key={key}>
                <input
                  type="checkbox"
                  checked={sheet.compliance[key]}
                  onChange={(event) => set("compliance", { ...sheet.compliance, [key]: event.target.checked })}
                />
                <span>{t(`review.compliance.${key}`)}</span>
              </label>
            ))}
          </div>
          <span className="field-hint">{t("review.complianceHint")}</span>
        </fieldset>

        {LISTS.map(({ field, wide }) => (
          <div className={`field${wide ? " wide" : ""}${field === "hardConstraints" ? " field-hard" : ""}`} key={field}>
            <label className="field-label" htmlFor={field}>
              {t(`review.fields.${field}`)}
            </label>
            <textarea
              id={field}
              className="textarea"
              rows={Math.max(3, lists[field].split("\n").length + 1)}
              value={lists[field]}
              onChange={(event) => setLists((current) => ({ ...current, [field]: event.target.value }))}
              aria-describedby="one-per-line"
            />
          </div>
        ))}
        <p id="one-per-line" className="field-hint wide" style={{ margin: 0 }}>
          {t("review.onePerLine")}
        </p>

        <fieldset className="field wide" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field-label" style={{ marginBlockEnd: "var(--space-2)" }}>
            {t("review.fields.priorities")}
          </legend>
          <div className="stack">
            {sheet.priorities.map((priority, index) => (
              <div className="priority" key={priorityIds[index]}>
                <input
                  id={`priority-${priorityIds[index]}`}
                  className="input"
                  aria-label={t("review.priorityLabel", { number: index + 1 })}
                  value={priority.criterion}
                  onChange={(event) =>
                    set(
                      "priorities",
                      sheet.priorities.map((item, i) => (i === index ? { ...item, criterion: event.target.value } : item)),
                    )
                  }
                />
                <label className="row" style={{ gap: "var(--space-2)", flexWrap: "nowrap" }}>
                  <span className="visually-hidden">{t("review.weightLabel", { number: index + 1 })}</span>
                  <input
                    type="range"
                    min={1}
                    max={5}
                    step={1}
                    value={priority.weight}
                    onChange={(event) =>
                      set(
                        "priorities",
                        sheet.priorities.map((item, i) => (i === index ? { ...item, weight: Number(event.target.value) } : item)),
                      )
                    }
                  />
                  <span className="mono">{priority.weight}</span>
                </label>
                <button
                  type="button"
                  className="icon-button"
                  style={{ inlineSize: 24, blockSize: 24, border: 0 }}
                  aria-label={t("review.removePriority")}
                  aria-describedby={`priority-${priorityIds[index]}`}
                  onClick={() => {
                    set(
                      "priorities",
                      sheet.priorities.filter((_, i) => i !== index),
                    );
                    // The ids follow the rows, so that the rows after a removed one keep theirs.
                    setPriorityIds((ids) => ids.filter((_, i) => i !== index));
                  }}
                >
                  <CrossIcon />
                </button>
              </div>
            ))}
            <div>
              <button
                type="button"
                className="button button-quiet"
                onClick={() => {
                  set("priorities", [...sheet.priorities, { criterion: "", weight: 3 }]);
                  setPriorityIds((ids) => [...ids, Math.max(-1, ...ids) + 1]);
                }}
              >
                + {t("review.addPriority")}
              </button>
            </div>
          </div>
        </fieldset>
      </div>

      <div className="sticky-actions">
        {error ? (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        ) : null}
        <span className="field-hint">{t("review.currencyNote", { currency: debateIn })}</span>
        <button type="submit" className="button button-primary" disabled={sending}>
          {sending ? t("review.starting") : t("review.start")}
          <ArrowIcon />
        </button>
      </div>
    </form>
  );
}
