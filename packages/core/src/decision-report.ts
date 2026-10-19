import { agencyLabels } from "./agency-labels.ts";
import { type ComparedOption, type ComparedRequirements, type ComparedSide, compareRevisions, type RevisionComparison } from "./compare.ts";
import { complianceLabels, type RequirementId } from "./compliance-labels.ts";
import { statusName as complianceStatusName } from "./compliance-report.ts";
import type { OptionChecks, Range } from "./costing.ts";
import { type DecisionLabels, decisionLabels } from "./decision-labels.ts";
import { approvalOf, type DecisionStatus, decisionStatus, type RegisterEntry } from "./decisions.ts";
import { toCsv } from "./exports/csv.ts";
import type { Locale } from "./locales.ts";
import {
  checkLine,
  fill,
  formatMoney,
  formatRange,
  formatScore,
  joinItems,
  labelled,
  type ReportLabels,
  reportLabels,
  seatName,
  weeksText,
} from "./report.ts";
import { formatDate } from "./revision-report.ts";
import type { RevisionScenario, ScenarioChange } from "./scenarios.ts";
import type { Session, VerdictRevision } from "./session.ts";

// The decision register and the comparison of two versions in the documents: the status line of the reports and
// the ADR, the names of the versions and of a scenario's changes, the comparison as Markdown, and the register as
// CSV. Every export renders them the same way.

const latin = (locale: Locale) => (locale === "ar" || locale === "hi" ? `${locale}-u-nu-latn` : locale);

/** A calendar date (YYYY-MM-DD) in the language's long form, whatever the time zone. */
export function formatDay(date: string, locale: Locale): string {
  const parsed = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return date;
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(parsed);
}

const STATUS_KEYS: Record<DecisionStatus, keyof DecisionLabels> = {
  proposed: "statusProposed",
  approved: "statusApproved",
  rejected: "statusRejected",
  superseded: "statusSuperseded",
};

export const decisionStatusName = (status: DecisionStatus, d: DecisionLabels) => d[STATUS_KEYS[status]];

/** The decision's status as the documents state it, e.g. "Accepted, approved by Ada Lovelace on 19 October 2026". */
export function decisionStatusText(session: Session): string | null {
  const status = decisionStatus(session);
  if (!status) return null;
  const d = decisionLabels(session.locale);
  const decision = session.decision;
  const word = decisionStatusName(status, d);
  const when = (iso: string) => formatDate(iso, session.locale);
  let detail = "";
  if (status === "approved") {
    const approval = approvalOf(session);
    if (approval) {
      const values = { name: approval.by.name ?? "", date: when(approval.at) };
      detail = fill(approval.by.name ? d.approvedBy : d.approvedOn, values);
    }
  } else if (decision?.closure) {
    const { closure } = decision;
    if (closure.status === "superseded" && closure.supersededBy) {
      detail = fill(d.supersededBy, { title: closure.supersededTitle ?? closure.supersededBy });
    } else {
      detail = fill(closure.by.name ? d.rejectedBy : d.rejectedOn, { name: closure.by.name ?? "", date: when(closure.at) });
    }
  }
  return detail ? fill(d.statusLine, { status: word, detail }) : word;
}

/** The register's lines of a document: the status, an outdated approval, a request, the note and the review. */
export function decisionFacts(session: Session): string[] {
  const status = decisionStatusText(session);
  if (!status) return [];
  const locale = session.locale;
  const t = reportLabels(locale);
  const d = decisionLabels(locale);
  const decision = session.decision;
  const facts = [labelled(t.status, status, locale)];
  const approval = approvalOf(session);
  if (approval?.comment) facts.push(labelled(d.comment, approval.comment, locale));
  if (!approval && decision?.approval && !decision.closure) {
    facts.push(fill(d.outdatedApproval, { number: decision.approval.revision, date: formatDate(decision.approval.at, locale) }));
  }
  if (decision?.closure?.comment) facts.push(labelled(d.comment, decision.closure.comment, locale));
  if (decision?.request && decisionStatus(session) === "proposed") {
    const values = { name: decision.request.by.name ?? "", date: formatDate(decision.request.at, locale) };
    facts.push(fill(decision.request.by.name ? d.approvalRequested : d.approvalRequestedOn, values));
  }
  if (decision?.note) facts.push(labelled(d.note, decision.note, locale));
  if (decision?.review.on) facts.push(fill(d.reviewOn, { date: formatDay(decision.review.on, locale) }));
  if (decision?.review.when) facts.push(fill(d.reviewWhen, { condition: decision.review.when }));
  return facts;
}

