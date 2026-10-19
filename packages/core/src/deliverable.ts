import { agencyLabels } from "./agency-labels.ts";
import { type AuditDeliverable, auditDeliverable, renderAuditClientReport } from "./audit-report.ts";
import { deliveryChecks, type OptionChecks, proposalCosting, type Range } from "./costing.ts";
import type { Locale } from "./locales.ts";
import { withoutRates } from "./privacy.ts";
import { rankOptions } from "./ranking.ts";
import {
  budgetText,
  checkLine,
  deadlineText,
  fill,
  formatDayRange,
  formatMoney,
  formatScore,
  labelled,
  monthlyRange,
  reportLabels,
  seatName,
  weeksText,
} from "./report.ts";
import { type ResearchSection, researchSection, researchSectionMarkdown } from "./research-report.ts";
import { formatDate } from "./revision-report.ts";
import type { Brief, Feasibility, Verdict } from "./schemas.ts";
import { currentProposals, currentRevision, type Mode, type Session } from "./session.ts";

/**
 * What an option costs the client: its work packages with their days and amounts, the total, the running cost and the
 * build time, and how they compare with the budget and the deadline. Never the day rates behind the amounts.
 */
export interface DeliverableCosting {
  currency: string;
  packages: { name: string; description: string; days: Range; cost: Range }[];
  days: Range;
  total: Range;
  monthly: Range;
  buildWeeks: Range | null;
  assumptions: string[];
  exclusions: string[];
  checks: OptionChecks | null;
}

/**
 * The decision as a client reads it, from a "client" share link: the verdict's summary and recommendation, the
 * options with their scores and their costing, the risks, the roadmap, the open questions and the brief written for
 * a client. It is built from an allowlist: never the transcript, the interview, the requirements sheet, the costs of
 * the models, the day rates or the documents.
 */
export interface ClientDeliverable {
  /** The project's name; empty until the interview named it. */
  title: string;
  locale: Locale;
  mode: Mode;
  /** When the session last changed. */
  date: string;
  /** False until the arbiter has ruled: the deliverable is empty until then. */
  complete: boolean;
  /** The revision of the verdict it shows: its number and date. */
  revision: { number: number; date: string } | null;
  /** The arbiter's summary of the debate. */
  summary: string | null;
  recommendation: { seat: string | null; title: string | null; rationale: string } | null;
  /** The criteria the options are scored on, with their weight from 1 to 5. */
  criteria: { criterion: string; weight: number }[];
  /** Best first: the ranking of the weighted scores, infeasible options last. */
  options: {
    seat: string;
    title: string;
    feasibility: Feasibility;
    reason: string;
    conditions: string[];
    scores: { criterion: string; score: number }[];
    weightedScore: number | null;
    /** Null for an option without work packages or build cost. */
    costing: DeliverableCosting | null;
  }[];
  risks: Verdict["risks"];
  roadmap: Verdict["roadmap"];
  openQuestions: string[];
  /** The verdict rewritten for a client, once it was written. */
  brief: Omit<Brief, "speech"> | null;
  /** The audit, for an audit session: its findings, checks, questions and points to negotiate. */
  audit: AuditDeliverable | null;
  /** The facts the web research found, with their public sources; null without research. */
  research: ResearchSection | null;
}

/**
 * What a client may read of a model-written value: everything but the sentences and items that state a rate. An audit
 * keeps its text: the rates it examines are those of the document the person received, not the agency's.
 */
function forClient<T>(session: Pick<Session, "mode">, value: T): T {
  return session.mode === "audit" ? value : withoutRates(value);
}

