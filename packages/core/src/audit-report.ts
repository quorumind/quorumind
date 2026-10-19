import { agencyLabels } from "./agency-labels.ts";
import type { AuditDocumentKind, AuditOpinion, AuditReport } from "./audit.ts";
import { auditedDocuments, auditOf, pricePosition, type QuoteCheck, quoteCheck } from "./audit-check.ts";
import {
  type AuditLabels,
  auditLabels,
  CATEGORY_LABELS,
  CHECKLIST_LABELS,
  COVERAGE_LABELS,
  KIND_LABELS,
  OPINION_HINTS,
  OPINION_LABELS,
  POSITION_LABELS,
  PRICE_LABELS,
  SEVERITY_LABELS,
  TIMELINE_LABELS,
} from "./audit-labels.ts";
import { complianceMarkdown } from "./compliance-report.ts";
import { debateCurrency, proposalCosting, type Range } from "./costing.ts";
import type { Locale } from "./locales.ts";
import {
  budgetLine,
  deadlineText,
  fill,
  formatDays,
  formatMoney,
  formatRange,
  joinItems,
  labelled,
  methodNotes,
  monthlyRange,
  participants,
  type ReportLabels,
  reportLabels,
  weeksText,
} from "./report.ts";
import { formatDate } from "./revision-report.ts";
import type { Feasibility, Severity, Verdict } from "./schemas.ts";
import { alternativeSeat, currentProposals, type Session, USER_SEAT } from "./session.ts";

/**
 * The audit as its reader needs it: the opinion, the findings with the passages they are about, what the document
 * covers, its price and timeline judged and its figures recomputed, the questions to send and the points to negotiate,
 * what the document commits to and the alternative it was compared with. Every export of an audit is rendered from it,
 * and a client share link shows it as it is: an allowlist that never holds the transcript, the interview, the costs of
 * the models nor the documents beyond the passages quoted.
 */
export interface AuditDeliverable {
  locale: Locale;
  /** The currency of the debate, in which the market range is estimated. */
  currency: string;
  document: { title: string; provider: string | null; kind: AuditDocumentKind; names: string[] };
  opinion: AuditOpinion;
  rationale: string;
  /** The arbiter's summary. */
  summary: string | null;
  findings: AuditReport["findings"];
  coverage: AuditReport["coverage"];
  price: AuditReport["price"] & { position: "below" | "within" | "above" | null };
  check: QuoteCheck | null;
  /** The arbiter's judgement, with the timeline the document states, in words and in weeks. */
  timeline: AuditReport["timeline"] & { stated: string | null; weeks: number | null };
  questions: string[];
  negotiation: string[];
  commitments: {
    scope: string[];
    deliverables: string[];
    technologies: string[];
    hosting: string | null;
    maintenance: string | null;
    warranties: string | null;
    paymentTerms: string | null;
    ownership: string | null;
    exclusions: string[];
    assumptions: string[];
    monthlyCost: number | null;
  };
  /** The approach sketched from the need alone, as the arbiter ruled on it; null when none was asked for. */
  alternative: {
    title: string;
    summary: string;
    feasibility: Feasibility | null;
    reason: string | null;
    buildCost: (Range & { currency: string }) | null;
    monthlyCost: Range & { currency: string };
    buildWeeks: Range | null;
  } | null;
  risks: Verdict["risks"];
  roadmap: Verdict["roadmap"];
  openQuestions: string[];
}

