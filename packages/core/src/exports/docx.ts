import { HeadingLevel, Paragraph, type Table } from "docx";
import type { Branding } from "../branding.ts";
import { type Costing, deliveryChecks, proposalCosting, sessionProfile } from "../costing.ts";
import { decisionLabels } from "../decision-labels.ts";
import { decisionFacts } from "../decision-report.ts";
import {
  budgetText,
  buildRange,
  checkLine,
  chosenOption,
  complianceItems,
  costingNotes,
  deadlineText,
  formatDayRange,
  formatMoney,
  formatRange,
  methodNotes,
  modeName,
  monthlyRange,
  participants,
  profileFacts,
  reportLabels,
  roleLabel,
  seatName,
  sessionProbes,
  teamText,
  usersText,
  weeksText,
} from "../report.ts";
import { researchLabels } from "../research-labels.ts";
import { numberedSources, refsOf, refsText, researchSection } from "../research-report.ts";
import { revisionNote } from "../revision-report.ts";
import type { Proposal } from "../schemas.ts";
import { currentProposals, type Session } from "../session.ts";
import { renderAuditDocx } from "./audit-docx.ts";
import { docxKit, MUTED } from "./docx-kit.ts";
import { researchDocx } from "./research-docx.ts";

// The decision report as a Word document, for people who edit and forward reports by e-mail.
// Server-only: the `docx` package is large, so this module has its own subpath export
// (@quorumind/core/docx) and the web bundle never imports it. Architecture diagrams are listed as
// components and flows: Word needs a raster fallback for SVG, which would require an image library.