/** The "Decision" section of the Markdown report: nothing until someone records something in the register. */
export function decisionMarkdown(session: Session): string[] {
  if (!session.decision) return [];
  const facts = decisionFacts(session);
  if (facts.length === 0) return [];
  return [`## ${decisionLabels(session.locale).decision}`, "", ...facts.map((fact) => `- ${fact}`), ""];
}

const signed = (value: number, locale: Locale) => new Intl.NumberFormat(latin(locale), { signDisplay: "always" }).format(value);

/** One change of a scenario in the document's language, e.g. "Build budget −30 %". */
export function changeText(change: ScenarioChange, locale: Locale): string {
  const t = reportLabels(locale);
  const d = decisionLabels(locale);
  if (change.kind === "team") return fill(d.changeTeam, { delta: signed(change.delta, locale) });
  if (change.kind === "budget") {
    const percent = new Intl.NumberFormat(latin(locale), { style: "percent", signDisplay: "always" }).format(change.percent / 100);
    return fill(change.target === "build" ? d.changeBuildBudget : d.changeRunBudget, { percent });
  }
  if (change.kind === "deadline") {
    return fill(d.changeDeadline, { delta: fill(change.unit === "week" ? t.weeks : t.months, { count: signed(change.delta, locale) }) });
  }
  return fill(d.changeConstraint, { text: change.text });
}

/** The changes a scenario tries, then its question, as lines. */
export function scenarioLines(scenario: RevisionScenario, locale: Locale): string[] {
  const d = decisionLabels(locale);
  return [
    ...scenario.changes.map((change) => changeText(change, locale)),
    ...(scenario.question ? [labelled(d.question, scenario.question, locale)] : []),
  ];
}

/** How a document names a version: "Revision 3", or "Scenario “Budget cut” · Revision 4". */
export function versionName(revision: Pick<VerdictRevision, "number" | "scenario">, locale: Locale): string {
  const a = agencyLabels(locale);
  const d = decisionLabels(locale);
  const number = fill(a.revision, { number: revision.number });
  return revision.scenario ? `${fill(d.scenarioNamed, { title: revision.scenario.title })} · ${number}` : number;
}

const cell = (text: string) => text.replaceAll("|", "\\|").replaceAll("\n", " ");
const range = (value: (Range & { currency: string }) | null, locale: Locale) => (value ? formatRange(value, locale) : "–");

/** The values a comparison shows for one option, row by row, with whether each differs. */
function optionRows(
  comparison: RevisionComparison,
  seat: string,
  locale: Locale,
  t: ReportLabels,
  d: DecisionLabels,
): { label: string; left: string; right: string; differs: boolean }[] {
  const was = comparison.left.options.find((option) => option.seat === seat) ?? null;
  const is = comparison.right.options.find((option) => option.seat === seat) ?? null;
  const diff = comparison.diff.options[seat];
  const value = (option: ComparedOption | null, get: (option: ComparedOption) => string) => (option ? get(option) : "–");
  const feasibility = (option: ComparedOption) => (option.feasibility ? t[option.feasibility] : d.notRuled);
  const score = (option: ComparedOption, criterion: string) => String(option.scores[criterion] ?? "–");
  const checks = (option: ComparedOption) => checkLine(option.checks ?? (undefined as OptionChecks | undefined), t, locale) || "–";
  return [
    { label: t.feasibility, left: value(was, feasibility), right: value(is, feasibility), differs: diff?.feasibility ?? false },
    {
      label: t.weightedScore,
      left: value(was, (option) => (option.weighted === null ? "–" : formatScore(option.weighted, locale))),
      right: value(is, (option) => (option.weighted === null ? "–" : formatScore(option.weighted, locale))),
      differs: diff?.weighted ?? false,
    },
    ...comparison.criteria.map((criterion) => ({
      label: criterion,
      left: value(was, (option) => score(option, criterion)),
      right: value(is, (option) => score(option, criterion)),
      differs: diff?.scores.includes(criterion) ?? false,
    })),
    {
      label: t.buildCost,
      left: value(was, (option) => range(option.build, locale)),
      right: value(is, (option) => range(option.build, locale)),
      differs: diff?.build ?? false,
    },
    {
      label: t.monthlyCost,
      left: value(was, (option) => range(option.monthly, locale)),
      right: value(is, (option) => range(option.monthly, locale)),
      differs: diff?.monthly ?? false,
    },
    {
      label: t.buildTime,
      left: value(was, (option) => weeksText(option.weeks, t, locale) ?? "–"),
      right: value(is, (option) => weeksText(option.weeks, t, locale) ?? "–"),
      differs: diff?.weeks ?? false,
    },
    { label: t.checks, left: value(was, checks), right: value(is, checks), differs: diff?.checks ?? false },
    // The arbiter's compliance assessment, requirement by requirement.
    ...comparison.compliance.map((id) => ({
      label: complianceLabels(locale).requirements[id as RequirementId] ?? id,
      left: value(was, (option) => complianceStatusName(option.compliance[id] ?? null, { locale })),
      right: value(is, (option) => complianceStatusName(option.compliance[id] ?? null, { locale })),
      differs: diff?.compliance.includes(id) ?? false,
    })),
  ];
}

