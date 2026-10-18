import type { RequirementsSheet, Session } from "@quorumind/core";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "./api.ts";
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
type TextField = "summary" | "users" | "budget" | "team";

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
const TEXTS: TextField[] = ["users", "budget", "team"];

const toLines = (items: string[]) => items.join("\n");
const fromLines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

export function Review({ session }: { session: Session }) {
  const { t } = useTranslation();
  const initial = session.sheet as RequirementsSheet;
  const [sheet, setSheet] = useState<RequirementsSheet>(initial);
  const [priorityIds, setPriorityIds] = useState<number[]>(() => initial.priorities.map((_, index) => index));
  const [lists, setLists] = useState<Record<ListField, string>>(
    () => Object.fromEntries(LISTS.map(({ field }) => [field, toLines(initial[field])])) as Record<ListField, string>,
  );
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof RequirementsSheet>(key: K, value: RequirementsSheet[K]) =>
    setSheet((current) => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    setError(null);
    const final: RequirementsSheet = {
      ...sheet,
      ...(Object.fromEntries(LISTS.map(({ field }) => [field, fromLines(lists[field])])) as Pick<RequirementsSheet, ListField>),
      priorities: sheet.priorities.filter((priority) => priority.criterion.trim()),
      deadline: sheet.deadline?.trim() ? sheet.deadline : null,
    };
    try {
      await api.confirmSheet(session.id, final);
    } catch (caught) {
      setError(failureText(t, caught));
      setSending(false);
    }
  };

  return (
    <form className="stack-lg" onSubmit={submit}>
      <div className="stack narrow" style={{ marginInline: 0 }}>
        <h2 className="heading">{t("review.title")}</h2>
        <p className="muted" style={{ margin: 0 }}>
          {t("review.lead")}
        </p>
      </div>

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
        <div className="field">
          <label className="field-label" htmlFor="deadline">
            {t("review.fields.deadline")}
          </label>
          <input id="deadline" className="input" value={sheet.deadline ?? ""} onChange={(event) => set("deadline", event.target.value)} />
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
        {TEXTS.map((field) => (
          <div className="field" key={field}>
            <label className="field-label" htmlFor={field}>
              {t(`review.fields.${field}`)}
            </label>
            <textarea id={field} className="textarea" rows={3} value={sheet[field]} onChange={(event) => set(field, event.target.value)} />
          </div>
        ))}
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
                  className="input"
                  aria-label={t("review.fields.priorities")}
                  value={priority.criterion}
                  onChange={(event) =>
                    set(
                      "priorities",
                      sheet.priorities.map((item, i) => (i === index ? { ...item, criterion: event.target.value } : item)),
                    )
                  }
                />
                <label className="row" style={{ gap: "var(--space-2)", flexWrap: "nowrap" }}>
                  <span className="visually-hidden">{t("review.weight")}</span>
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
                  onClick={() =>
                    set(
                      "priorities",
                      sheet.priorities.filter((_, i) => i !== index),
                    )
                  }
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
        <button type="submit" className="button button-primary" disabled={sending}>
          {sending ? t("review.starting") : t("review.start")}
          <ArrowIcon />
        </button>
      </div>
    </form>
  );
}
