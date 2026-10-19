import type { Session, Severity } from "@quorumind/core";
import { questionsText, quoteCheck } from "@quorumind/core/audit-check";
import { auditLabels, OPINION_HINTS, OPINION_LABELS } from "@quorumind/core/audit-labels";
import { type AuditDeliverable, auditWords } from "@quorumind/core/audit-report";
import { debateCurrency } from "@quorumind/core/costing";
import { formatMoney } from "@quorumind/core/report";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckIcon, WarningIcon } from "./components/Icons.tsx";
import { contentLanguage } from "./format.ts";

// The audit of a document on screen: its findings (filtered by severity, with the passages they are about), what the
// document covers, its price and timeline with its figures recomputed, the questions to send and the points to
// negotiate. The words of the audit are those of its reports (core audit labels), so the screen and the documents agree.

const SEVERITIES: Severity[] = ["blocking", "major", "minor"];

/** The overall opinion and what it means, in the session's language. */
export function auditHeadline(audit: AuditDeliverable): { opinion: string; hint: string } {
  const a = auditLabels(audit.locale);
  return { opinion: a[OPINION_LABELS[audit.opinion]], hint: a[OPINION_HINTS[audit.opinion]] };
}

function Findings({ audit }: { audit: AuditDeliverable }) {
  const { t } = useTranslation();
  const w = auditWords(audit);
  const [shown, setShown] = useState<Severity | null>(null);
  if (audit.findings.length === 0) return null;
  const count = (severity: Severity | null) =>
    severity ? audit.findings.filter((finding) => finding.severity === severity).length : audit.findings.length;
  const findings = shown ? audit.findings.filter((finding) => finding.severity === shown) : audit.findings;
  return (
    <section className="stack">
      <div className="row audit-findings-head">
        <h2 className="heading">{w.a.findings}</h2>
        <fieldset className="segmented">
          <legend className="visually-hidden">{t("audit.filter")}</legend>
          <button type="button" aria-pressed={shown === null} onClick={() => setShown(null)}>
            {t("audit.all", { count: count(null) })}
          </button>
          {SEVERITIES.filter((severity) => count(severity) > 0).map((severity) => (
            <button key={severity} type="button" aria-pressed={shown === severity} onClick={() => setShown(severity)}>
              {w.severity(severity)} · {count(severity)}
            </button>
          ))}
        </fieldset>
      </div>
      <p className="field-hint" style={{ margin: 0 }}>
        {w.a.severityLegend}
      </p>
      <ol className="audit-findings">
        {findings.map((finding) => (
          <li key={`${finding.severity}-${finding.title}`} className={`card audit-finding audit-finding-${finding.severity}`}>
            <div className="row" style={{ gap: "var(--space-2)" }}>
              <span className={`chip severity-${finding.severity}`}>{w.severity(finding.severity)}</span>
              <span className="chip">{w.category(finding.category)}</span>
            </div>
            <strong>{finding.title}</strong>
            {finding.quote ? (
              <figure className="audit-quote">
                <figcaption className="field-hint">{w.a.inDocument}</figcaption>
                <blockquote dir="auto">{finding.quote}</blockquote>
              </figure>
            ) : (
              <p className="field-hint" style={{ margin: 0 }}>
                {w.a.notInDocument}
              </p>
            )}
            {finding.detail ? <p style={{ margin: 0 }}>{finding.detail}</p> : null}
            {finding.fix ? (
              <p style={{ margin: 0 }}>
                <strong>{w.a.fix}</strong> {finding.fix}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Coverage({ audit }: { audit: AuditDeliverable }) {
  const w = auditWords(audit);
  if (audit.coverage.length === 0) return null;
  return (
    <section className="stack">
      <h2 className="heading">{w.a.coverage}</h2>
      <ul className="audit-coverage">
        {audit.coverage.map((entry) => (
          <li key={entry.item} className={`audit-coverage-${entry.status}`}>
            <span className="audit-coverage-icon">
              {entry.status === "covered" ? <CheckIcon /> : entry.status === "not_applicable" ? null : <WarningIcon />}
            </span>
            <span>
              <strong>{w.item(entry.item)}</strong> <span className="chip">{w.status(entry.status)}</span>
              {entry.note ? <span className="field-hint">{entry.note}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Price({ audit }: { audit: AuditDeliverable }) {
  const w = auditWords(audit);
  const { a } = w;
  const check = audit.check;
  const money = (value: number | null) => (value === null ? "–" : w.money(value));
  const notes = [...w.figureNotes(), check?.averageRate != null ? w.say(a.averageRate, w.money(check.averageRate)) : ""].filter(Boolean);
  return (
    <section className="stack">
      <h2 className="heading">{a.price}</h2>
      <p style={{ margin: 0 }}>
        <span className="chip">{w.priceAssessment}</span> {audit.price.comment}
      </p>
      {check && check.lines.length > 0 ? (
        <div className="table-wrap">
          <table>
            <caption className="visually-hidden">{a.recomputed}</caption>
            <thead>
              <tr>
                <th scope="col">{a.line}</th>
                <th scope="col">{a.days}</th>
                <th scope="col">{a.dayRate}</th>
                <th scope="col">{a.stated}</th>
                <th scope="col">{a.computed}</th>
                <th scope="col">{a.gap}</th>
              </tr>
            </thead>
            <tbody>
              {check.lines.map((line) => (
                <tr key={line.name}>
                  <th scope="row">{line.name}</th>
                  <td className="mono nowrap">{w.days(line.days)}</td>
                  <td className="mono nowrap">{money(line.dailyRate)}</td>
                  <td className="mono nowrap">{money(line.stated)}</td>
                  <td className="mono nowrap">{money(line.computed)}</td>
                  <td className={`mono nowrap${line.gap ? " audit-gap" : ""}`}>{line.gap === null ? "–" : money(line.gap)}</td>
                </tr>
              ))}
              <tr>
                <th scope="row">{a.linesTotal}</th>
                <td className="mono nowrap">{w.days(check.days)}</td>
                <td />
                <td className="mono nowrap">{money(check.linesTotal)}</td>
                <td />
                <td />
              </tr>
              {w.statedTotal ? (
                <tr>
                  <th scope="row">{a.statedTotal}</th>
                  <td />
                  <td />
                  <td className="mono nowrap">{w.statedTotal}</td>
                  <td />
                  <td className={`mono nowrap${check.totalGap ? " audit-gap" : ""}`}>
                    {check.totalGap === null ? "–" : money(check.totalGap)}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}
      {notes.length > 0 ? (
        <ul style={{ margin: 0 }}>
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
      {audit.price.market && w.market ? (
        <div className="stack" style={{ gap: "var(--space-1)" }}>
          <p style={{ margin: 0 }}>
            <strong>{a.marketRange}</strong> <span className="mono">{w.market}</span>
            {w.position ? <span className="chip">{w.position}</span> : null}
          </p>
          <p className="field-hint" style={{ margin: 0 }}>
            {audit.price.market.basis} {a.marketNote}
          </p>
        </div>
      ) : null}
      {w.budget ? <p style={{ margin: 0 }}>{w.say(w.t.budget, w.budget)}</p> : null}
    </section>
  );
}

function Questions({ audit }: { audit: AuditDeliverable }) {
  const { t } = useTranslation();
  const w = auditWords(audit);
  const [copied, setCopied] = useState<"done" | "failed" | null>(null);
  if (audit.questions.length === 0) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(questionsText(audit));
      setCopied("done");
    } catch {
      setCopied("failed");
    }
  };
  return (
    <section className="stack audit-questions">
      <div className="row audit-findings-head">
        <h2 className="heading">{w.a.questions}</h2>
        <button type="button" className="button button-secondary" onClick={copy}>
          {t("audit.copy")}
        </button>
      </div>
      <p className="field-hint" style={{ margin: 0 }}>
        {w.a.questionsIntro}
      </p>
      <ol style={{ margin: 0 }}>
        {audit.questions.map((question) => (
          <li key={question}>{question}</li>
        ))}
      </ol>
      <p className="field-hint" role="status" style={{ margin: 0 }}>
        {copied === "done" ? t("audit.copied") : copied === "failed" ? t("audit.copyFailed") : ""}
      </p>
    </section>
  );
}

function Commitments({ audit }: { audit: AuditDeliverable }) {
  const w = auditWords(audit);
  const { a } = w;
  const { commitments } = audit;
  const list = (label: string, items: string[]) =>
    items.length > 0 ? (
      <div>
        <h3 className="title">{label}</h3>
        <ul style={{ margin: 0 }}>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    ) : null;
  return (
    <details className="card">
      <summary className="title">{a.commitments}</summary>
      <div className="two-col" style={{ marginBlockStart: "var(--space-4)" }}>
        <div className="stack">
          {list(a.scope, commitments.scope)}
          {list(a.deliverables, commitments.deliverables)}
          {list(a.technologies, commitments.technologies)}
        </div>
        <div className="stack">
          <dl className="audit-terms">
            {w.terms().map(([label, value]) => (
              <div key={label}>
                <dt className="field-hint">{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {list(a.exclusions, commitments.exclusions)}
          {list(a.assumptions, commitments.assumptions)}
        </div>
      </div>
    </details>
  );
}

function Alternative({ audit }: { audit: AuditDeliverable }) {
  const w = auditWords(audit);
  const { a, t } = w;
  const alternative = audit.alternative;
  if (!alternative) return null;
  const range = (value: { low: number; high: number; currency: string }) =>
    value.low === value.high
      ? w.money(value.low, value.currency)
      : `${w.money(value.low, value.currency)} – ${w.money(value.high, value.currency)}`;
  const price = audit.check?.statedTotal ?? audit.check?.linesTotal ?? null;
  return (
    <section className="stack">
      <h2 className="heading">{a.alternative}</h2>
      <p className="field-hint" style={{ margin: 0 }}>
        {a.alternativeNote}
      </p>
      <p style={{ margin: 0 }}>
        <strong>{alternative.title}</strong> {alternative.summary}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col" />
              <th scope="col">{a.documentColumn}</th>
              <th scope="col">{a.alternativeColumn}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">{t.buildCost}</th>
              <td className="mono nowrap">{price === null ? "–" : w.money(price)}</td>
              <td className="mono nowrap">{alternative.buildCost ? `${range(alternative.buildCost)} (${t.estimate})` : "–"}</td>
            </tr>
            <tr>
              <th scope="row">{t.buildTime}</th>
              <td>
                {audit.timeline.weeks ? w.weeks({ low: audit.timeline.weeks, high: audit.timeline.weeks }) : (audit.timeline.stated ?? "–")}
              </td>
              <td>{w.weeks(alternative.buildWeeks) ?? "–"}</td>
            </tr>
            <tr>
              <th scope="row">{t.monthlyCost}</th>
              <td className="mono nowrap">{audit.commitments.monthlyCost === null ? "–" : w.money(audit.commitments.monthlyCost)}</td>
              <td className="mono nowrap">{`${range(alternative.monthlyCost)} (${t.estimate})`}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {alternative.feasibility && alternative.reason ? (
        <p style={{ margin: 0 }}>
          <strong>{t[alternative.feasibility]}</strong> {alternative.reason}
        </p>
      ) : null}
    </section>
  );
}

/** What the formalizer read the document to commit to, in the transcript: before any judgement. */
export function DocumentRead({ session }: { session: Session }) {
  const extraction = session.audit?.extraction;
  const check = quoteCheck(session);
  if (!extraction) return null;
  const a = auditLabels(session.locale);
  const money = (value: number) => formatMoney(value, check?.currency ?? debateCurrency(session), session.locale);
  return (
    <div className="stack" style={{ gap: "var(--space-2)" }} {...contentLanguage(session.locale)}>
      <div className="title">{extraction.title}</div>
      <p style={{ margin: 0 }}>{extraction.summary}</p>
      <dl className="audit-terms">
        {extraction.provider ? (
          <div>
            <dt className="field-hint">{a.provider}</dt>
            <dd>{extraction.provider}</dd>
          </div>
        ) : null}
        <div>
          <dt className="field-hint">{a.statedTotal}</dt>
          <dd className="mono">{check?.statedTotal != null ? money(check.statedTotal) : a.notStated}</dd>
        </div>
        <div>
          <dt className="field-hint">{a.statedTimeline}</dt>
          <dd>{extraction.timeline.text ?? a.notStated}</dd>
        </div>
      </dl>
      {extraction.scope.length > 0 ? (
        <ul style={{ margin: 0 }}>
          {extraction.scope.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Everything the audit says, for the verdict page and the client share. */
export function AuditView({ audit }: { audit: AuditDeliverable }) {
  // The audit's words follow the session's language, like its reports; the interface's own follow the interface.
  const w = auditWords(audit);
  const { a } = w;
  return (
    <div className="stack-lg audit-view" {...contentLanguage(audit.locale)}>
      <dl className="audit-facts">
        <div>
          <dt className="field-hint">{a.documentAudited}</dt>
          <dd>
            {audit.document.title} · {w.kind}
            {audit.document.provider ? ` · ${audit.document.provider}` : ""}
          </dd>
        </div>
        {w.statedTotal ? (
          <div>
            <dt className="field-hint">{a.statedTotal}</dt>
            <dd className="mono">{w.statedTotal}</dd>
          </div>
        ) : null}
        {w.market ? (
          <div>
            <dt className="field-hint">{a.marketRange}</dt>
            <dd className="mono">{w.market}</dd>
          </div>
        ) : null}
        <div>
          <dt className="field-hint">{a.categoryTimeline}</dt>
          <dd>
            {w.timelineAssessment}
            {w.deadline ? ` · ${w.deadline}` : ""}
          </dd>
        </div>
      </dl>
      <Findings audit={audit} />
      <Questions audit={audit} />
      {audit.negotiation.length > 0 ? (
        <section className="stack">
          <h2 className="heading">{a.negotiation}</h2>
          <ul style={{ margin: 0 }}>
            {audit.negotiation.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </section>
      ) : null}
      <Price audit={audit} />
      <section className="stack">
        <h2 className="heading">{a.timeline}</h2>
        <p style={{ margin: 0 }}>
          <span className="chip">{w.timelineAssessment}</span> {audit.timeline.comment}
        </p>
        {audit.timeline.stated ? (
          <p className="field-hint" style={{ margin: 0 }}>
            {w.say(a.statedTimeline, audit.timeline.stated)}
          </p>
        ) : null}
      </section>
      <Coverage audit={audit} />
      <Alternative audit={audit} />
      <Commitments audit={audit} />
    </div>
  );
}
