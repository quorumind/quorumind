import type { DiagramComponent, DiagramFlow } from "./diagram.ts";
import type { Locale } from "./locales.ts";
import { rankOptions } from "./ranking.ts";
import { LABELS, type Labels } from "./report-labels.ts";
import type { ComponentKind, Probe, Proposal } from "./schemas.ts";
import { currentProposals, DEVIL_SEAT, type Session, USER_SEAT } from "./session.ts";

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

/** Build cost plus three years of running cost, or null when the proposal has no build cost or mixes currencies. */
export function threeYearCost(proposal: Proposal): { low: number; high: number; currency: string } | null {
  const build = proposal.buildCost;
  if (!build || build.currency !== proposal.monthlyCost.currency) return null;
  return { low: build.low + 36 * proposal.monthlyCost.low, high: build.high + 36 * proposal.monthlyCost.high, currency: build.currency };
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
  const money = (amount: number, currency: string) => formatMoney(amount, currency, session.locale);
  const say = (label: string, value: string) => labelled(label, value, session.locale);
  const summary = decisionSummary(session);

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
    if (recommended) {
      facts.push(say(t.monthlyCost, `${formatRange(recommended.monthlyCost, session.locale)} (${t.estimate})`));
      if (recommended.buildCost) facts.push(say(t.buildCost, `${formatRange(recommended.buildCost, session.locale)} (${t.estimate})`));
      const total = threeYearCost(recommended);
      if (total) facts.push(say(t.total3y, formatRange(total, session.locale)));
      facts.push(say(t.buildTime, recommended.buildTime));
    }
    if (sheet?.budget) facts.push(say(t.budget, sheet.budget));
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
    const context = [
      sheet.users ? say(t.users, sheet.users) : "",
      sheet.budget ? say(t.budget, sheet.budget) : "",
      sheet.team ? say(t.team, sheet.team) : "",
      sheet.deadline ? say(t.deadline, sheet.deadline) : "",
      sheet.existingInfrastructure.length > 0 ? say(t.existingInfrastructure, sheet.existingInfrastructure.join("; ")) : "",
    ].filter(Boolean);
    if (context.length > 0) lines.push(list(context), "");
    if (sheet.hardConstraints.length > 0) lines.push(`### ${t.hardConstraints}`, "", list(sheet.hardConstraints), "");
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
    }
    lines.push("");

    const costed = Object.entries(proposals).filter(([seat]) => verdict.options.some((option) => option.seat === seat));
    if (costed.length > 0) {
      lines.push(
        `## ${t.costComparison}`,
        "",
        `| ${t.option} | ${t.buildCost} | ${t.monthlyCost} | ${t.total3y} |`,
        "| --- | --- | --- | --- |",
      );
      for (const [seat, proposal] of costed) {
        const total = threeYearCost(proposal);
        lines.push(
          `| ${cell(seatName(seat, t))}: ${cell(proposal.title)} | ${proposal.buildCost ? formatRange(proposal.buildCost, session.locale) : "–"} | ${formatRange(proposal.monthlyCost, session.locale)} | ${total ? formatRange(total, session.locale) : "–"} |`,
        );
      }
      lines.push("", `_${t.costNote}${sheet?.budget ? ` ${say(t.budget, sheet.budget)}.` : ""}_`, "");
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
    for (const [seat, proposal] of Object.entries(proposals)) lines.push(...renderProposal(seat, proposal, t, money), "");
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

  lines.push(`## ${t.method}`, "", fill(t.methodText, { rounds: session.rounds }), "");
  lines.push(list(participants(session, t).map((item) => say(item.role, item.model))), "");
  return lines.join("\n");
}

function renderProposal(seat: string, proposal: Proposal, t: Labels, money: (amount: number, currency: string) => string) {
  const range = (value: { low: number; high: number; currency: string }) =>
    `${money(value.low, value.currency)} – ${money(value.high, value.currency)}`;
  const diagram = mermaidFlowchart(proposal.components, proposal.flows);
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
    `**${t.monthlyCost}:** ${range(proposal.monthlyCost)} (${t.estimate}: ${proposal.monthlyCost.basis})`,
    "",
    // Sessions stored before V1 have no build cost.
    ...(proposal.buildCost ? [`**${t.buildCost}:** ${range(proposal.buildCost)} (${t.estimate}: ${proposal.buildCost.basis})`, ""] : []),
    `**${t.buildTime}:** ${proposal.buildTime}`,
    "",
    `**${t.risks}**`,
    "",
    list(proposal.risks),
  ];
}

/**
 * The decision as an Architecture Decision Record in the MADR layout, to commit next to the code
 * (for example docs/decisions/0001-<slug>.md). Written in the session's language.
 */
export function renderAdr(session: Session): string {
  const t = reportLabels(session.locale);
  const verdict = session.verdict;
  const sheet = session.sheet;
  const proposals = currentProposals(session);
  const chosen = chosenOption(session);
  const project = sheet?.projectName ?? session.idea;
  const lines: string[] = [];

  lines.push(`# ${t.adr}: ${chosen?.proposal?.title ?? project}`, "");
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
