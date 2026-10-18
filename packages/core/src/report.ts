import {
  type CheckStatus,
  type Costing,
  debateCurrency,
  deliveryChecks,
  type OptionChecks,
  proposalCosting,
  sessionProfile,
  threeYearCost,
} from "./costing.ts";
import type { DiagramComponent, DiagramFlow } from "./diagram.ts";
import type { Locale } from "./locales.ts";
import { isGenericRole, type OrgProfile } from "./profile.ts";
import { rankOptions } from "./ranking.ts";
import { LABELS, type Labels } from "./report-labels.ts";
import type { ComponentKind, Probe, Proposal, RequirementsSheet } from "./schemas.ts";
import { COMPLIANCE_KEYS, currentProposals, DEVIL_SEAT, type Session, USER_SEAT } from "./session.ts";

export { threeYearCost };

export type ReportLabels = Labels;

export function reportLabels(locale: Locale): Labels {
  return LABELS[locale] ?? LABELS.en;
}

/** How a seat is named in documents: an option letter, the person's own solution, or the devil's advocate. */
export function seatName(seat: string, t: Labels): string {
  if (seat === USER_SEAT) return t.yourSolution;
  if (seat === DEVIL_SEAT) return t.devil;
  return `${t.option} ${seat}`;
}

export function modeName(session: Session, t: Labels): string {
  return session.mode === "challenge" ? t.modeChallenge : session.mode === "express" ? t.modeExpress : t.modeStandard;
}