export function clientDeliverable(session: Session): ClientDeliverable {
  const stored = session.verdict;
  const criteria = (session.sheet?.priorities ?? []).map(({ criterion, weight }) => ({ criterion, weight }));
  const base = {
    // The person's own words about the project stay private: the name the interview gave it, once there is one.
    title: session.sheet?.projectName ?? "",
    locale: session.locale,
    mode: session.mode,
    date: session.updatedAt,
    criteria,
  };
  if (!stored || session.phase !== "complete") {
    return {
      ...base,
      complete: false,
      revision: null,
      summary: null,
      recommendation: null,
      options: [],
      risks: [],
      roadmap: [],
      openQuestions: [],
      brief: null,
      audit: null,
      research: null,
    };
  }
  const verdict = forClient(session, stored);
  const weights = Object.fromEntries(criteria.map((item) => [item.criterion, item.weight]));
  const ranking = rankOptions(verdict, weights);
  const proposals = currentProposals(session);
  const checks = deliveryChecks(session);
  const costingOf = (optionSeat: string): DeliverableCosting | null => {
    const proposal = proposals[optionSeat];
    const costing = proposal ? proposalCosting(session, proposal) : null;
    if (!proposal || !costing) return null;
    const monthly = monthlyRange(session, proposal);
    return {
      currency: costing.currency,
      packages: costing.packages.map(({ name, description, days, cost }) => ({
        name,
        description: forClient(session, description),
        days,
        cost,
      })),
      days: costing.days,
      total: costing.total,
      monthly: { low: monthly.low, high: monthly.high },
      buildWeeks: proposal.buildWeeks,
      assumptions: forClient(session, costing.assumptions),
      exclusions: forClient(session, costing.exclusions),
      checks: checks[optionSeat] ?? null,
    };
  };
  const seat = verdict.recommendation.seat;
  const brief = session.briefs.client ? forClient(session, session.briefs.client) : undefined;
  const revision = currentRevision(session);
  return {
    ...base,
    complete: true,
    revision: revision ? { number: revision.number, date: revision.createdAt } : null,
    summary: verdict.speech.trim() || null,
    recommendation: {
      seat,
      title: seat
        ? (currentProposals(session)[seat]?.title ?? verdict.options.find((option) => option.seat === seat)?.title ?? null)
        : null,
      rationale: verdict.recommendation.rationale,
    },
    options: ranking.flatMap((ranked) => {
      const option = verdict.options.find((item) => item.seat === ranked.seat);
      if (!option) return [];
      const { seat: optionSeat, title, feasibility, reason, conditions, scores } = option;
      return [
        { seat: optionSeat, title, feasibility, reason, conditions, scores, weightedScore: ranked.score, costing: costingOf(optionSeat) },
      ];
    }),
    // A risk whose statement gave a rate has nothing left to say.
    risks: verdict.risks.filter((risk) => risk.risk.trim()),
    roadmap: verdict.roadmap,
    openQuestions: verdict.openQuestions,
    brief: brief ? { headline: brief.headline, summary: brief.summary, sections: brief.sections, nextSteps: brief.nextSteps } : null,
    audit: auditDeliverable(session),
    research: researchSection(session),
  };
}

const list = (items: string[]) => items.map((item) => `- ${item}`).join("\n");
const cell = (text: string) => text.replaceAll("|", "\\|").replaceAll("\n", " ");

