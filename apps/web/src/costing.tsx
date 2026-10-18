import type { Session } from "@quorumind/core";
import { type CheckStatus, type Costing, debateCurrency, type OptionChecks, type Range } from "@quorumind/core/costing";
import { isGenericRole } from "@quorumind/core/profile";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { formatMoney } from "./format.ts";

/** "€12,300 – €15,500", or a single amount when both ends are equal. */
export function moneyRange(range: Range, currency: string, locale: string): string {
  return range.low === range.high
    ? formatMoney(range.low, currency, locale)
    : `${formatMoney(range.low, currency, locale)} – ${formatMoney(range.high, currency, locale)}`;
}

/** Person-days with one decimal at most: "12.5 – 15". */
export function dayRange(range: Range, locale: string): string {
  const days = (value: number) => value.toLocaleString(locale, { maximumFractionDigits: 1 });
  return range.low === range.high ? days(range.low) : `${days(range.low)} – ${days(range.high)}`;
}

/** The monthly running cost of a proposal, in the debate's currency (or its own, for one stored before). */
export function monthlyCurrency(session: Session, monthlyCost: { low: number; high: number }): string {
  return (monthlyCost as { currency?: string }).currency ?? debateCurrency(session);
}

/** A role of a costing: the rate card's name, a generic role in the person's language, or the id as written. */
export function roleName(line: { role: string; name: string | null }, t: TFunction): string {
  if (line.name) return line.name;
  return isGenericRole(line.role) ? t(`roles.${line.role}`) : line.role.replaceAll("_", " ");
}

const ORDER: Record<CheckStatus, number> = { over: 0, at_risk: 1, within: 2 };

/** The budget and deadline checks of an option as texts, the problems first. */
export function checkTexts(checks: OptionChecks | undefined, t: TFunction, locale: string): { status: CheckStatus; text: string }[] {
  if (!checks) return [];
  const items: { status: CheckStatus; text: string }[] = [];
  if (checks.build) {
    const { status, by, currency } = checks.build;
    const amount = formatMoney(by, currency, locale);
    items.push({
      status,
      text: status === "within" ? t("checks.withinBudget") : t(`checks.${status === "over" ? "overBudget" : "budgetAtRisk"}`, { amount }),
    });
  }
  if (checks.run) {
    const { status, by, currency } = checks.run;
    const amount = formatMoney(by, currency, locale);
    items.push({
      status,
      text:
        status === "within"
          ? t("checks.withinRunBudget")
          : t(`checks.${status === "over" ? "overRunBudget" : "runBudgetAtRisk"}`, { amount }),
    });
  }
  if (checks.time) {
    const { status, by } = checks.time;
    items.push({
      status,
      text: status === "within" ? t("checks.onTime") : t(`checks.${status === "over" ? "late" : "lateAtRisk"}`, { count: by }),
    });
  }
  return items.sort((a, b) => ORDER[a.status] - ORDER[b.status]);
}

/** The checks of an option as badges: red when over, amber when at risk, green when it fits. */
export function CheckBadges({ checks }: { checks: OptionChecks | undefined }) {
  const { t, i18n } = useTranslation();
  const items = checkTexts(checks, t, i18n.language);
  if (items.length === 0) return null;
  return (
    <span className="check-badges">
      {items.map((item) => (
        <span key={item.text} className={`check-badge check-${item.status}`}>
          {item.text}
        </span>
      ))}
    </span>
  );
}

/** One option's costing: its work packages role by role, the total, where the rates come from, and its limits. */
export function CostingTable({ costing, caption }: { costing: Costing; caption: string }) {
  const { t, i18n } = useTranslation();
  const money = (value: number) => formatMoney(value, costing.currency, i18n.language);
  const range = (value: Range) => moneyRange(value, costing.currency, i18n.language);
  const note =
    costing.rates === "profile"
      ? t("costing.ratesProfile")
      : costing.rates === "estimated"
        ? t("costing.ratesEstimated")
        : t("costing.ratesLegacy");
  return (
    <div className="stack" style={{ gap: "var(--space-3)" }}>
      {costing.packages.length > 0 ? (
        <div className="table-wrap">
          <table className="costing">
            <caption className="visually-hidden">{caption}</caption>
            <thead>
              <tr>
                <th scope="col">{t("costing.workPackage")}</th>
                <th scope="col">{t("costing.role")}</th>
                <th scope="col" className="num">
                  {t("costing.days")}
                </th>
                <th scope="col" className="num">
                  {t("costing.dayRate")}
                </th>
                <th scope="col" className="num">
                  {t("costing.amount")}
                </th>
              </tr>
            </thead>
            <tbody>
              {costing.packages.map((item) =>
                item.lines.map((line, index) => (
                  <tr key={`${item.name}:${line.role}:${line.days.low}:${line.days.high}`}>
                    {index === 0 ? (
                      <th scope="row" rowSpan={item.lines.length}>
                        {item.name}
                        {item.description ? <span className="field-hint costing-description">{item.description}</span> : null}
                      </th>
                    ) : null}
                    <td>{roleName(line, t)}</td>
                    <td className="num mono">{dayRange(line.days, i18n.language)}</td>
                    <td className="num mono">{line.dailyRate === null ? "–" : money(line.dailyRate)}</td>
                    <td className="num mono">{line.cost ? range(line.cost) : "–"}</td>
                  </tr>
                )),
              )}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={2}>
                  {t("costing.total")}
                </th>
                <td className="num mono">{dayRange(costing.days, i18n.language)}</td>
                <td />
                <td className="num mono">{range(costing.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <p style={{ margin: 0 }}>
          <span className="field-hint">{t("debate.buildCost")}</span> <span className="mono">{range(costing.total)}</span>
        </p>
      )}
      <p className="field-hint" style={{ margin: 0 }}>
        {note}
        {costing.unpriced.length > 0
          ? ` ${t("costing.unpriced", { roles: costing.unpriced.map((role) => roleName({ role, name: null }, t)).join(", ") })}`
          : ""}
      </p>
      {costing.assumptions.length > 0 || costing.exclusions.length > 0 ? (
        <div className="two-col">
          {costing.assumptions.length > 0 ? (
            <div>
              <h4>{t("debate.assumptions")}</h4>
              <ul style={{ margin: 0 }}>
                {costing.assumptions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {costing.exclusions.length > 0 ? (
            <div>
              <h4>{t("costing.exclusions")}</h4>
              <ul style={{ margin: 0 }}>
                {costing.exclusions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