/** The audit of a session whose arbiter has ruled, or null otherwise. */
export function auditDeliverable(session: Session): AuditDeliverable | null {
  const verdict = session.phase === "complete" ? session.verdict : null;
  const audit = auditOf(verdict);
  const extraction = session.audit?.extraction;
  if (!verdict || !audit || !extraction) return null;
  const currency = debateCurrency(session);
  const check = quoteCheck(session);
  const seat = alternativeSeat(session);
  const proposal = seat ? currentProposals(session)[seat] : undefined;
  const option = seat ? verdict.options.find((item) => item.seat === seat) : undefined;
  const costing = proposal ? proposalCosting(session, proposal) : null;
  // The market range is in the debate's currency: it is compared with the document's price only in that currency.
  const position = !check?.currency || check.currency === currency ? pricePosition(check, audit.price.market) : null;
  return {
    locale: session.locale,
    currency,
    document: {
      title: extraction.title,
      provider: extraction.provider,
      kind: extraction.kind,
      names: auditedDocuments(session).map((doc) => doc.name),
    },
    opinion: audit.opinion,
    rationale: verdict.recommendation.rationale,
    summary: verdict.speech.trim() || null,
    findings: audit.findings,
    coverage: audit.coverage,
    price: { ...audit.price, position },
    check,
    timeline: { ...audit.timeline, stated: extraction.timeline.text, weeks: extraction.timeline.weeks },
    questions: audit.questions,
    negotiation: audit.negotiation,
    commitments: {
      scope: extraction.scope,
      deliverables: extraction.deliverables,
      technologies: extraction.technologies,
      hosting: extraction.hosting,
      maintenance: extraction.maintenance,
      warranties: extraction.warranties,
      paymentTerms: extraction.paymentTerms,
      ownership: extraction.ownership,
      exclusions: extraction.exclusions,
      assumptions: extraction.assumptions,
      monthlyCost: extraction.monthlyCost.amount,
    },
    alternative: proposal
      ? {
          title: proposal.title,
          summary: proposal.summary,
          feasibility: option?.feasibility ?? null,
          reason: option?.reason ?? null,
          buildCost: costing ? { ...costing.total, currency: costing.currency } : null,
          monthlyCost: monthlyRange(session, proposal),
          buildWeeks: proposal.buildWeeks,
        }
      : null,
    risks: verdict.risks,
    roadmap: verdict.roadmap,
    openQuestions: verdict.openQuestions,
  };
}

const SEVERITIES: Severity[] = ["blocking", "major", "minor"];

/** The words and the formatting an audit document is written with. */
export function auditWords(audit: AuditDeliverable) {
  const a = auditLabels(audit.locale);
  const t = reportLabels(audit.locale);
  const locale = audit.locale;
  const docCurrency = audit.check?.currency ?? audit.currency;
  const money = (value: number, currency = docCurrency) => formatMoney(value, currency, locale);
  const tax = audit.check?.taxIncluded === true ? a.taxIncluded : audit.check?.taxIncluded === false ? a.taxExcluded : null;
  return {
    a,
    t,
    money,
    say: (label: string, value: string) => labelled(label, value, locale),
    opinion: a[OPINION_LABELS[audit.opinion]],
    opinionHint: a[OPINION_HINTS[audit.opinion]],
    severity: (value: Severity) => a[SEVERITY_LABELS[value]],
    category: (value: AuditReport["findings"][number]["category"]) => a[CATEGORY_LABELS[value]],
    item: (value: AuditReport["coverage"][number]["item"]) => a[CHECKLIST_LABELS[value]],
    status: (value: AuditReport["coverage"][number]["status"]) => a[COVERAGE_LABELS[value]],
    kind: a[KIND_LABELS[audit.document.kind]],
    priceAssessment: a[PRICE_LABELS[audit.price.assessment]],
    timelineAssessment: a[TIMELINE_LABELS[audit.timeline.assessment]],
    /** The stated total with its tax mention, e.g. "38,000 € excl. tax". */
    statedTotal: audit.check?.statedTotal != null ? `${money(audit.check.statedTotal)}${tax ? ` ${tax}` : ""}` : null,
    market: audit.price.market
      ? formatRange({ low: audit.price.market.low, high: audit.price.market.high, currency: audit.currency }, locale)
      : null,
    position: audit.price.position ? a[POSITION_LABELS[audit.price.position]] : null,
    budget: audit.check?.budget
      ? audit.check.budget.status === "over"
        ? fill(a.budgetOver, { budget: money(audit.check.budget.amount), amount: money(audit.check.budget.by) })
        : fill(a.budgetWithin, { budget: money(audit.check.budget.amount) })
      : null,
    deadline: audit.check?.deadline
      ? audit.check.deadline.status === "over"
        ? fill(a.deadlineOver, { weeks: audit.check.deadline.by })
        : a.deadlineWithin
      : null,
    /** What the recomputation found, in a sentence each: the gaps, or that the figures add up. */
    figureNotes: (): string[] => {
      const check = audit.check;
      if (!check) return [];
      const notes: string[] = [];
      if (check.mismatches > 0) notes.push(fill(a.lineGaps, { count: check.mismatches }));
      if (check.totalGap) notes.push(fill(a.totalGap, { amount: money(Math.abs(check.totalGap)) }));
      if (check.statedTotal === null) notes.push(a.noTotal);
      else if (check.mismatches === 0 && check.totalGap === 0) notes.push(a.figuresAgree);
      return notes;
    },
    days: (value: number | null) => (value === null ? "–" : formatDays(value, locale)),
    weeks: (value: Range | null) => weeksText(value, t, locale),
    groups: () =>
      SEVERITIES.map((severity) => ({ severity, items: audit.findings.filter((finding) => finding.severity === severity) })).filter(
        (group) => group.items.length > 0,
      ),
    /** What the document says on each of its terms, "Not stated" when it says nothing. */
    terms: (): [string, string][] => [
      [a.hosting, audit.commitments.hosting ?? a.notStated],
      [a.itemMaintenance, audit.commitments.maintenance ?? a.notStated],
      [a.warranties, audit.commitments.warranties ?? a.notStated],
      [a.paymentTerms, audit.commitments.paymentTerms ?? a.notStated],
      [a.itemOwnership, audit.commitments.ownership ?? a.notStated],
      [a.statedTimeline, audit.timeline.stated ?? a.notStated],
      [
        a.recurringCost,
        audit.commitments.monthlyCost === null ? a.notStated : fill(a.perMonth, { amount: money(audit.commitments.monthlyCost) }),
      ],
    ],
    revision: (revision: { number: number; date: string } | null) =>
      revision ? fill(agencyLabels(locale).revisionDated, { number: revision.number, date: formatDate(revision.date, locale) }) : null,
  };
}