export function formatMoney(amount: number, currency: string, locale: Locale): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${new Intl.NumberFormat(locale).format(amount)} ${currency}`;
  }
}

/** A cost range such as "€120 – €260". */
export function formatRange(range: { low: number; high: number; currency: string }, locale: Locale): string {
  return `${formatMoney(range.low, range.currency, locale)} – ${formatMoney(range.high, range.currency, locale)}`;
}

/** Fills `{name}` placeholders of a label. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}

/** "Label: value" with the punctuation of the language: French puts a narrow no-break space before the colon. */
export function labelled(label: string, value: string, locale: Locale): string {
  return `${label}${locale === "fr" ? " :" : ":"} ${value}`;
}

/** A weighted score with one decimal, in the language's notation (Latin digits everywhere). */
export function formatScore(value: number, locale: Locale): string {
  const tag = locale === "ar" || locale === "hi" ? `${locale}-u-nu-latn` : locale;
  return new Intl.NumberFormat(tag, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
}

/** The monthly running cost of a proposal, in the debate's currency. */
export function monthlyRange(session: Session, proposal: Proposal): { low: number; high: number; currency: string } {
  const legacy = (proposal.monthlyCost as { currency?: string }).currency;
  return { low: proposal.monthlyCost.low, high: proposal.monthlyCost.high, currency: legacy ?? debateCurrency(session) };
}

/** The build cost of a proposal as Quorumind priced it, or null when it has none. */
export function buildRange(costing: Costing | null): { low: number; high: number; currency: string } | null {
  return costing ? { ...costing.total, currency: costing.currency } : null;
}

const GENERIC_ROLE_LABELS = {
  project_manager: "roleProjectManager",
  architect: "roleArchitect",
  senior_developer: "roleSeniorDeveloper",
  developer: "roleDeveloper",
  designer: "roleDesigner",
  tester: "roleTester",
  devops: "roleDevops",
} as const satisfies Record<string, keyof Labels>;

/** A role of a costing: the rate card's name, a generic role in the document's language, or the id as the model gave it. */
export function roleLabel(line: { role: string; name: string | null }, t: Labels): string {
  if (line.name) return line.name;
  return isGenericRole(line.role) ? t[GENERIC_ROLE_LABELS[line.role]] : line.role.replaceAll("_", " ");
}

/** Days such as "12.5", in the language's notation. */
export function formatDays(days: number, locale: Locale): string {
  const tag = locale === "ar" || locale === "hi" ? `${locale}-u-nu-latn` : locale;
  return new Intl.NumberFormat(tag, { maximumFractionDigits: 1 }).format(days);
}

/** "12 – 15" days, or one figure when the range is a single value. */
export function formatDayRange(range: { low: number; high: number }, locale: Locale): string {
  return range.low === range.high ? formatDays(range.low, locale) : `${formatDays(range.low, locale)} – ${formatDays(range.high, locale)}`;
}

/** The note under a costing: where its day rates come from, and the roles that had none. */
export function costingNotes(costing: Costing, t: Labels): string[] {
  const notes = [costing.rates === "profile" ? t.ratesProfile : costing.rates === "estimated" ? t.ratesEstimated : t.ratesLegacy];
  if (costing.unpriced.length > 0) {
    notes.push(fill(t.unpriced, { roles: costing.unpriced.map((role) => roleLabel({ role, name: null }, t)).join(", ") }));
  }
  return notes;
}

/** Items of a list on one line: French puts a narrow no-break space before the semicolon. */
export function joinItems(items: string[], locale: Locale): string {
  return items.join(locale === "fr" ? " ; " : "; ");
}

/** The budget and deadline checks of an option on one line, the problems first; "" when none could be made. */
export function checkLine(checks: OptionChecks | undefined, t: Labels, locale: Locale): string {
  return joinItems(
    checkBadges(checks, t, locale).map((badge) => badge.text),
    locale,
  );
}

/** The budget and deadline checks of an option as badges: the problems first, what fits after. */
export function checkBadges(checks: OptionChecks | undefined, t: Labels, locale: Locale): { status: CheckStatus; text: string }[] {
  if (!checks) return [];
  const badges: { status: CheckStatus; text: string }[] = [];
  if (checks.build) {
    const { status, by, currency } = checks.build;
    const amount = formatMoney(by, currency, locale);
    badges.push({
      status,
      text: status === "over" ? fill(t.overBudget, { amount }) : status === "at_risk" ? fill(t.budgetAtRisk, { amount }) : t.withinBudget,
    });
  }
  if (checks.run) {
    const { status, by, currency } = checks.run;
    const amount = formatMoney(by, currency, locale);
    badges.push({
      status,
      text:
        status === "over"
          ? fill(t.overRunBudget, { amount })
          : status === "at_risk"
            ? fill(t.runBudgetAtRisk, { amount })
            : t.withinRunBudget,
    });
  }
  if (checks.time) {
    const { status, by } = checks.time;
    badges.push({
      status,
      text: status === "over" ? fill(t.late, { weeks: by }) : status === "at_risk" ? fill(t.lateAtRisk, { weeks: by }) : t.onTime,
    });
  }
  const order: Record<CheckStatus, number> = { over: 0, at_risk: 1, within: 2 };
  return badges.sort((a, b) => order[a.status] - order[b.status]);
}

/** The build budget and the running budget of a sheet, then its note: "Build budget: €15,000 · Running budget: €400 a month". */
export function budgetText(sheet: RequirementsSheet, t: Labels, locale: Locale): string {
  return [budgetAmounts(sheet, t, locale), sheet.budget.note.trim()].filter(Boolean).join(". ");
}

/** The budget as a line of a list: its amounts, each labelled, or the note under the "Budget" label when none is known. */
export function budgetLine(sheet: RequirementsSheet, t: Labels, locale: Locale): string {
  const amounts = budgetAmounts(sheet, t, locale);
  const note = sheet.budget.note.trim();
  if (amounts) return [amounts, note].filter(Boolean).join(". ");
  return note ? labelled(t.budget, note, locale) : "";
}

/** The amounts of the budget alone: "Build budget: €15,000 · Running budget: €400 a month", or "" when unknown. */
export function budgetAmounts(sheet: RequirementsSheet, t: Labels, locale: Locale): string {
  const { build, run } = sheet.budget;
  const parts = [
    build ? labelled(t.buildBudget, formatMoney(build.amount, build.currency, locale), locale) : "",
    run
      ? labelled(
          t.runBudget,
          fill(run.period === "year" ? t.perYear : t.perMonth, { amount: formatMoney(run.amount, run.currency, locale) }),
          locale,
        )
      : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

const count = (value: number, locale: Locale) =>
  new Intl.NumberFormat(locale === "ar" || locale === "hi" ? `${locale}-u-nu-latn` : locale).format(value);

export function teamText(sheet: RequirementsSheet, t: Labels, locale: Locale): string {
  const { people, skills, note } = sheet.team;
  const head = [people !== null ? fill(t.teamSize, { count: count(people, locale) }) : "", skills.join(", ")].filter(Boolean).join(": ");
  return [head, note.trim()].filter(Boolean).join(". ");
}

export function usersText(sheet: RequirementsSheet, t: Labels, locale: Locale): string {
  const { launch, oneYear, note } = sheet.users;
  const head = [
    launch !== null ? fill(t.usersLaunch, { count: count(launch, locale) }) : "",
    oneYear !== null ? fill(t.usersYear, { count: count(oneYear, locale) }) : "",
  ]
    .filter(Boolean)
    .join(", ");
  return [head, note.trim()].filter(Boolean).join(". ");
}

export function deadlineText(sheet: RequirementsSheet, t: Labels, locale: Locale): string {
  const { date, duration, note } = sheet.deadline;
  const head = date
    ? formatDate(date, locale)
    : duration
      ? fill(duration.unit === "week" ? t.weeks : t.months, { count: count(duration.amount, locale) })
      : "";
  return [head, note.trim()].filter(Boolean).join(". ");
}

/** The compliance boxes checked on a sheet, named in the document's language. */
export function complianceItems(sheet: RequirementsSheet, t: Labels): string[] {
  return COMPLIANCE_KEYS.filter((key) => sheet.compliance[key]).map((key) => t[key]);
}

/** A build duration in weeks such as "12 to 14 weeks". */
export function weeksText(weeks: { low: number; high: number } | null, t: Labels, locale: Locale): string | null {
  if (!weeks) return null;
  return weeks.low === weeks.high
    ? fill(t.weeks, { count: count(weeks.low, locale) })
    : fill(t.weeksRange, { low: count(weeks.low, locale), high: count(weeks.high, locale) });
}

function formatDate(date: string, locale: Locale): string {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return date;
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(parsed);
}

/** What the organisation profile in force says, as label and value pairs. */
export function profileFacts(profile: OrgProfile, t: Labels, locale: Locale): [string, string][] {
  const hosting = [
    profile.hosting.euOnly ? t.euOnly : "",
    profile.hosting.providers.join(", "),
    profile.hosting.onPremises ? t.onPremises : "",
    profile.hosting.notes.trim(),
  ].filter(Boolean);
  const facts: [string, string][] = [];
  if (profile.forbiddenTechnologies.length > 0) facts.push([t.forbiddenTechnologies, profile.forbiddenTechnologies.join(", ")]);
  if (hosting.length > 0) facts.push([t.hosting, hosting.join("; ")]);
  if (profile.preferredTechnologies.length > 0) facts.push([t.preferredTechnologies, profile.preferredTechnologies.join(", ")]);
  if (profile.roles.length > 0) {
    facts.push([
      t.dayRate,
      profile.roles.map((role) => `${role.name} ${formatMoney(role.dailyRate, profile.currency, locale)}`).join(", "),
    ]);
  }
  if (profile.deliverables.length > 0) facts.push([t.deliverables, profile.deliverables.join("; ")]);
  if (profile.guarantees.length > 0) facts.push([t.guarantees, profile.guarantees.join("; ")]);
  return facts;
}

/** The costing of a proposal as a Markdown table, with its notes, assumptions and exclusions. */
export function costingMarkdown(costing: Costing, t: Labels, locale: Locale): string[] {
  const money = (amount: number) => formatMoney(amount, costing.currency, locale);
  const moneyRange = (range: { low: number; high: number }) =>
    range.low === range.high ? money(range.low) : `${money(range.low)} – ${money(range.high)}`;
  const lines: string[] = [];
  if (costing.packages.length > 0) {
    lines.push(`| ${t.workPackage} | ${t.role} | ${t.personDays} | ${t.dayRate} | ${t.amount} |`, "| --- | --- | --- | --- | --- |");
    for (const item of costing.packages) {
      item.lines.forEach((line, index) => {
        lines.push(
          `| ${index === 0 ? `**${cell(item.name)}**` : ""} | ${cell(roleLabel(line, t))} | ${formatDayRange(line.days, locale)} | ${line.dailyRate === null ? "–" : money(line.dailyRate)} | ${line.cost ? moneyRange(line.cost) : "–"} |`,
        );
      });
    }
    lines.push(`| **${t.total}** | | **${formatDayRange(costing.days, locale)}** | | **${moneyRange(costing.total)}** |`, "");
  } else {
    lines.push(labelled(`**${t.buildCost}**`, moneyRange(costing.total), locale), "");
  }
  lines.push(`_${costingNotes(costing, t).join(" ")}_`, "");
  if (costing.assumptions.length > 0) lines.push(`**${t.assumptions}**`, "", list(costing.assumptions), "");
  if (costing.exclusions.length > 0) lines.push(`**${t.exclusions}**`, "", list(costing.exclusions), "");
  return lines;
}

const LEVEL = { low: 1, medium: 2, high: 3 } as const;

/**
 * What a reader who has thirty seconds needs: the option to build, the best alternative and why it
 * lost, the risk that matters most, the first step, and how close the weighted scores were.
 */
export function decisionSummary(session: Session) {
  const verdict = session.verdict;
  if (!verdict) return null;
  const weights = Object.fromEntries((session.sheet?.priorities ?? []).map((priority) => [priority.criterion, priority.weight]));
  const ranking = rankOptions(verdict, weights);
  const chosenSeat = verdict.recommendation.seat;
  const chosenRank = ranking.find((option) => option.seat === chosenSeat) ?? null;
  const alternativeRank = ranking.find((option) => option.seat !== chosenSeat) ?? null;
  const alternative = alternativeRank ? (verdict.options.find((option) => option.seat === alternativeRank.seat) ?? null) : null;
  const mainRisk =
    [...verdict.risks].sort((a, b) => LEVEL[b.impact] * LEVEL[b.likelihood] - LEVEL[a.impact] * LEVEL[a.likelihood])[0] ?? null;
  const margin =
    chosenRank?.score != null && alternativeRank?.score != null
      ? { first: chosenRank.score, second: alternativeRank.score, close: Math.abs(chosenRank.score - alternativeRank.score) < 0.3 }
      : null;
  return { ranking, weights, alternative, mainRisk, nextStep: verdict.roadmap[0] ?? null, margin };
}

/** Who played each role, as "provider · model", with the expert role of each proposer. */
export function participants(session: Session, t: Labels): { role: string; model: string }[] {
  const model = (participant: { provider: string; model: string }) => `${participant.provider} · ${participant.model}`;
  return [
    { role: t.interviewer, model: model(session.interviewer) },
    ...Object.entries(session.seats).map(([seat, value]) => ({
      role: `${fill(t.proposer, { seat })}${value.persona ? ` (${value.persona.replaceAll("_", " ")})` : ""}`,
      model: model(value),
    })),
    ...(session.devil ? [{ role: t.devil, model: model(session.devil) }] : []),
    { role: t.arbiter, model: model(session.arbiter) },
  ];
}

/** The paragraphs of the method box: how the report was produced, and whether the debate was cut short for its budget. */
export function methodNotes(session: Session, t: Labels): string[] {
  const notes = [fill(t.methodText, { rounds: session.rounds })];
  if (session.shortened) notes.push(fill(t.shortened, { done: session.shortened.rounds, planned: session.rounds }));
  return notes;
}

/** The angles the arbiter raised when the participants agreed too fast. */
export function sessionProbes(session: Session): { round: number; data: Probe }[] {
  return session.debate.flatMap((entry) => (entry.kind === "probe" ? [{ round: entry.round, data: entry.data }] : []));
}

/** The option the arbiter recommends, with its latest proposal, or null. */
export function chosenOption(session: Session): { seat: string; proposal: Proposal | null } | null {
  const seat = session.verdict?.recommendation.seat;
  if (!seat) return null;
  return { seat, proposal: currentProposals(session)[seat] ?? null };
}

/** A file-name-safe slug of the project name, accents folded; "quorumind" when nothing is left. */
export function reportSlug(session: Session): string {
  const slug = (session.sheet?.projectName ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");
  return slug || "quorumind";
}

const list = (items: string[]) => items.map((item) => `- ${item}`).join("\n");
const cell = (text: string) => text.replaceAll("|", "\\|").replaceAll("\n", " ");

// Mermaid reads quoted labels literally except for its entity codes, so the characters that could
// close a label or start a code are replaced by entities; ids are reduced to a safe alphabet.
const mermaidText = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .trim()
    .replaceAll("#", "#35;")
    .replaceAll('"', "#quot;")
    .replaceAll("<", "#lt;")
    .replaceAll(">", "#gt;")
    .replaceAll("`", "#96;")
    .replaceAll("|", "#124;");