/** The figures of the requirements a scenario can change, row by row. */
function requirementRows(
  comparison: RevisionComparison,
  locale: Locale,
  t: ReportLabels,
): { label: string; left: string; right: string; differs: boolean }[] {
  const money = (value: ComparedRequirements["build"]) => (value ? formatMoney(value.amount, value.currency, locale) : "–");
  const run = (value: ComparedRequirements["run"]) =>
    value ? fill(value.period === "year" ? t.perYear : t.perMonth, { amount: formatMoney(value.amount, value.currency, locale) }) : "–";
  const deadline = (value: ComparedRequirements) =>
    value.deadline
      ? formatDay(value.deadline, locale)
      : value.duration
        ? fill(value.duration.unit === "week" ? t.weeks : t.months, { count: value.duration.amount })
        : "–";
  const team = (value: number | null) => (value === null ? "–" : fill(t.teamSize, { count: value }));
  const { left, right } = comparison;
  const diff = comparison.diff.requirements;
  return [
    { label: t.buildBudget, left: money(left.requirements.build), right: money(right.requirements.build), differs: diff.build },
    { label: t.runBudget, left: run(left.requirements.run), right: run(right.requirements.run), differs: diff.run },
    { label: t.deadline, left: deadline(left.requirements), right: deadline(right.requirements), differs: diff.deadline },
    { label: t.team, left: team(left.requirements.team), right: team(right.requirements.team), differs: diff.team },
    {
      label: t.hardConstraints,
      left: joinItems(left.requirements.hardConstraints, locale) || "–",
      right: joinItems(right.requirements.hardConstraints, locale) || "–",
      differs: diff.constraints.added.length + diff.constraints.removed.length > 0,
    },
  ];
}

/** The pieces every rendering of a comparison shows, in the document's language. */
export interface ComparisonDocument {
  title: string;
  lead: string;
  summary: string;
  legend: string;
  columns: [string, string];
  /** Under each column: why the version exists, the changes it tries, whether it is the current one. */
  versions: { left: string[]; right: string[] };
  sections: { title: string; rows: { label: string; left: string; right: string; differs: boolean }[] }[];
  risks: { title: string; items: string[] }[];
}

function sideNotes(side: ComparedSide, locale: Locale): string[] {
  const a = agencyLabels(locale);
  const d = decisionLabels(locale);
  const reasons = { debate: a.reasonDebate, client_answers: a.reasonClientAnswers, edit: a.reasonEdit, scenario: a.reasonScenario };
  return [
    `${reasons[side.reason]} · ${formatDate(side.createdAt, locale)}${side.current ? ` · ${side.reason === "scenario" ? d.adopted : d.current}` : ""}`,
    ...(side.scenario ? scenarioLines(side.scenario, locale) : []),
  ];
}

