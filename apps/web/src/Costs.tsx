import type { Session } from "@quorumind/core";
import { totalCost } from "@quorumind/core/session";
import { useTranslation } from "react-i18next";
import { formatUsd } from "./format.ts";

/**
 * Every model call of the session with its tokens and cost. Without `providerCosts`, the host sells
 * the debate at a price of its own: calls and tokens only.
 */
export function Costs({ session, providerCosts = true }: { session: Session; providerCosts?: boolean }) {
  const { t, i18n } = useTranslation();
  const number = new Intl.NumberFormat(i18n.language);
  const total = totalCost(session);
  return (
    <div className="stack">
      {!providerCosts ? (
        <p className="field-hint">{t("costs.included")}</p>
      ) : !total.complete ? (
        <p className="field-hint">{t("cost.partial")}</p>
      ) : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">{t("costs.step")}</th>
              <th scope="col">{t("costs.who")}</th>
              <th scope="col">{t("costs.model")}</th>
              <th scope="col" className="num">
                {t("costs.input")}
              </th>
              <th scope="col" className="num">
                {t("costs.output")}
              </th>
              {providerCosts ? (
                <th scope="col" className="num">
                  {t("costs.cost")}
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {session.usage.map((record, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: usage records are append-only and have no identity of their own.
              <tr key={index}>
                <td>{t(`task.${record.task}`)}</td>
                <td>
                  {record.seat
                    ? t("role.proposer", { seat: record.seat })
                    : record.task === "interview"
                      ? t("role.interviewer")
                      : t("role.arbiter")}
                </td>
                <td className="mono">{record.model}</td>
                <td className="num mono">{number.format(record.inputTokens)}</td>
                <td className="num mono">{number.format(record.outputTokens)}</td>
                {providerCosts ? (
                  <td className="num mono">{record.costUsd === null ? t("costs.unknown") : formatUsd(record.costUsd, i18n.language)}</td>
                ) : null}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={3}>
                {t("costs.total")}
              </th>
              <td className="num mono">{number.format(session.usage.reduce((sum, record) => sum + record.inputTokens, 0))}</td>
              <td className="num mono">{number.format(session.usage.reduce((sum, record) => sum + record.outputTokens, 0))}</td>
              {providerCosts ? <td className="num mono">{formatUsd(total.usd, i18n.language)}</td> : null}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