export type AuditWords = ReturnType<typeof auditWords>;

const list = (items: string[]) => items.map((item) => `- ${item}`).join("\n");
const cell = (text: string) => text.replaceAll("|", "\\|").replaceAll("\n", " ");
const quoteBlock = (text: string) =>
  text
    .split("\n")
    .map((line) => `   > ${line}`)
    .join("\n");

/** The audit's own sections as Markdown, shared by the full report and the client share. */
export function auditMarkdown(audit: AuditDeliverable): string[] {
  const w = auditWords(audit);
  const { a, t, say } = w;
  const lines: string[] = [];

  lines.push(`## ${say(a.opinion, w.opinion)}`, "", `_${w.opinionHint}_`, "", audit.rationale, "");
  if (audit.summary) lines.push(audit.summary, "");
  const facts = [
    say(a.documentAudited, `${audit.document.title} (${w.kind}${audit.document.provider ? `, ${audit.document.provider}` : ""})`),
    w.statedTotal ? say(a.statedTotal, w.statedTotal) : "",
    w.market ? say(a.marketRange, `${w.market}${w.position ? ` · ${w.position}` : ""}`) : "",
    w.budget ? say(t.budget, w.budget) : "",
    say(a.categoryTimeline, `${w.timelineAssessment}${w.deadline ? ` · ${w.deadline}` : ""}`),
  ].filter(Boolean);
  lines.push(list(facts), "");

  if (audit.findings.length > 0) {
    lines.push(`## ${a.findings}`, "", `_${a.severityLegend}_`, "");
    for (const group of w.groups()) {
      lines.push(`### ${w.severity(group.severity)}`, "");
      group.items.forEach((finding, index) => {
        lines.push(`${index + 1}. **${finding.title}** _(${w.category(finding.category)})_`);
        lines.push(finding.quote ? `${quoteBlock(finding.quote)}` : `   _${a.notInDocument}_`);
        if (finding.detail) lines.push(`   ${finding.detail}`);
        if (finding.fix) lines.push(`   ${say(`**${a.fix}**`, finding.fix)}`);
        lines.push("");
      });
    }
  }

  if (audit.coverage.length > 0) {
    lines.push(`## ${a.coverage}`, "", `| ${a.checkItem} | ${a.status} | ${a.note} |`, "| --- | --- | --- |");
    for (const entry of audit.coverage) lines.push(`| ${w.item(entry.item)} | ${w.status(entry.status)} | ${cell(entry.note)} |`);
    lines.push("");
  }

  lines.push(`## ${a.price}`, "", `**${w.priceAssessment}**. ${audit.price.comment}`, "");
  const check = audit.check;
  if (check && check.lines.length > 0) {
    const money = (value: number | null) => (value === null ? "–" : w.money(value));
    lines.push(
      `### ${a.recomputed}`,
      "",
      `| ${a.line} | ${a.days} | ${a.dayRate} | ${a.stated} | ${a.computed} | ${a.gap} |`,
      "| --- | --- | --- | --- | --- | --- |",
    );
    for (const line of check.lines) {
      lines.push(
        `| ${cell(line.name)} | ${w.days(line.days)} | ${money(line.dailyRate)} | ${money(line.stated)} | ${money(line.computed)} | ${line.gap ? `**${w.money(line.gap)}**` : line.gap === 0 ? "0" : "–"} |`,
      );
    }
    lines.push(`| **${a.linesTotal}** | **${w.days(check.days)}** | | **${money(check.linesTotal)}** | | |`);
    if (w.statedTotal)
      lines.push(`| **${a.statedTotal}** | | | **${w.statedTotal}** | | ${check.totalGap ? `**${w.money(check.totalGap)}**` : "0"} |`);
    lines.push("");
    const notes = [...w.figureNotes(), check.averageRate !== null ? say(a.averageRate, w.money(check.averageRate)) : ""].filter(Boolean);
    if (notes.length > 0) lines.push(list(notes), "");
  } else {
    const notes = w.figureNotes();
    if (notes.length > 0) lines.push(list(notes), "");
  }
  if (audit.price.market && w.market) {
    lines.push(say(`**${a.marketRange}**`, `${w.market}${w.position ? ` (${w.position})` : ""}. ${audit.price.market.basis}`), "");
    lines.push(`_${a.marketNote}_`, "");
  }

  lines.push(`## ${a.timeline}`, "", `**${w.timelineAssessment}**. ${audit.timeline.comment}`, "");
  if (audit.timeline.stated || w.deadline) {
    lines.push(list([audit.timeline.stated ? say(a.statedTimeline, audit.timeline.stated) : "", w.deadline ?? ""].filter(Boolean)), "");
  }

  if (audit.questions.length > 0) {
    lines.push(`## ${a.questions}`, "", `_${a.questionsIntro}_`, "", audit.questions.map((q, i) => `${i + 1}. ${q}`).join("\n"), "");
  }
  if (audit.negotiation.length > 0) lines.push(`## ${a.negotiation}`, "", list(audit.negotiation), "");

  lines.push(`## ${a.commitments}`, "");
  const { commitments } = audit;
  if (commitments.scope.length > 0) lines.push(`**${a.scope}**`, "", list(commitments.scope), "");
  if (commitments.deliverables.length > 0) lines.push(`**${a.deliverables}**`, "", list(commitments.deliverables), "");
  if (commitments.technologies.length > 0) lines.push(say(`**${a.technologies}**`, commitments.technologies.join(", ")), "");
  lines.push(list(w.terms().map(([label, value]) => say(`**${label}**`, value))), "");
  if (commitments.exclusions.length > 0) lines.push(`**${a.exclusions}**`, "", list(commitments.exclusions), "");
  if (commitments.assumptions.length > 0) lines.push(`**${a.assumptions}**`, "", list(commitments.assumptions), "");

  const alternative = audit.alternative;
  if (alternative) {
    lines.push(`## ${a.alternative}`, "", `_${a.alternativeNote}_`, "", `**${alternative.title}**`, "", alternative.summary, "");
    const price = audit.check?.statedTotal ?? audit.check?.linesTotal ?? null;
    lines.push(
      `| | ${a.documentColumn} | ${a.alternativeColumn} |`,
      "| --- | --- | --- |",
      `| ${t.buildCost} | ${price !== null ? w.money(price) : "–"} | ${alternative.buildCost ? `${formatRange(alternative.buildCost, audit.locale)} (${t.estimate})` : "–"} |`,
      `| ${t.buildTime} | ${audit.timeline.weeks ? w.weeks({ low: audit.timeline.weeks, high: audit.timeline.weeks }) : (audit.timeline.stated ?? "–")} | ${w.weeks(alternative.buildWeeks) ?? "–"} |`,
      `| ${t.monthlyCost} | ${commitments.monthlyCost !== null ? fill(a.perMonth, { amount: w.money(commitments.monthlyCost) }) : "–"} | ${formatRange(alternative.monthlyCost, audit.locale)} (${t.estimate}) |`,
      "",
    );
    if (alternative.feasibility && alternative.reason) lines.push(say(`**${t[alternative.feasibility]}**`, alternative.reason), "");
  }

  if (audit.risks.length > 0) {
    lines.push(`## ${t.risks}`, "", `| ${t.risks} | ${t.likelihood} | ${t.impact} | ${t.mitigation} |`, "| --- | --- | --- | --- |");
    for (const risk of audit.risks)
      lines.push(`| ${cell(risk.risk)} | ${t[risk.likelihood]} | ${t[risk.impact]} | ${cell(risk.mitigation)} |`);
    lines.push("");
  }
  if (audit.roadmap.length > 0) {
    lines.push(`## ${a.nextSteps}`, "");
    audit.roadmap.forEach((phase, index) => {
      lines.push(`${index + 1}. **${phase.phase}:** ${phase.content} (${say(t.exitCriterion, phase.exitCriterion)})`);
    });
    lines.push("");
  }
  if (audit.openQuestions.length > 0) lines.push(`## ${t.openQuestions}`, "", list(audit.openQuestions), "");
  return lines;
}

