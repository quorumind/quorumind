import { agencyLabels } from "./agency-labels.ts";
import { deliveryChecks, type OptionChecks, proposalCosting, type Range } from "./costing.ts";
import type { Locale } from "./locales.ts";
import { rankOptions } from "./ranking.ts";
import {
  checkLine,
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
import { formatDate } from "./revision-report.ts";
import type { Brief, Feasibility, Verdict } from "./schemas.ts";
import { currentProposals, type Mode, type Session } from "./session.ts";

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
}

export function clientDeliverable(session: Session): ClientDeliverable {
  const verdict = session.verdict;
  const criteria = (session.sheet?.priorities ?? []).map(({ criterion, weight }) => ({ criterion, weight }));
  const base = {
    // The person's own words about the project stay private: the name the interview gave it, once there is one.
    title: session.sheet?.projectName ?? "",
    locale: session.locale,
    mode: session.mode,
    date: session.updatedAt,
    criteria,
  };
  if (!verdict || session.phase !== "complete") {
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
    };
  }
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
      packages: costing.packages.map(({ name, description, days, cost }) => ({ name, description, days, cost })),
      days: costing.days,
      total: costing.total,
      monthly: { low: monthly.low, high: monthly.high },
      buildWeeks: proposal.buildWeeks,
      assumptions: costing.assumptions,
      exclusions: costing.exclusions,
      checks: checks[optionSeat] ?? null,
    };
  };
  const seat = verdict.recommendation.seat;
  const brief = session.briefs.client;
  const revision = session.revisions.at(-1);
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
    risks: verdict.risks,
    roadmap: verdict.roadmap,
    openQuestions: verdict.openQuestions,
    brief: brief ? { headline: brief.headline, summary: brief.summary, sections: brief.sections, nextSteps: brief.nextSteps } : null,
  };
}

const list = (items: string[]) => items.map((item) => `- ${item}`).join("\n");
const cell = (text: string) => text.replaceAll("|", "\\|").replaceAll("\n", " ");

/** The client deliverable as Markdown, in the session's language: what a client share link downloads. */
export function renderClientReport(deliverable: ClientDeliverable): string {
  const t = reportLabels(deliverable.locale);
  const say = (label: string, value: string) => labelled(label, value, deliverable.locale);
  const revision = deliverable.revision
    ? ` · ${fill(agencyLabels(deliverable.locale).revisionDated, { number: deliverable.revision.number, date: formatDate(deliverable.revision.date, deliverable.locale) })}`
    : "";
  const lines = [`# ${deliverable.title || t.title}`, "", `_${t.title} · ${deliverable.date.slice(0, 10)}${revision}_`, ""];
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
  lines.push(`_${t.generated}_`, "");
  return lines.join("\n");
}
