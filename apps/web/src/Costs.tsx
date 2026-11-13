import type { Session, UsageRecord } from "@quorumind/core";
import { totalCost } from "@quorumind/core/session";
import { Fragment, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollRegion } from "./components/ScrollRegion.tsx";
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
  const groups = groupBySteps(session.usage);
  const marked = MARKS.filter((mark) => session.usage.some((record) => record[mark]));
  return (
    <div className="stack">
      {!providerCosts ? (
        <p className="field-hint">{t("costs.included")}</p>
      ) : !total.complete ? (
        <p className="field-hint">{t("cost.partial")}</p>
      ) : null}
      <ScrollRegion label={t("tabs.costs")}>
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
          {groups.map((group) => (
            <StepRows key={group.key} group={group} providerCosts={providerCosts} />
          ))}
          <tfoot>
            <tr>
              <th scope="row" colSpan={3}>
                {t("costs.total")}
              </th>
              <td className="num figure">{number.format(session.usage.reduce((sum, record) => sum + record.inputTokens, 0))}</td>
              <td className="num figure">{number.format(session.usage.reduce((sum, record) => sum + record.outputTokens, 0))}</td>
              {providerCosts ? (
                <td className="num figure">
                  {formatUsd(total.usd, i18n.language)}
                  {!total.complete ? (
                    <>
                      {" "}
                      <span className="chip" title={t("cost.partial")}>
                        {t("costs.partial")}
                        <span className="visually-hidden">. {t("cost.partial")}</span>
                      </span>
                    </>
                  ) : null}
                </td>
              ) : null}
            </tr>
          </tfoot>
        </table>
      </ScrollRegion>
      {marked.map((mark) => (
        <p key={mark} className="field-hint">
          {t(`costs.${mark}Hint`)}
        </p>
      ))}
    </div>
  );
}

/** The calls of one step of the debate, in the order the step first appeared. */
interface StepGroup {
  key: string;
  /** The task whose name the step goes by. */
  task: UsageRecord["task"];
  records: UsageRecord[];
}

/**
 * The calls by step: the model searches and the research that frames them are one step, "Web research", so that the
 * table does not list two almost homonymous steps one after the other.
 */
function groupBySteps(usage: UsageRecord[]): StepGroup[] {
  const groups: StepGroup[] = [];
  for (const record of usage) {
    const key = record.task === "search" ? "research" : record.task;
    const found = groups.find((group) => group.key === key);
    if (found) found.records.push(record);
    else groups.push({ key, task: key as UsageRecord["task"], records: [record] });
  }
  return groups;
}

const sum = (records: UsageRecord[], pick: (record: UsageRecord) => number) => records.reduce((total, record) => total + pick(record), 0);

/**
 * A step's rows: its total on a first row, and, when it holds several calls, a button that shows them one by one
 * (folded, as the total says what most people look for). A step of a single call is just that call.
 */
function StepRows({ group, providerCosts }: { group: StepGroup; providerCosts: boolean }) {
  const { t, i18n } = useTranslation();
  const number = new Intl.NumberFormat(i18n.language);
  const id = useId();
  const [open, setOpen] = useState(false);
  const step = t(`task.${group.task}`);
  const many = group.records.length > 1;
  const costs = group.records.map((record) => record.costUsd);
  const cost = (value: number | null) => (value === null ? t("costs.unknown") : formatUsd(value, i18n.language));
  const known = costs.filter((value): value is number => value !== null);
  const detail = (record: UsageRecord, index: number, nested: boolean) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: usage records are append-only and have no identity of their own.
    <tr key={index} id={`${id}-${index}`} hidden={nested && !open} className={nested ? "costs-call" : undefined}>
      <td>
        {nested ? null : step}
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
      <td className="num figure">{number.format(record.inputTokens)}</td>
      <td className="num figure">{number.format(record.outputTokens)}</td>
      {providerCosts ? <td className="num figure">{cost(record.costUsd)}</td> : null}
    </tr>
  );
  if (!many) return <tbody>{group.records.map((record, index) => detail(record, index, false))}</tbody>;
  return (
    <tbody>
      <tr className="costs-step">
        <th scope="row" colSpan={3}>
          <button
            type="button"
            className="costs-toggle"
            aria-expanded={open}
            aria-controls={group.records.map((_, index) => `${id}-${index}`).join(" ")}
            aria-label={t(open ? "costs.hideStep" : "costs.showStep", { step })}
            onClick={() => setOpen(!open)}
          >
            <span className="costs-chevron" aria-hidden="true" />
            {step}
          </button>
        </th>
        <td className="num figure">{number.format(sum(group.records, (record) => record.inputTokens))}</td>
        <td className="num figure">{number.format(sum(group.records, (record) => record.outputTokens))}</td>
        {providerCosts ? (
          <td className="num figure">
            {known.length === 0
              ? t("costs.unknown")
              : formatUsd(
                  known.reduce((a, b) => a + b, 0),
                  i18n.language,
                )}
            {/* Some calls have no known price: the sum is of the known ones only, and says so. */}
            {known.length > 0 && known.length < costs.length ? (
              <>
                {" "}
                <span className="chip" title={t("costs.partialHint")}>
                  {t("costs.partial")}
                  <span className="visually-hidden">. {t("costs.partialHint")}</span>
                </span>
              </>
            ) : null}
          </td>
        ) : null}
      </tr>
      {group.records.map((record, index) => detail(record, index, true))}
    </tbody>
  );
}