const MERMAID_SHAPES: Record<ComponentKind, [string, string]> = {
  client: ['(["', '"])'],
  service: ['["', '"]'],
  database: ['[("', '")]'],
  storage: ['[/"', '"/]'],
  queue: ['[["', '"]]'],
  external: ['{{"', '"}}'],
  infra: ['>"', '"]'],
};

/** The architecture as a Mermaid flowchart, or null for proposals stored before diagrams existed. */
export function mermaidFlowchart(components: DiagramComponent[] | undefined, flows: DiagramFlow[] | undefined): string | null {
  if (!components?.length) return null;
  const ids = new Map<string, string>();
  const used = new Set<string>();
  const idFor = (raw: string) => {
    const known = ids.get(raw);
    if (known) return known;
    const base = `n_${raw.replace(/[^A-Za-z0-9_]/g, "_")}`;
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}_${n}`;
    ids.set(raw, id);
    used.add(id);
    return id;
  };
  const lines = ["```mermaid", "flowchart LR"];
  const external: string[] = [];
  const declare = (raw: string, label: string, kind: string) => {
    if (ids.has(raw)) return;
    const shape = MERMAID_SHAPES[kind as ComponentKind] ?? MERMAID_SHAPES.service;
    const id = idFor(raw);
    lines.push(`  ${id}${shape[0]}${mermaidText(label || raw)}${shape[1]}`);
    if (kind === "external") external.push(id);
  };
  for (const component of components) declare(component.id, component.label, component.kind);
  for (const flow of flows ?? []) {
    declare(flow.from, flow.from, "service");
    declare(flow.to, flow.to, "service");
    const label = mermaidText(flow.label);
    lines.push(`  ${idFor(flow.from)} -->${label ? `|"${label}"|` : ""} ${idFor(flow.to)}`);
  }
  if (external.length > 0) lines.push("  classDef external stroke-dasharray: 5 5", `  class ${external.join(",")} external`);
  lines.push("```");
  return lines.join("\n");
}