/** The need the document was judged against, as label and value lines. */
export function needFacts(session: Session, t: ReportLabels): string[] {
  const sheet = session.sheet;
  if (!sheet) return [];
  const locale = session.locale;
  return [
    budgetLine(sheet, t, locale),
    deadlineText(sheet, t, locale) ? labelled(t.deadline, deadlineText(sheet, t, locale), locale) : "",
    sheet.mustHave.length > 0 ? labelled(t.mustHave, joinItems(sheet.mustHave, locale), locale) : "",
    sheet.hardConstraints.length > 0 ? labelled(t.hardConstraints, joinItems(sheet.hardConstraints, locale), locale) : "",
  ].filter(Boolean);
}

/** How an audit names its options: the document, and the alternative it was compared with. */
export function auditSeatName(seat: string, a: AuditLabels): string {
  return seat === USER_SEAT ? a.documentColumn : a.alternativeColumn;
}

/** The paragraphs of an audit's method box. */
export function auditMethodNotes(session: Session, a: AuditLabels, t: ReportLabels): string[] {
  return [a.methodText, ...methodNotes(session, t).slice(1)];
}

/** The audit report as Markdown, for the person who asked for it: the audit, the need and how it was produced. */
export function renderAuditReport(session: Session): string {
  const t = reportLabels(session.locale);
  const a = auditLabels(session.locale);
  const audit = auditDeliverable(session);
  const title = session.sheet?.projectName ?? session.audit?.extraction?.title ?? session.idea;
  const revision = session.revisions.at(-1);
  const revisionText =
    audit && revision && session.revisions.length > 1
      ? auditWords(audit).revision({ number: revision.number, date: revision.createdAt })
      : null;
  const lines = [`# ${title}`, "", `_${a.title} · ${session.updatedAt.slice(0, 10)}${revisionText ? ` · ${revisionText}` : ""}_`, ""];
  if (audit) lines.push(...auditMarkdown(audit));
  lines.push(...complianceMarkdown(session, (seat) => auditSeatName(seat, a)));
  if (session.sheet) {
    lines.push(`## ${a.need}`, "", session.sheet.summary, "");
    const facts = needFacts(session, t);
    if (facts.length > 0) lines.push(list(facts), "");
  }
  lines.push(`## ${a.method}`, "", ...auditMethodNotes(session, a, t).flatMap((note) => [note, ""]));
  lines.push(list(participants(session, t).map((item) => labelled(item.role, item.model, session.locale))), "");
  return lines.join("\n");
}

/** The audit as a client share link downloads it: the audit alone, then how it was produced. */
export function renderAuditClientReport(
  audit: AuditDeliverable,
  meta: { title: string; date: string; revision: { number: number; date: string } | null },
): string {
  const a = auditLabels(audit.locale);
  const t = reportLabels(audit.locale);
  const revision = auditWords(audit).revision(meta.revision);
  return [
    `# ${meta.title || audit.document.title}`,
    "",
    `_${a.title} · ${meta.date.slice(0, 10)}${revision ? ` · ${revision}` : ""}_`,
    "",
    ...auditMarkdown(audit),
    `## ${a.method}`,
    "",
    a.methodText,
    "",
    `_${t.generated}_`,
    "",
  ].join("\n");
}