/** Two versions of a session's decision side by side, ready to render; null when either does not exist. */
export function comparisonDocument(session: Session, a: number, b: number): ComparisonDocument | null {
  const comparison = compareRevisions(session, a, b);
  if (!comparison) return null;
  const locale = session.locale;
  const t = reportLabels(locale);
  const d = decisionLabels(locale);
  const name = (number: number) => versionName(session.revisions.find((revision) => revision.number === number) ?? { number }, locale);
  const columns: [string, string] = [name(a), name(b)];
  const option = (side: ComparedSide) => {
    const seat = side.recommendation.seat;
    return seat ? `${seatName(seat, t)}${side.recommendation.title ? `: ${side.recommendation.title}` : ""}` : t.noRecommendation;
  };
  const sections: ComparisonDocument["sections"] = [
    {
      title: t.recommendation,
      rows: [
        {
          label: t.recommendation,
          left: option(comparison.left),
          right: option(comparison.right),
          differs: comparison.diff.recommendation,
        },
      ],
    },
    { title: t.requirements, rows: requirementRows(comparison, locale, t) },
    ...comparison.seats.map((seat) => {
      const title =
        comparison.right.options.find((item) => item.seat === seat)?.title ??
        comparison.left.options.find((item) => item.seat === seat)?.title;
      return { title: `${seatName(seat, t)}${title ? `: ${title}` : ""}`, rows: optionRows(comparison, seat, locale, t, d) };
    }),
  ];
  const risk = (item: { risk: string; likelihood: "low" | "medium" | "high"; impact: "low" | "medium" | "high" }) =>
    `${item.risk} (${t.likelihood}: ${t[item.likelihood]}, ${t.impact}: ${t[item.impact]})`;
  const ag = agencyLabels(locale);
  const risks = [
    { title: `${t.risks} · ${fill(d.onlyIn, { version: columns[0] })}`, items: comparison.diff.risks.removed.map(risk) },
    { title: `${t.risks} · ${fill(d.onlyIn, { version: columns[1] })}`, items: comparison.diff.risks.added.map(risk) },
    {
      title: ag.risksChanged,
      items: comparison.diff.risks.changed.map((item) =>
        labelled(
          item.risk,
          fill(ag.fromTo, {
            from: `${t[item.from.likelihood]} / ${t[item.from.impact]}`,
            to: `${t[item.to.likelihood]} / ${t[item.to.impact]}`,
          }),
          locale,
        ),
      ),
    },
  ].filter((group) => group.items.length > 0);
  const count = comparison.diff.count;
  return {
    title: `${session.sheet?.projectName ?? session.idea.slice(0, 120)}: ${d.compareTitle}`,
    lead: fill(d.compareLead, { left: columns[0], right: columns[1] }),
    summary: count === 0 ? d.noDifference : fill(d.differences, { count: new Intl.NumberFormat(latin(locale)).format(count) }),
    legend: d.legend,
    columns,
    versions: { left: sideNotes(comparison.left, locale), right: sideNotes(comparison.right, locale) },
    sections,
    risks,
  };
}

/** The comparison as Markdown: a table per section, the values that differ in bold. */
export function renderComparison(session: Session, a: number, b: number): string | null {
  const doc = comparisonDocument(session, a, b);
  if (!doc) return null;
  const d = decisionLabels(session.locale);
  const bold = (text: string, differs: boolean) => (differs && text !== "–" ? `**${cell(text)}**` : cell(text));
  const lines = [`# ${doc.title}`, "", `_${doc.lead}_`, "", `${doc.summary} _${doc.legend}_`, ""];
  lines.push(`| ${d.version} | ${cell(doc.columns[0])} | ${cell(doc.columns[1])} |`, "| --- | --- | --- |");
  lines.push(`| | ${doc.versions.left.map(cell).join("<br>")} | ${doc.versions.right.map(cell).join("<br>")} |`, "");
  for (const section of doc.sections) {
    lines.push(`## ${section.title}`, "", `| | ${cell(doc.columns[0])} | ${cell(doc.columns[1])} |`, "| --- | --- | --- |");
    for (const row of section.rows) lines.push(`| ${cell(row.label)} | ${bold(row.left, row.differs)} | ${bold(row.right, row.differs)} |`);
    lines.push("");
  }
  for (const group of doc.risks) lines.push(`## ${group.title}`, "", ...group.items.map((item) => `- ${item}`), "");
  return lines.join("\n");
}

/** The register as CSV, in the language asked for: one row per decision, who started it, and a link to its session. */
export function renderRegisterCsv(
  entries: (RegisterEntry & { author?: string | null })[],
  locale: Locale,
  linkOf: (sessionId: string) => string,
): string {
  const t = reportLabels(locale);
  const d = decisionLabels(locale);
  const titles = new Map(entries.map((entry) => [entry.sessionId, entry.title]));
  const header = [
    d.decision,
    t.recommendation,
    t.status,
    d.version,
    d.approver,
    d.approvalDate,
    d.comment,
    d.note,
    d.reviewDate,
    d.reviewCondition,
    d.decidedAt,
    d.author,
    d.replacedBy,
    d.link,
  ];
  // Dates as YYYY-MM-DD, which every spreadsheet reads.
  const rows = entries.map((entry) => [
    entry.title,
    entry.recommendation ? `${seatName(entry.recommendation.seat, t)}: ${entry.recommendation.title}` : t.noRecommendation,
    decisionStatusName(entry.status, d),
    versionName(
      {
        number: entry.revision.number,
        ...(entry.revision.scenario ? { scenario: { title: entry.revision.scenario, question: null, changes: [] } } : {}),
      },
      locale,
    ),
    entry.approval ? (entry.approval.name ?? "") : "",
    entry.approval?.at.slice(0, 10) ?? "",
    entry.approval?.comment ?? "",
    entry.note ?? "",
    entry.review.on ?? "",
    entry.review.when ?? "",
    entry.decidedAt.slice(0, 10),
    entry.author ?? "",
    entry.supersededBy ? (titles.get(entry.supersededBy) ?? linkOf(entry.supersededBy)) : "",
    linkOf(entry.sessionId),
  ]);
  return toCsv(header, rows);
}