/** The decision report as Markdown, readable by a person and by a coding agent. */
export function renderReport(session: Session): string {
  const t = reportLabels(session.locale);
  const verdict = session.verdict;
  const sheet = session.sheet;
  const proposals = currentProposals(session);
  const lines: string[] = [];
  const say = (label: string, value: string) => labelled(label, value, session.locale);
  const summary = decisionSummary(session);
  const checks = deliveryChecks(session);
  const badges = (seat: string) => checkLine(checks[seat], t, session.locale);
  const profile = sessionProfile(session);

  lines.push(`# ${sheet?.projectName ?? session.idea}`, "", `_${t.title} · ${session.updatedAt.slice(0, 10)}_`, "");

  if (verdict) {
    lines.push(`## ${t.recommendation}`, "");
    const seat = verdict.recommendation.seat;
    const recommended = seat ? proposals[seat] : null;
    const option = seat ? verdict.options.find((item) => item.seat === seat) : null;
    if (recommended && seat) {
      lines.push(`**${recommended.title}** (${seatName(seat, t)}${option ? `, ${t[option.feasibility]}` : ""})`, "");
    } else lines.push(`**${t.noRecommendation}**`, "");
    lines.push(verdict.recommendation.rationale, "");
    if (verdict.speech.trim()) lines.push(`### ${t.summary}`, "", verdict.speech, "");

    const facts: string[] = [];
    if (recommended && seat) {
      facts.push(say(t.monthlyCost, `${formatRange(monthlyRange(session, recommended), session.locale)} (${t.estimate})`));
      const build = buildRange(proposalCosting(session, recommended));
      if (build) facts.push(say(t.buildCost, `${formatRange(build, session.locale)} (${t.estimate})`));
      const total = threeYearCost(session, recommended);
      if (total) facts.push(say(t.total3y, formatRange(total, session.locale)));
      const weeks = weeksText(recommended.buildWeeks, t, session.locale);
      facts.push(say(t.buildTime, weeks ? `${recommended.buildTime} (${weeks})` : recommended.buildTime));
      if (badges(seat)) facts.push(say(t.checks, badges(seat)));
    }
    if (sheet && budgetLine(sheet, t, session.locale)) facts.push(budgetLine(sheet, t, session.locale));
    if (summary?.mainRisk) facts.push(say(t.mainRisk, `${summary.mainRisk.risk} (${summary.mainRisk.mitigation})`));
    if (summary?.alternative)
      facts.push(say(fill(t.whyNot, { option: seatName(summary.alternative.seat, t) }), summary.alternative.reason));
    if (summary?.nextStep) facts.push(say(t.nextStep, `${summary.nextStep.phase}: ${summary.nextStep.content}`));
    if (summary?.margin) {
      const values = {
        first: formatScore(summary.margin.first, session.locale),
        second: formatScore(summary.margin.second, session.locale),
      };
      facts.push(say(t.weightedScore, fill(summary.margin.close ? t.closeCall : t.clearLead, values)));
    }
    if (facts.length > 0) lines.push(list(facts), "");
  }

  if (sheet) {
    lines.push(`## ${t.contextGoals}`, "", sheet.summary, "");
    lines.push(`### ${t.goals}`, "", list(sheet.goals), "");
    if (sheet.successCriteria.length > 0) lines.push(`### ${t.successCriteria}`, "", list(sheet.successCriteria), "");
    const field = (label: string, value: string) => (value ? say(label, value) : "");
    const compliance = complianceItems(sheet, t);
    const context = [
      field(t.users, usersText(sheet, t, session.locale)),
      budgetLine(sheet, t, session.locale),
      field(t.team, teamText(sheet, t, session.locale)),
      field(t.deadline, deadlineText(sheet, t, session.locale)),
      sheet.existingInfrastructure.length > 0 ? say(t.existingInfrastructure, sheet.existingInfrastructure.join("; ")) : "",
      compliance.length > 0 ? say(t.compliance, compliance.join(", ")) : "",
    ].filter(Boolean);
    if (context.length > 0) lines.push(list(context), "");
    if (sheet.hardConstraints.length > 0) lines.push(`### ${t.hardConstraints}`, "", list(sheet.hardConstraints), "");
  }

  if (profile) {
    lines.push(`### ${t.profile}${profile.name.trim() ? `: ${profile.name.trim()}` : ""}`, "");
    const facts = profileFacts(profile, t, session.locale);
    if (facts.length > 0) lines.push(list(facts.map(([label, value]) => say(label, value))), "");
  }

  if (verdict) {
    const priorities = sheet?.priorities ?? [];
    const ranked = new Map((summary?.ranking ?? []).map((option) => [option.seat, option.score]));
    lines.push(`## ${t.options}`, "");
    lines.push(
      `| ${t.option} | ${t.feasibility} | ${priorities.map((p) => `${cell(p.criterion)} (${fill(t.weight, { weight: p.weight })})`).join(" | ")} | ${t.weightedScore} |`,
    );
    lines.push(`| --- | --- |${priorities.map(() => " --- |").join("")} --- |`);
    for (const option of verdict.options) {
      const scores = priorities.map((p) => option.scores.find((score) => score.criterion === p.criterion)?.score ?? "–");
      const weighted = ranked.get(option.seat);
      lines.push(
        `| ${cell(seatName(option.seat, t))}: ${cell(option.title)} | ${t[option.feasibility]} | ${scores.join(" | ")} | ${weighted == null ? "–" : formatScore(weighted, session.locale)} |`,
      );
    }
    lines.push("", `_${t.scoreLegend}_`, "");
    for (const option of verdict.options) {
      lines.push(`- **${seatName(option.seat, t)}, ${t[option.feasibility]}:** ${option.reason}`);
      if (option.conditions.length > 0) lines.push(`  - ${say(t.conditions, option.conditions.join("; "))}`);
      if (badges(option.seat)) lines.push(`  - ${say(t.checks, badges(option.seat))}`);
    }
    lines.push("");

    const costed = Object.entries(proposals).filter(([seat]) => verdict.options.some((option) => option.seat === seat));
    if (costed.length > 0) {
      const budget = sheet ? budgetAmounts(sheet, t, session.locale) : "";
      lines.push(
        `## ${t.costComparison}`,
        "",
        `| ${t.option} | ${t.buildCost} | ${t.monthlyCost} | ${t.total3y} | ${t.checks} |`,
        "| --- | --- | --- | --- | --- |",
      );
      for (const [seat, proposal] of costed) {
        const build = buildRange(proposalCosting(session, proposal));
        const total = threeYearCost(session, proposal);
        lines.push(
          `| ${cell(seatName(seat, t))}: ${cell(proposal.title)} | ${build ? formatRange(build, session.locale) : "–"} | ${formatRange(monthlyRange(session, proposal), session.locale)} | ${total ? formatRange(total, session.locale) : "–"} | ${cell(badges(seat)) || "–"} |`,
        );
      }
      lines.push("", `_${t.costNote}${budget ? ` ${budget}.` : ""}_`, "");

      const costings = costed.flatMap(([seat, proposal]) => {
        const costing = proposalCosting(session, proposal);
        return costing ? [{ seat, proposal, costing }] : [];
      });
      if (costings.length > 0) {
        lines.push(`## ${t.costing}`, "");
        for (const { seat, proposal, costing } of costings) {
          lines.push(`### ${seatName(seat, t)}: ${proposal.title}`, "", ...costingMarkdown(costing, t, session.locale));
        }
      }
    }

    const topics = verdict.topics ?? [];
    if (topics.length > 0) {
      lines.push(`## ${t.debateMap}`, "");
      for (const [status, heading] of [
        ["agreement", t.consensus],
        ["divided", t.divided],
        ["opposed", t.opposed],
      ] as const) {
        const group = topics.filter((topic) => topic.status === status);
        if (group.length === 0) continue;
        lines.push(`### ${heading}`, "");
        for (const topic of group) {
          lines.push(
            `- **${topic.topic}**`,
            ...topic.positions.map((item) => `  - ${item.seat ? `${seatName(item.seat, t)}: ` : ""}${item.position}`),
          );
        }
        lines.push("");
      }
    }
  }

  const probes = sessionProbes(session);
  if (probes.length > 0) {
    lines.push(`## ${t.probe}`, "");
    for (const probe of probes) lines.push(`> ${probe.data.angle}`, "", say(t.probeRationale, probe.data.rationale), "");
  }

  if (verdict) {
    if (verdict.risks.length > 0) {
      lines.push(`## ${t.risks}`, "", `| ${t.risks} | ${t.likelihood} | ${t.impact} | ${t.mitigation} |`, "| --- | --- | --- | --- |");
      for (const risk of verdict.risks) {
        lines.push(`| ${cell(risk.risk)} | ${t[risk.likelihood]} | ${t[risk.impact]} | ${cell(risk.mitigation)} |`);
      }
      lines.push("");
    }
    if (verdict.roadmap.length > 0) {
      lines.push(`## ${t.roadmap}`, "");
      verdict.roadmap.forEach((phase, index) => {
        lines.push(`${index + 1}. **${phase.phase}:** ${phase.content} (${say(t.exitCriterion, phase.exitCriterion)})`);
      });
      lines.push("");
    }
    if (verdict.claims.length > 0) {
      lines.push(`## ${t.claims}`, "", list(verdict.claims.map((claim) => `${claim.claim} _(${t[claim.confidence]})_`)), "");
    }
    if (verdict.openQuestions.length > 0) lines.push(`## ${t.openQuestions}`, "", list(verdict.openQuestions), "");
  }

  if (Object.keys(proposals).length > 0) {
    lines.push(`## ${session.mode === "challenge" ? t.yourSolution : t.proposals}`, "");
    for (const [seat, proposal] of Object.entries(proposals)) lines.push(...renderProposal(session, seat, proposal, t), "");
  }

  if (sheet) {
    lines.push(`## ${t.appendix}: ${t.detailedRequirements}`, "");
    lines.push(`### ${t.mustHave}`, "", list(sheet.mustHave), "");
    if (sheet.niceToHave.length > 0) lines.push(`### ${t.niceToHave}`, "", list(sheet.niceToHave), "");
    if (sheet.outOfScope.length > 0) lines.push(`### ${t.outOfScope}`, "", list(sheet.outOfScope), "");
    if (sheet.softConstraints.length > 0) lines.push(`### ${t.softConstraints}`, "", list(sheet.softConstraints), "");
    if (sheet.priorities.length > 0) {
      lines.push(
        `### ${t.priorities}`,
        "",
        list(sheet.priorities.map((p) => `${p.criterion} (${fill(t.weight, { weight: p.weight })})`)),
        "",
      );
    }
    if (sheet.assumptions.length > 0) lines.push(`### ${t.assumptions}`, "", list(sheet.assumptions), "");
  }

  const answers = session.debate.flatMap((entry) => (entry.kind === "answers" ? entry.answers : []));
  if (answers.length > 0) {
    lines.push(`## ${t.answers}`, "", list(answers.map((entry) => `**${entry.question}** ${entry.answer}`)), "");
  }

  lines.push(`## ${t.method}`, "", ...methodNotes(session, t).flatMap((note) => [note, ""]));
  lines.push(list(participants(session, t).map((item) => say(item.role, item.model))), "");
  return lines.join("\n");
}

