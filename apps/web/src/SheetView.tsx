import type { RequirementsSheet } from "@quorumind/core";
import { useTranslation } from "react-i18next";

const LISTS = [
  "goals",
  "successCriteria",
  "mustHave",
  "niceToHave",
  "outOfScope",
  "existingInfrastructure",
  "hardConstraints",
  "softConstraints",
  "assumptions",
] as const;

/** The validated requirements sheet, read-only. */
export function SheetView({ sheet }: { sheet: RequirementsSheet }) {
  const { t } = useTranslation();
  return (
    <div className="stack-lg">
      <p className="lead" style={{ margin: 0 }}>
        {sheet.summary}
      </p>
      <dl className="sheet-facts">
        {(["users", "budget", "team"] as const).map((field) => (
          <div key={field}>
            <dt className="label muted">{t(`review.fields.${field}`)}</dt>
            <dd>{sheet[field]}</dd>
          </div>
        ))}
        {sheet.deadline ? (
          <div>
            <dt className="label muted">{t("review.fields.deadline")}</dt>
            <dd>{sheet.deadline}</dd>
          </div>
        ) : null}
      </dl>
      <div className="sheet-grid">
        {LISTS.filter((field) => sheet[field].length > 0).map((field) => (
          <section key={field} className={field === "hardConstraints" ? "hard-list" : undefined}>
            <h3 className="title">{t(`review.fields.${field}`)}</h3>
            <ul>
              {sheet[field].map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
        <section>
          <h3 className="title">{t("review.fields.priorities")}</h3>
          <ul className="priority-list">
            {sheet.priorities.map((priority) => (
              <li key={priority.criterion}>
                <span>{priority.criterion}</span>
                <span className="score" role="img" aria-label={`${t("review.weight")} ${priority.weight}/5`}>
                  {[1, 2, 3, 4, 5].map((step) => (
                    <i key={step} data-on={step <= priority.weight} />
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
