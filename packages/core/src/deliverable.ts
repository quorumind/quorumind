import type { Locale } from "./locales.ts";
import { rankOptions } from "./ranking.ts";
import { fill, formatScore, labelled, reportLabels, seatName } from "./report.ts";
import type { Brief, Feasibility, Verdict } from "./schemas.ts";
import { currentProposals, type Mode, type Session } from "./session.ts";

/**
 * The decision as a client reads it, from a "client" share link: the verdict's summary and recommendation, the
 * options with their scores, the risks, the roadmap, the open questions and the brief written for a client. It is
 * built from an allowlist: never the transcript, the interview, the requirements sheet, the costs or the documents.
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
  const seat = verdict.recommendation.seat;
  const brief = session.briefs.client;
  return {
    ...base,
    complete: true,
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
      return [{ seat: optionSeat, title, feasibility, reason, conditions, scores, weightedScore: ranked.score }];
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
  const lines = [`# ${deliverable.title || t.title}`, "", `_${t.title} · ${deliverable.date.slice(0, 10)}_`, ""];
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