function renderProposal(session: Session, seat: string, proposal: Proposal, t: Labels) {
  const range = (value: { low: number; high: number; currency: string }) => formatRange(value, session.locale);
  const diagram = mermaidFlowchart(proposal.components, proposal.flows);
  const build = buildRange(proposalCosting(session, proposal));
  const weeks = weeksText(proposal.buildWeeks, t, session.locale);
  return [
    `### ${seatName(seat, t)}: ${proposal.title}`,
    "",
    proposal.summary,
    "",
    `**${t.architecture}**`,
    "",
    list(proposal.architecture),
    "",
    ...(diagram ? [`**${t.diagram}**`, "", diagram, ""] : []),
    `**${t.stack}:** ${proposal.stack.join(", ")}`,
    "",
    `**${t.infrastructure}**`,
    "",
    list(proposal.infrastructure),
    "",
    `**${t.monthlyCost}:** ${range(monthlyRange(session, proposal))} (${t.estimate}: ${proposal.monthlyCost.basis})`,
    "",
    // Sessions stored before V1 have no build cost.
    ...(build ? [`**${t.buildCost}:** ${range(build)} (${t.estimate})`, ""] : []),
    `**${t.buildTime}:** ${proposal.buildTime}${weeks ? ` (${weeks})` : ""}`,
    "",
    `**${t.risks}**`,
    "",
    list(proposal.risks),
  ];
}

