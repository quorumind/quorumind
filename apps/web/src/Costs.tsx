import type { Session } from "@quorumind/core";
import { totalCost } from "@quorumind/core/session";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { seatName } from "./Debate.tsx";
import { formatUsd } from "./format.ts";

/** The labels a call may carry: billed although it failed, tokens estimated without the provider's count. */
const MARKS = ["failed", "estimated"] as const;

/**
 * Every model call of the session with its tokens and cost. Without `providerCosts`, the host sells
 * the debate at a price of its own: calls and tokens only. A call that failed but is billed, and one whose tokens
 * are an estimate, carry a label explained under the table.
 */
export function Costs({ session, providerCosts = true }: { session: Session; providerCosts?: boolean }) {
  const { t, i18n } = useTranslation();
  const number = new Intl.NumberFormat(i18n.language);
  const total = totalCost(session);
  const marked = MARKS.filter((mark) => session.usage.some((record) => record[mark]));
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
                <td>
                  {t(`task.${record.task}`)}
                  {MARKS.filter((mark) => record[mark]).map((mark) => (
                    <Fragment key={mark}>
                      {" "}
                      <span className="chip" title={t(`costs.${mark}Hint`)}>
                        {t(`costs.${mark}`)}
                      </span>
                    </Fragment>
                  ))}
                </td>
                <td>{record.seat ? seatName(record.seat, t) : record.task === "interview" ? t("role.interviewer") : t("role.arbiter")}</td>
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
      {marked.map((mark) => (
        <p key={mark} className="field-hint">
          {t(`costs.${mark}Hint`)}
        </p>
      ))}
    </div>
  );
}