/** The client deliverable as Markdown, in the session's language: what a client share link downloads. */
export function renderClientReport(deliverable: ClientDeliverable): string {
  if (deliverable.audit) return renderAuditClientReport(deliverable.audit, deliverable);
  const t = reportLabels(deliverable.locale);
  const say = (label: string, value: string) => labelled(label, value, deliverable.locale);
  const revision = deliverable.revision
    ? ` · ${fill(agencyLabels(deliverable.locale).revisionDated, { number: deliverable.revision.number, date: formatDate(deliverable.revision.date, deliverable.locale) })}`
    : "";
  const lines = [
    `# ${deliverable.title || t.title}`,
    "",
    `_${t.title} · ${formatDate(deliverable.date, deliverable.locale)}${revision}_`,
    "",
  ];
  const recommendation = deliverable.recommendation;
  if (!deliverable.complete || !recommendation) {
    lines.push(`_${t.generated}_`, "");
    return lines.join("\n");
  }

  lines.push(`## ${t.recommendation}`, "");
  const seat = recommendation.seat;
  const chosen = deliverable.options.find((option) => option.seat === seat);
  lines.push(
    seat
      ? `**${recommendation.title ?? seatName(seat, t)}** (${seatName(seat, t)}${chosen ? `, ${t[chosen.feasibility]}` : ""})`
      : `**${t.noRecommendation}**`,
    "",
    recommendation.rationale,
    "",
  );
  if (deliverable.summary) lines.push(`### ${t.summary}`, "", deliverable.summary, "");

  const brief = deliverable.brief;
  if (brief) {
    lines.push(`## ${fill(t.briefFor, { audience: t.audienceClient })}`, "", `**${brief.headline}**`, "", brief.summary, "");
    for (const section of brief.sections) lines.push(`### ${section.title}`, "", section.body, "");
    if (brief.nextSteps.length > 0)
      lines.push(`### ${t.nextSteps}`, "", brief.nextSteps.map((step, i) => `${i + 1}. ${step}`).join("\n"), "");
  }

  if (deliverable.options.length > 0) {
    const criteria = deliverable.criteria;
    lines.push(`## ${t.options}`, "");
    lines.push(
      `| ${t.option} | ${t.feasibility} | ${criteria.map((item) => `${cell(item.criterion)} (${fill(t.weight, { weight: item.weight })})`).join(" | ")} | ${t.weightedScore} |`,
    );
    lines.push(`| --- | --- |${criteria.map(() => " --- |").join("")} --- |`);
    for (const option of deliverable.options) {
      const scores = criteria.map((item) => option.scores.find((score) => score.criterion === item.criterion)?.score ?? "–");
      const weighted = option.weightedScore === null ? "–" : formatScore(option.weightedScore, deliverable.locale);
      lines.push(
        `| ${cell(seatName(option.seat, t))}: ${cell(option.title)} | ${t[option.feasibility]} | ${scores.join(" | ")} | ${weighted} |`,
      );
    }
    lines.push("", `_${t.scoreLegend}_`, "");
    for (const option of deliverable.options) {
      lines.push(`- **${seatName(option.seat, t)}, ${t[option.feasibility]}:** ${option.reason}`);
      if (option.conditions.length > 0) lines.push(`  - ${say(t.conditions, option.conditions.join("; "))}`);
    }
    lines.push("");
  }

  const costed = deliverable.options.filter((option) => option.costing);
  if (costed.length > 0) {
    lines.push(`## ${t.costing}`, "");
    for (const option of costed) {
      const costing = option.costing as DeliverableCosting;
      const money = (amount: number) => formatMoney(amount, costing.currency, deliverable.locale);
      const range = (value: Range) => (value.low === value.high ? money(value.low) : `${money(value.low)} – ${money(value.high)}`);
      lines.push(`### ${seatName(option.seat, t)}: ${option.title}`, "");
      if (costing.packages.length > 0) {
        lines.push(`| ${t.workPackage} | ${t.personDays} | ${t.amount} |`, "| --- | --- | --- |");
        for (const item of costing.packages) {
          lines.push(`| ${cell(item.name)} | ${formatDayRange(item.days, deliverable.locale)} | ${range(item.cost)} |`);
        }
        lines.push(`| **${t.total}** | **${formatDayRange(costing.days, deliverable.locale)}** | **${range(costing.total)}** |`, "");
      }
      const weeks = weeksText(costing.buildWeeks, t, deliverable.locale);
      const badges = checkLine(costing.checks ?? undefined, t, deliverable.locale);
      lines.push(
        list(
          [
            say(t.buildCost, range(costing.total)),
            say(t.monthlyCost, range(costing.monthly)),
            weeks ? say(t.buildTime, weeks) : "",
            badges ? say(t.checks, badges) : "",
          ].filter(Boolean),
        ),
        "",
      );
      if (costing.assumptions.length > 0) lines.push(`**${t.assumptions}**`, "", list(costing.assumptions), "");
      if (costing.exclusions.length > 0) lines.push(`**${t.exclusions}**`, "", list(costing.exclusions), "");
    }
  }

  if (deliverable.risks.length > 0) {
    lines.push(`## ${t.risks}`, "", `| ${t.risks} | ${t.likelihood} | ${t.impact} | ${t.mitigation} |`, "| --- | --- | --- | --- |");
    for (const risk of deliverable.risks) {
      lines.push(`| ${cell(risk.risk)} | ${t[risk.likelihood]} | ${t[risk.impact]} | ${cell(risk.mitigation)} |`);
    }
    lines.push("");
  }
  if (deliverable.roadmap.length > 0) {
    lines.push(`## ${t.roadmap}`, "");
    deliverable.roadmap.forEach((phase, index) => {
      lines.push(`${index + 1}. **${phase.phase}:** ${phase.content} (${say(t.exitCriterion, phase.exitCriterion)})`);
    });
    lines.push("");
  }
  if (deliverable.openQuestions.length > 0) lines.push(`## ${t.openQuestions}`, "", list(deliverable.openQuestions), "");
  lines.push(...researchSectionMarkdown(deliverable.research, deliverable.locale));
  lines.push(`_${t.generated}_`, "");
  return lines.join("\n");
}

/**
 * The proposal an agency sends its client, ready to edit: the context restated, the recommended solution, the
 * alternatives and why they were not retained, risks, roadmap, assumptions and exclusions, open questions and the
 * revision it is based on. Like the client deliverable it is an allowlist: never the transcript, the debate's
 * critiques, provider costs or anyone's internal notes.
 */
