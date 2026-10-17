import type { Session } from "@quorumind/core";
import { totalCost } from "@quorumind/core/session";
import { useTranslation } from "react-i18next";
import { formatUsd } from "./format.ts";

/** Every model call of the session with its tokens and cost. */
export function Costs({ session }: { session: Session }) {
  const { t, i18n } = useTranslation();
  const number = new Intl.NumberFormat(i18n.language);
  const total = totalCost(session);
  return (
    <div className="stack">
      {!total.complete ? <p className="field-hint">{t("cost.partial")}</p> : null}
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
              <th scope="col" className="num">
                {t("costs.cost")}
              </th>
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
                <td className="num mono">{record.costUsd === null ? t("costs.unknown") : formatUsd(record.costUsd, i18n.language)}</td>
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
              <td className="num mono">{formatUsd(total.usd, i18n.language)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