/**
 * The decision as an Architecture Decision Record in the MADR layout, to commit next to the code
 * (for example docs/decisions/0001-<slug>.md). Written in the session's language. With a number, the title
 * is numbered the way ADR tools number theirs ("# 7. Title").
 */
export function renderAdr(session: Session, numbering: { number?: number | null } = {}): string {
  const t = reportLabels(session.locale);
  const verdict = session.verdict;
  const sheet = session.sheet;
  const proposals = currentProposals(session);
  const chosen = chosenOption(session);
  const project = sheet?.projectName ?? session.idea;
  const lines: string[] = [];

  const title = chosen?.proposal?.title ?? project;
  lines.push(numbering.number ? `# ${numbering.number}. ${title}` : `# ${t.adr}: ${title}`, "");
  lines.push(
    `- **${t.status}:** ${t.proposed}`,
    `- **${t.date}:** ${session.updatedAt.slice(0, 10)}`,
    `- **${t.mode}:** ${modeName(session, t)}`,
    "",
  );

  lines.push(`## ${t.context}`, "", sheet?.summary ?? session.idea, "");
  if (sheet && sheet.hardConstraints.length > 0) lines.push(`### ${t.hardConstraints}`, "", list(sheet.hardConstraints), "");
  if (sheet && sheet.priorities.length > 0) {
    const priorities = [...sheet.priorities].sort((a, b) => b.weight - a.weight);
    lines.push(`### ${t.priorities}`, "", list(priorities.map((priority) => `${priority.criterion} (${priority.weight}/5)`)), "");
  }

  lines.push(`## ${t.consideredOptions}`, "");
  const options = verdict?.options ?? [];
  const seats = options.length > 0 ? options.map((option) => option.seat) : Object.keys(proposals);
  seats.forEach((seat, index) => {
    const option = options.find((item) => item.seat === seat);
    const proposal = proposals[seat];
    const title = proposal?.title ?? option?.title ?? "";
    lines.push(`${index + 1}. **${seatName(seat, t)}: ${title}**${option ? `: ${t[option.feasibility]}` : ""}`);
    if (proposal) lines.push(`   - ${proposal.summary}`);
    if (option) lines.push(`   - ${option.reason}`);
  });
  lines.push("");

  lines.push(`## ${t.decisionOutcome}`, "");
  if (chosen) {
    lines.push(`**${t.chosenOption}:** ${seatName(chosen.seat, t)}${chosen.proposal ? `: ${chosen.proposal.title}` : ""}`, "");
  } else lines.push(`**${t.noRecommendation}**`, "");
  if (verdict) lines.push(`**${t.rationale}:** ${verdict.recommendation.rationale}`, "");
  if (chosen?.proposal) {
    const proposal = chosen.proposal;
    lines.push(`**${t.stack}:** ${proposal.stack.join(", ")}`, "");
    const diagram = mermaidFlowchart(proposal.components, proposal.flows);
    if (diagram) lines.push(diagram, "");
  }

  const conditions = options.find((option) => option.seat === chosen?.seat)?.conditions ?? [];
  if (conditions.length > 0 || (verdict?.risks.length ?? 0) > 0) {
    lines.push(`## ${t.consequences}`, "");
    if (conditions.length > 0) lines.push(`### ${t.conditions}`, "", list(conditions), "");
    if (verdict && verdict.risks.length > 0) {
      lines.push(
        `### ${t.risks}`,
        "",
        list(
          verdict.risks.map(
            (risk) =>
              `${risk.risk} (${t.likelihood}: ${t[risk.likelihood]}, ${t.impact}: ${t[risk.impact]}). ${t.mitigation}: ${risk.mitigation}`,
          ),
        ),
        "",
      );
    }
  }

  lines.push(`## ${t.links}`, "");
  lines.push(`- ${t.fullReport}: ${reportSlug(session)}-report.md`, `- ${t.session}: ${session.id}`);
  if (session.parentId) lines.push(`- ${t.revisits}: ${session.parentId}`);
  lines.push("", `_${t.generated}_`, "");
  return lines.join("\n");
}
