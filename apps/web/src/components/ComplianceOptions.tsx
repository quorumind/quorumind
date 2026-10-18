import type { ComplianceTemplateId } from "@quorumind/core/compliance";
import { complianceLabels } from "@quorumind/core/compliance-labels";
import { complianceRows, statusName } from "@quorumind/core/compliance-report";
import type { Locale } from "@quorumind/core/locales";
import type { Session } from "@quorumind/core/session";
import type { EuropeanGateway, EuropeanPolicy } from "@quorumind/core/sovereignty";
import { useTranslation } from "react-i18next";

/** The compliance templates to combine with the project type: several can be chosen. */
export function CompliancePicker({
  templates,
  value,
  onChange,
  disabled,
}: {
  templates: ComplianceTemplateId[];
  value: ComplianceTemplateId[];
  onChange: (next: ComplianceTemplateId[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  if (templates.length === 0) return null;
  const toggle = (id: ComplianceTemplateId) =>
    onChange(value.includes(id) ? value.filter((item) => item !== id) : templates.filter((item) => item === id || value.includes(item)));
  return (
    <fieldset className="template-picker" disabled={disabled}>
      <legend className="field-label">{t("compliance.label")}</legend>
      <div className="chips">
        {templates.map((id) => (
          <button key={id} type="button" className="chip-toggle" aria-pressed={value.includes(id)} onClick={() => toggle(id)}>
            {t(`compliance.template.${id}`)}
          </button>
        ))}
      </div>
      <span className="field-hint">{t("compliance.hint")}</span>
    </fieldset>
  );
}

/**
 * "European models only": the lineup is limited to European models. Locked when the server or the workspace requires it,
 * and unavailable when no European model is configured.
 */
export function EuropeanToggle({
  policy,
  available,
  gateway,
  checked,
  onChange,
}: {
  policy: EuropeanPolicy;
  available: boolean;
  gateway: EuropeanGateway;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  const { t } = useTranslation();
  const required = policy === "required";
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={checked}
        disabled={required || (!available && !checked)}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        {t("european.label")}
        <span className="field-hint">
          {t("european.hint")}
          {gateway ? ` ${t(gateway === "eu" ? "european.gatewayEu" : "european.gatewayGlobal")}` : ""}
          {required ? ` ${t("european.required")}` : ""}
          {!available ? ` ${t("european.unavailable")}` : ""}
        </span>
      </span>
    </label>
  );
}

/** The arbiter's compliance assessment of the options, in the session's language. */
export function ComplianceSection({ session }: { session: Session }) {
  const { t } = useTranslation();
  const section = complianceRows(session);
  if (!section) return null;
  const labels = complianceLabels(session.locale as Locale);
  const tone = { met: "", partly: "severity-major", not_met: "severity-blocking", not_applicable: "severity-minor" } as const;
  return (
    <section className="stack">
      <h2 className="heading">{labels.heading}</h2>
      <p className="field-hint" style={{ margin: 0 }}>
        {labels.intro}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">{labels.requirement}</th>
              {section.seats.map((seat) => (
                <th scope="col" key={seat}>
                  {seat === "U" ? t("role.yourSolution") : `${t("verdict.option")} ${seat}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {section.rows.map((row) => (
              <tr key={row.requirement.id}>
                <th scope="row">
                  {row.label}
                  {row.requirement.hard ? <span className="field-hint"> ({labels.hard})</span> : null}
                </th>
                {section.seats.map((seat) => {
                  const check = row.checks[seat] ?? null;
                  return (
                    <td key={seat}>
                      <span className={`chip ${check ? tone[check.status] : "severity-minor"}`}>
                        {statusName(check?.status ?? null, session)}
                      </span>{" "}
                      {check?.reason}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