export async function renderDocx(session: Session, branding: Branding): Promise<Uint8Array> {
  if (session.mode === "audit") return renderAuditDocx(session, branding);
  const t = reportLabels(session.locale);
  const kit = docxKit(session.locale, branding);
  const { rtl, accent, run, para, heading, bullets, labelled, table, masthead, document } = kit;
  const verdict = session.verdict;
  const sheet = session.sheet;
  const proposals = currentProposals(session);
  const chosen = chosenOption(session);
  const project = sheet?.projectName ?? session.idea;
  const date = new Intl.DateTimeFormat(session.locale, { dateStyle: "long" }).format(new Date(session.updatedAt));
  const range = (value: { low: number; high: number; currency: string }) => formatRange(value, session.locale);
  const checks = deliveryChecks(session);
  const badges = (seat: string) => checkLine(checks[seat], t, session.locale);
  const buildTime = (proposal: Proposal) => {
    const weeks = weeksText(proposal.buildWeeks, t, session.locale);
    return weeks ? `${proposal.buildTime} (${weeks})` : proposal.buildTime;
  };

  const children: (Paragraph | Table)[] = [];

  // Masthead: the agency's logo and name when branded, Quorumind's name otherwise.
  children.push(masthead());

  children.push(para(t.title.toUpperCase(), { style: { bold: true, color: MUTED, size: 18 }, spacing: 40 }));
  children.push(new Paragraph({ children: [run(project)], heading: HeadingLevel.TITLE, bidirectional: rtl }));
  children.push(para(`${date} · ${t.mode}: ${modeName(session, t)}`, { style: { color: MUTED } }));
  const revision = revisionNote(session);
  if (revision) children.push(para(revision.label, { style: { color: MUTED } }));
  if (sheet) children.push(para(sheet.summary, { style: { color: MUTED } }));

  if (verdict) {
    children.push(heading(t.recommendation));
    if (chosen) {
      children.push(
        para([
          run(`${seatName(chosen.seat, t)}${chosen.proposal ? `: ${chosen.proposal.title}` : ""}`, { bold: true, size: 26, color: accent }),
        ]),
      );
    } else children.push(para(t.noRecommendation, { style: { bold: true } }));
    children.push(para(verdict.recommendation.rationale));
    if (chosen?.proposal) {
      const proposal = chosen.proposal;
      children.push(labelled(`${t.monthlyCost} (${t.estimate})`, range(monthlyRange(session, proposal))));
      const build = buildRange(proposalCosting(session, proposal));
      if (build) children.push(labelled(`${t.buildCost} (${t.estimate})`, range(build)));
      children.push(labelled(t.buildTime, buildTime(proposal)));
      if (badges(chosen.seat)) children.push(labelled(t.checks, badges(chosen.seat)));
    }
    // Who approved this version, once the register records it.
    const register = session.decision ? decisionFacts(session) : [];
    if (register.length > 0) children.push(heading(decisionLabels(session.locale).decision), ...bullets(register));
    if (revision?.changes) {
      children.push(heading(revision.changes.title));
      children.push(para(`${revision.label} · ${revision.reason}`, { style: { color: MUTED, size: 18 } }));
      if (revision.changes.empty) children.push(para(revision.changes.empty));
      for (const group of revision.changes.groups) children.push(heading(group.title, 3), ...bullets(group.items));
      if (revision.facts.length > 0) children.push(heading(revision.factsTitle, 3), ...bullets(revision.facts));
    }

    const criteria = sheet?.priorities.map((priority) => priority.criterion) ?? [];
    children.push(heading(t.options));
    children.push(
      table(
        [t.option, t.feasibility, ...criteria],
        verdict.options.map((option) => [
          [para([run(`${seatName(option.seat, t)}: `, { bold: true }), run(option.title)], { spacing: 0 })],
          [
            para(t[option.feasibility], { style: { bold: true }, spacing: 40 }),
            para(option.reason, { style: { size: 18, color: MUTED }, spacing: 40 }),
            ...(option.conditions.length > 0
              ? [para(`${t.conditions}: ${option.conditions.join("; ")}`, { style: { size: 18, color: MUTED }, spacing: 0 })]
              : []),
            ...(badges(option.seat)
              ? [para(`${t.checks}: ${badges(option.seat)}`, { style: { size: 18, color: MUTED }, spacing: 0 })]
              : []),
          ],
          ...criteria.map((criterion) => {
            const value = option.scores.find((score) => score.criterion === criterion)?.score;
            return value ? `${"●".repeat(value)}${"○".repeat(5 - value)} ${value}/5` : "–";
          }),
        ]),
      ),
    );

    const costings = verdict.options.flatMap((option) => {
      const proposal = proposals[option.seat];
      const costing = proposal ? proposalCosting(session, proposal) : null;
      return proposal && costing ? [{ seat: option.seat, proposal, costing }] : [];
    });
    if (costings.length > 0) {
      children.push(heading(t.costing));
      for (const { seat, proposal, costing } of costings) {
        children.push(heading(`${seatName(seat, t)}: ${proposal.title}`, 2), ...costingBlocks(costing));
      }
    }

    const topics = verdict.topics ?? [];
    if (topics.length > 0) {
      children.push(heading(t.debateMap));
      for (const [status, title] of [
        ["agreement", t.consensus],
        ["divided", t.divided],
        ["opposed", t.opposed],
      ] as const) {
        const group = topics.filter((topic) => topic.status === status);
        if (group.length === 0) continue;
        children.push(heading(title, 2));
        for (const topic of group) {
          children.push(para(topic.topic, { style: { bold: true }, spacing: 60 }));
          children.push(...bullets(topic.positions.map((item) => `${item.seat ? `${seatName(item.seat, t)}: ` : ""}${item.position}`)));
        }
      }
    }
  }

  for (const probe of sessionProbes(session)) {
    children.push(heading(t.probe));
    children.push(para(probe.data.angle, { style: { bold: true, italics: true } }));
    children.push(labelled(t.probeRationale, probe.data.rationale));
  }

  if (verdict) {
    if (verdict.risks.length > 0) {
      children.push(heading(t.risks));
      children.push(
        table(
          [t.risks, t.likelihood, t.impact, t.mitigation],
          verdict.risks.map((risk) => [risk.risk, t[risk.likelihood], t[risk.impact], risk.mitigation]),
        ),
      );
    }
    if (verdict.roadmap.length > 0) {
      children.push(heading(t.roadmap));
      verdict.roadmap.forEach((phase, index) => {
        children.push(para([run(`${index + 1}. ${phase.phase}: `, { bold: true }), run(phase.content)], { spacing: 40 }));
        children.push(para(`${t.exitCriterion}: ${phase.exitCriterion}`, { style: { color: MUTED, size: 18 } }));
      });
    }
    if (verdict.claims.length > 0) {
      children.push(heading(t.claims));
      const sources = numberedSources(session);
      children.push(
        ...bullets(
          verdict.claims.map((claim) =>
            [claim.claim, refsText(refsOf(claim.sources, sources)), `(${t[claim.confidence]})`].filter(Boolean).join(" "),
          ),
        ),
      );
      children.push(para(researchLabels(session.locale).claimsNote, { style: { color: MUTED, size: 18 } }));
    }
    if (verdict.openQuestions.length > 0) {
      children.push(heading(t.openQuestions));
      children.push(...bullets(verdict.openQuestions));
    }
  }

  const seats = Object.keys(proposals);
  if (seats.length > 0) {
    children.push(heading(session.mode === "challenge" ? t.yourSolution : t.proposals));
    for (const seat of seats) children.push(...proposalBlocks(seat, proposals[seat] as Proposal));
  }

  if (sheet) {
    children.push(heading(t.requirements));
    for (const [label, value] of [
      [t.users, usersText(sheet, t, session.locale)],
      [t.budget, budgetText(sheet, t, session.locale)],
      [t.team, teamText(sheet, t, session.locale)],
      [t.deadline, deadlineText(sheet, t, session.locale)],
      [t.compliance, complianceItems(sheet, t).join(", ")],
    ] as [string, string][]) {
      if (value) children.push(labelled(label, value));
    }
    const profile = sessionProfile(session);
    if (profile) {
      children.push(heading(`${t.profile}${profile.name.trim() ? `: ${profile.name.trim()}` : ""}`, 3));
      for (const [label, value] of profileFacts(profile, t, session.locale)) children.push(labelled(label, value));
    }
    for (const [title, items] of [
      [t.goals, sheet.goals],
      [t.mustHave, sheet.mustHave],
      [t.hardConstraints, sheet.hardConstraints],
      [t.outOfScope, sheet.outOfScope],
      [t.priorities, sheet.priorities.map((priority) => `${priority.criterion} (${priority.weight}/5)`)],
      [t.assumptions, sheet.assumptions],
    ] as [string, string[]][]) {
      if (items.length === 0) continue;
      children.push(heading(title, 3), ...bullets(items));
    }
  }

  const answers = session.debate.flatMap((entry) => (entry.kind === "answers" ? entry.answers : []));
  if (answers.length > 0) {
    children.push(heading(t.answers));
    children.push(...bullets(answers.map((entry) => `${entry.question} → ${entry.answer}`)));
  }

  children.push(...researchDocx(kit, researchSection(session), session.locale));

  children.push(heading(t.method));
  for (const note of methodNotes(session, t)) children.push(para(note, { style: { color: MUTED, size: 18 } }));
  children.push(...bullets(participants(session, t).map((item) => `${item.role}: ${item.model}`)));

  /** A costing as a table of its work packages, role by role, then where its rates come from and its limits. */
  function costingBlocks(costing: Costing): (Paragraph | Table)[] {
    const money = (amount: number) => formatMoney(amount, costing.currency, session.locale);
    const moneyRange = (value: { low: number; high: number }) =>
      value.low === value.high ? money(value.low) : `${money(value.low)} – ${money(value.high)}`;
    const bold = (text: string) => [para([run(text, { bold: true })], { spacing: 0 })];
    const blocks: (Paragraph | Table)[] = [];
    if (costing.packages.length > 0) {
      blocks.push(
        table(
          [t.workPackage, t.role, t.personDays, t.dayRate, t.amount],
          [
            ...costing.packages.flatMap((item) =>
              item.lines.map((line, index) => [
                index === 0 ? bold(item.name) : "",
                roleLabel(line, t),
                formatDayRange(line.days, session.locale),
                line.dailyRate === null ? "–" : money(line.dailyRate),
                line.cost ? moneyRange(line.cost) : "–",
              ]),
            ),
            [bold(t.total), "", bold(formatDayRange(costing.days, session.locale)), "", bold(moneyRange(costing.total))],
          ],
        ),
      );
    } else blocks.push(labelled(t.buildCost, moneyRange(costing.total)));
    blocks.push(para(costingNotes(costing, t).join(" "), { style: { color: MUTED, size: 18 } }));
    if (costing.assumptions.length > 0) blocks.push(heading(t.assumptions, 3), ...bullets(costing.assumptions));
    if (costing.exclusions.length > 0) blocks.push(heading(t.exclusions, 3), ...bullets(costing.exclusions));
    return blocks;
  }

  function proposalBlocks(seat: string, proposal: Proposal): (Paragraph | Table)[] {
    const components = proposal.components ?? [];
    const names = new Map(components.map((component) => [component.id, component.label]));
    const blocks: (Paragraph | Table)[] = [heading(`${seatName(seat, t)}: ${proposal.title}`, 2), para(proposal.summary)];
    blocks.push(labelled(`${t.monthlyCost} (${t.estimate})`, `${range(monthlyRange(session, proposal))}. ${proposal.monthlyCost.basis}`));
    // Proposals stored before V1 have no build cost, components or flows.
    const build = buildRange(proposalCosting(session, proposal));
    if (build) blocks.push(labelled(`${t.buildCost} (${t.estimate})`, range(build)));
    blocks.push(labelled(t.buildTime, buildTime(proposal)), labelled(t.stack, proposal.stack.join(", ")));
    blocks.push(heading(t.architecture, 3), ...bullets(proposal.architecture));
    if (components.length > 0) blocks.push(heading(t.components, 3), ...bullets(components.map((component) => component.label)));
    if ((proposal.flows ?? []).length > 0) {
      blocks.push(
        heading(t.flows, 3),
        ...bullets(
          proposal.flows.map(
            (flow) => `${names.get(flow.from) ?? flow.from} → ${names.get(flow.to) ?? flow.to}${flow.label ? `: ${flow.label}` : ""}`,
          ),
        ),
      );
    }
    blocks.push(heading(t.infrastructure, 3), ...bullets(proposal.infrastructure));
    if (proposal.risks.length > 0) blocks.push(heading(t.risks, 3), ...bullets(proposal.risks));
    return blocks;
  }

  // The attribution stays on branded documents: Quorumind is AGPL software.
  return document({
    title: `${t.title}: ${project}`,
    description: t.preparedWith,
    footer: `${branding.name ? `${branding.name} · ` : ""}${t.preparedWith}`,
    children,
  });
}

export { renderProposalDocx } from "./proposal-docx.ts";
export { renderQuestionnaireDocx } from "./questionnaire-docx.ts";
