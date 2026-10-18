import type { RequirementsSheet } from "@quorumind/core";
import { COMPLIANCE_KEYS } from "@quorumind/core/session";
import { useTranslation } from "react-i18next";
import { budgetText, deadlineText, teamText, usersText } from "./sheetText.ts";

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
  const { t, i18n } = useTranslation();
  const facts = [
    ["users", usersText(sheet, t, i18n.language)],
    ["budget", budgetText(sheet, t, i18n.language)],
    ["team", teamText(sheet, t, i18n.language)],
    ["deadline", deadlineText(sheet, t, i18n.language)],
  ].filter(([, value]) => value);
  const compliance = COMPLIANCE_KEYS.filter((key) => sheet.compliance[key]);
  return (
    <div className="stack-lg">
      <p className="lead" style={{ margin: 0 }}>
        {sheet.summary}
      </p>
      <dl className="sheet-facts">
        {facts.map(([field, value]) => (
          <div key={field}>
            <dt className="label muted">{t(`review.fields.${field}`)}</dt>
            <dd>{value}</dd>
          </div>
        ))}
        {compliance.length > 0 ? (
          <div>
            <dt className="label muted">{t("review.fields.compliance")}</dt>
            <dd className="chips">
              {compliance.map((key) => (
                <span className="chip" key={key}>
                  {t(`review.compliance.${key}`)}
                </span>
              ))}
            </dd>
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
