import { HeadingLevel, Paragraph } from "docx";
import { agencyLabels } from "../agency-labels.ts";
import type { Branding } from "../branding.ts";
import type { ClientProposal } from "../deliverable.ts";
import { checkLine, fill, formatDayRange, formatMoney, formatRange, reportLabels, weeksText } from "../report.ts";
import { formatDate } from "../revision-report.ts";
import { type Block, docxKit, MUTED } from "./docx-kit.ts";

// The client proposal as a Word document, to edit and send under the agency's brand: a cover page, then one
// section per heading, with Word's own heading, list and table styles so it stays editable in Word and Google Docs.

export async function renderProposalDocx(proposal: ClientProposal, branding: Branding): Promise<Uint8Array> {
  const t = reportLabels(proposal.locale);
  const a = agencyLabels(proposal.locale);
  const { rtl, accent, run, para, heading, bullets, numbered, labelled, table, pageBreak, masthead, document } = docxKit(
    proposal.locale,
    branding,
  );
  const range = (value: { low: number; high: number; currency: string }) => formatRange(value, proposal.locale);
  const revision = proposal.revision
    ? fill(a.revisionDated, { number: proposal.revision.number, date: formatDate(proposal.revision.date, proposal.locale) })
    : null;
  const children: Block[] = [];

  // Cover page.
  children.push(masthead(56));
  children.push(para(a.proposal.toUpperCase(), { style: { bold: true, color: accent, size: 20 }, spacing: 60 }));
  children.push(new Paragraph({ children: [run(proposal.title || a.proposal)], heading: HeadingLevel.TITLE, bidirectional: rtl }));
  if (proposal.client) children.push(labelled(a.preparedFor, proposal.client));
  if (branding.name) children.push(labelled(a.preparedBy, branding.name));
  if (revision) children.push(para(revision, { style: { color: MUTED } }));
  children.push(pageBreak());

  const context = proposal.context;
  if (context) {
    children.push(heading(a.understanding));
    children.push(para(context.summary));
    if (context.goals.length > 0) children.push(heading(t.goals, 2), ...bullets(context.goals));
    if (context.scope.length > 0) children.push(heading(a.scope, 2), ...bullets(context.scope));
    if (context.successCriteria.length > 0) children.push(heading(t.successCriteria, 2), ...bullets(context.successCriteria));
    if (context.constraints.length > 0) children.push(heading(t.hardConstraints, 2), ...bullets(context.constraints));
    if (context.deadline) children.push(labelled(t.deadline, context.deadline));
    if (context.budget) children.push(labelled(t.budget, context.budget));
  }

  const solution = proposal.solution;
  children.push(heading(a.recommendedSolution));
  if (solution) {
    children.push(heading(solution.title, 2));
    if (solution.summary) children.push(para(solution.summary));
    children.push(heading(a.whyThisSolution, 3), para(solution.rationale));
    if (solution.conditions.length > 0) children.push(heading(t.conditions, 3), ...bullets(solution.conditions));
    if (solution.architecture.length > 0) children.push(heading(t.architecture, 3), ...bullets(solution.architecture));
    if (solution.stack.length > 0) children.push(labelled(t.stack, solution.stack.join(", ")));
    const figures: [string, string][] = [];
    if (solution.buildCost) figures.push([`${t.buildCost} (${t.estimate})`, range(solution.buildCost)]);
    if (solution.monthlyCost) figures.push([`${t.monthlyCost} (${t.estimate})`, range(solution.monthlyCost)]);
    if (solution.buildTime) figures.push([t.buildTime, solution.buildTime]);
    if (figures.length > 0) {
      children.push(heading(a.investment, 3), ...figures.map(([label, value]) => labelled(label, value)));
      children.push(para(a.estimatesNote, { style: { color: MUTED, size: 18 } }));
    }
  } else {
    children.push(para(t.noRecommendation, { style: { bold: true } }));
    if (proposal.rationale) children.push(para(proposal.rationale));
  }

  // The recommended solution's costing by work package: days and amounts, never the day rates behind them.
  const costing = proposal.costing;
  if (costing) {
    const money = (value: { low: number; high: number }) =>
      value.low === value.high
        ? formatMoney(value.low, costing.currency, proposal.locale)
        : formatRange({ ...value, currency: costing.currency }, proposal.locale);
    const bold = (text: string) => [para(text, { style: { bold: true }, spacing: 0 })];
    children.push(heading(t.costing));
    if (costing.packages.length > 0) {
      children.push(
        table(
          [t.workPackage, t.personDays, t.amount],
          [
            ...costing.packages.map((item) => [
              [
                para(item.name, { style: { bold: true }, spacing: item.description ? 40 : 0 }),
                ...(item.description ? [para(item.description, { style: { size: 18, color: MUTED }, spacing: 0 })] : []),
              ],
              formatDayRange(item.days, proposal.locale),
              money(item.cost),
            ]),
            [bold(t.total), bold(formatDayRange(costing.days, proposal.locale)), bold(money(costing.total))],
          ],
        ),
      );
    } else children.push(labelled(t.buildCost, money(costing.total)));
    const weeks = weeksText(costing.buildWeeks, t, proposal.locale);
    if (weeks) children.push(labelled(t.buildTime, weeks));
    const checks = checkLine(costing.checks ?? undefined, t, proposal.locale);
    if (checks) children.push(labelled(t.checks, checks));
    children.push(para(a.estimatesNote, { style: { color: MUTED, size: 18 } }));
  }

  if (proposal.alternatives.length > 0) {
    children.push(heading(a.alternatives));
    for (const alternative of proposal.alternatives) {
      children.push(heading(alternative.title, 2));
      if (alternative.summary) children.push(para(alternative.summary));
      children.push(labelled(a.notRetained, `${alternative.reason} (${t[alternative.feasibility]})`));
      if (alternative.conditions.length > 0) children.push(labelled(t.conditions, alternative.conditions.join("; ")));
    }
  }

  if (proposal.risks.length > 0) {
    children.push(heading(a.risksMitigations));
    children.push(
      table(
        [t.risks, t.likelihood, t.impact, t.mitigation],
        proposal.risks.map((risk) => [risk.risk, t[risk.likelihood], t[risk.impact], risk.mitigation]),
      ),
    );
  }

  if (proposal.roadmap.length > 0) {
    children.push(heading(t.roadmap));
    for (const [index, phase] of proposal.roadmap.entries()) {
      children.push(heading(`${index + 1}. ${phase.phase}`, 3), para(phase.content));
      children.push(labelled(t.exitCriterion, phase.exitCriterion));
    }
  }

  if (proposal.assumptions.length > 0 || proposal.exclusions.length > 0) {
    children.push(heading(a.assumptionsExclusions));
    if (proposal.assumptions.length > 0) children.push(heading(t.assumptions, 2), ...bullets(proposal.assumptions));
    if (proposal.exclusions.length > 0) children.push(heading(a.exclusions, 2), ...bullets(proposal.exclusions));
  }

  if (proposal.openQuestions.length > 0) children.push(heading(a.toConfirm), ...numbered(proposal.openQuestions));

  // The attribution stays on branded documents, as on every export: Quorumind is AGPL software.
  const footer = [branding.name, revision, t.preparedWith].filter(Boolean).join(" · ");
  return document({ title: `${a.proposal}: ${proposal.title}`, description: a.proposal, footer, children });
}