export interface ClientProposal {
  locale: Locale;
  /** The project's name. */
  title: string;
  /** Who it is prepared for, when the agency says so. */
  client: string | null;
  /** The current revision of the verdict: its number and date. */
  revision: { number: number; date: string } | null;
  context: {
    summary: string;
    goals: string[];
    successCriteria: string[];
    scope: string[];
    constraints: string[];
    /** The deadline and the budget as the requirements sheet states them, in words. */
    deadline: string | null;
    budget: string | null;
  } | null;
  /** Null when no option is feasible as it stands. */
  solution: {
    seat: string;
    title: string;
    summary: string;
    rationale: string;
    conditions: string[];
    architecture: string[];
    stack: string[];
    buildTime: string | null;
    buildWeeks: Range | null;
    monthlyCost: (Range & { currency: string }) | null;
    /** The total of its costing, when it has one. */
    buildCost: (Range & { currency: string }) | null;
  } | null;
  /** Shown when no option was recommended. */
  rationale: string | null;
  /** The other options, best first, with why they were not retained. */
  alternatives: { seat: string; title: string; summary: string | null; feasibility: Feasibility; reason: string; conditions: string[] }[];
  risks: Verdict["risks"];
  roadmap: Verdict["roadmap"];
  assumptions: string[];
  exclusions: string[];
  openQuestions: string[];
  /**
   * The recommended solution's costing by work package (days and amounts, never the day rates behind them), and how
   * it compares with the budget and the deadline; null when the option has no work packages.
   */
  costing: DeliverableCosting | null;
  /** The facts the web research found, with their public sources; null without research. */
  research: ResearchSection | null;
}

const unique = (items: string[]) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export function clientProposal(session: Session, options: { client?: string | null } = {}): ClientProposal {
  const sheet = session.sheet;
  const verdict = session.phase === "complete" ? session.verdict : null;
  const proposals = currentProposals(session);
  const revision = verdict ? currentRevision(session) : null;
  const deliverable = clientDeliverable(session);
  const seat = verdict?.recommendation.seat ?? null;
  const chosen = seat && proposals[seat] ? forClient(session, proposals[seat]) : undefined;
  const option = seat ? verdict?.options.find((item) => item.seat === seat) : undefined;
  const costing = deliverable.options.find((item) => item.seat === seat)?.costing ?? null;
  const t = reportLabels(session.locale);
  return {
    locale: session.locale,
    title: sheet?.projectName ?? "",
    client: options.client?.trim() || null,
    revision: revision ? { number: revision.number, date: revision.createdAt } : null,
    context: sheet
      ? {
          summary: sheet.summary,
          goals: sheet.goals,
          successCriteria: sheet.successCriteria,
          scope: sheet.mustHave,
          constraints: sheet.hardConstraints,
          deadline: deadlineText(sheet, t, session.locale) || null,
          budget: budgetText(sheet, t, session.locale) || null,
        }
      : null,
    solution:
      seat && verdict
        ? {
            seat,
            title: chosen?.title ?? option?.title ?? seat,
            summary: chosen?.summary ?? "",
            rationale: deliverable.recommendation?.rationale ?? "",
            conditions: deliverable.options.find((item) => item.seat === seat)?.conditions ?? [],
            architecture: chosen?.architecture ?? [],
            stack: chosen?.stack ?? [],
            buildTime: chosen?.buildTime ?? null,
            buildWeeks: chosen?.buildWeeks ?? null,
            monthlyCost: chosen ? monthlyRange(session, chosen) : null,
            buildCost: costing ? { ...costing.total, currency: costing.currency } : null,
          }
        : null,
    rationale: verdict && !seat ? (deliverable.recommendation?.rationale ?? null) : null,
    alternatives: deliverable.options
      .filter((item) => item.seat !== seat)
      .map((item) => ({
        seat: item.seat,
        title: proposals[item.seat]?.title ?? item.title,
        summary: forClient(session, proposals[item.seat]?.summary ?? null),
        feasibility: item.feasibility,
        reason: item.reason,
        conditions: item.conditions,
      })),
    risks: deliverable.risks,
    roadmap: deliverable.roadmap,
    assumptions: unique([...(sheet?.assumptions ?? []), ...(chosen?.assumptions ?? []), ...(costing?.assumptions ?? [])]),
    exclusions: unique([...(sheet?.outOfScope ?? []), ...(costing?.exclusions ?? [])]),
    openQuestions: deliverable.openQuestions,
    costing,
    research: deliverable.research,
  };
}
