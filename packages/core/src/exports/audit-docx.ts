import { HeadingLevel, Paragraph } from "docx";
import { auditLabels } from "../audit-labels.ts";
import { auditDeliverable, auditMethodNotes, auditWords, needFacts } from "../audit-report.ts";
import type { Branding } from "../branding.ts";
import { fill, formatRange, participants, reportLabels, labelled as sayLabelled } from "../report.ts";
import type { Session } from "../session.ts";
import { type Block, docxKit, MUTED } from "./docx-kit.ts";

// The audit report as a Word document, to edit and forward: the opinion, the findings with the passages they are
// about, the coverage, the price and timeline, the questions to send, then what the document commits to.

export async function renderAuditDocx(session: Session, branding: Branding): Promise<Uint8Array> {
  const t = reportLabels(session.locale);
  const a = auditLabels(session.locale);
  const { rtl, accent, run, para, heading, bullets, numbered, table, masthead, document } = docxKit(session.locale, branding);
  const audit = auditDeliverable(session);
  const w = audit ? auditWords(audit) : null;
  const title = session.sheet?.projectName ?? session.audit?.extraction?.title ?? session.idea;
  const date = new Intl.DateTimeFormat(session.locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(session.updatedAt));
  // "Label: value" with the language's punctuation, the label in bold.
  const colon = session.locale === "fr" ? " : " : ": ";
  const labelled = (label: string, value: string) => para([run(`${label}${colon}`, { bold: true }), run(value)]);
  const say = (label: string, value: string) => sayLabelled(label, value, session.locale);
  const children: Block[] = [masthead()];

  children.push(para(a.title.toUpperCase(), { style: { bold: true, color: MUTED, size: 18 }, spacing: 40 }));
  children.push(new Paragraph({ children: [run(title)], heading: HeadingLevel.TITLE, bidirectional: rtl }));
  children.push(para(date, { style: { color: MUTED } }));
  const revision = session.revisions.at(-1);
  if (w && revision && session.revisions.length > 1) {
    children.push(para(w.revision({ number: revision.number, date: revision.createdAt }) ?? "", { style: { color: MUTED } }));
  }

  if (audit && w) {
    children.push(heading(a.opinion));
    children.push(para([run(w.opinion, { bold: true, size: 28, color: accent })]));
    children.push(para(w.opinionHint, { style: { italics: true, color: MUTED } }));
    children.push(para(audit.rationale));
    if (audit.summary) children.push(para(audit.summary));
    children.push(
      labelled(a.documentAudited, `${audit.document.title} (${w.kind}${audit.document.provider ? `, ${audit.document.provider}` : ""})`),
    );
    if (w.statedTotal) children.push(labelled(a.statedTotal, w.statedTotal));
    if (w.market) children.push(labelled(a.marketRange, `${w.market}${w.position ? ` · ${w.position}` : ""}`));
    if (w.budget) children.push(labelled(t.budget, w.budget));
    children.push(labelled(a.categoryTimeline, `${w.timelineAssessment}${w.deadline ? ` · ${w.deadline}` : ""}`));

    if (audit.findings.length > 0) {
      children.push(heading(a.findings), para(a.severityLegend, { style: { color: MUTED, size: 18 } }));
      for (const group of w.groups()) {
        children.push(heading(w.severity(group.severity), 2));
        for (const finding of group.items) {
          children.push(para([run(finding.title, { bold: true }), run(`  (${w.category(finding.category)})`, { color: MUTED })]));
          children.push(
            finding.quote
              ? para([run(`${a.inDocument}${colon}`, { bold: true, color: MUTED, size: 18 }), run(finding.quote, { italics: true })])
              : para(a.notInDocument, { style: { italics: true, color: MUTED } }),
          );
          if (finding.detail) children.push(para(finding.detail));
          if (finding.fix) children.push(labelled(a.fix, finding.fix));
        }
      }
    }

    if (audit.coverage.length > 0) {
      children.push(
        heading(a.coverage),
        table(
          [a.checkItem, a.status, a.note],
          audit.coverage.map((entry) => [w.item(entry.item), w.status(entry.status), entry.note]),
        ),
      );
    }

    children.push(heading(a.price), para([run(`${w.priceAssessment}. `, { bold: true }), run(audit.price.comment)]));
    const check = audit.check;
    const money = (value: number | null) => (value === null ? "–" : w.money(value));
    if (check && check.lines.length > 0) {
      children.push(
        heading(a.recomputed, 2),
        table(
          [a.line, a.days, a.dayRate, a.stated, a.computed, a.gap],
          [
            ...check.lines.map((line) => [
              line.name,
              w.days(line.days),
              money(line.dailyRate),
              money(line.stated),
              money(line.computed),
              line.gap === null ? "–" : money(line.gap),
            ]),
            [a.linesTotal, w.days(check.days), "", money(check.linesTotal), "", ""],
            ...(w.statedTotal ? [[a.statedTotal, "", "", w.statedTotal, "", check.totalGap === null ? "–" : money(check.totalGap)]] : []),
          ],
        ),
      );
    }
    children.push(...bullets(w.figureNotes()));
    if (check?.averageRate != null) children.push(labelled(a.averageRate, w.money(check.averageRate)));
    if (audit.price.market && w.market) {
      children.push(labelled(a.marketRange, `${w.market}${w.position ? ` (${w.position})` : ""}`));
      children.push(para(`${audit.price.market.basis} ${a.marketNote}`, { style: { color: MUTED, size: 18 } }));
    }

    children.push(heading(a.timeline), para([run(`${w.timelineAssessment}. `, { bold: true }), run(audit.timeline.comment)]));
    if (audit.timeline.stated) children.push(labelled(a.statedTimeline, audit.timeline.stated));
    if (w.deadline) children.push(para(w.deadline));

    if (audit.questions.length > 0) {
      children.push(heading(a.questions), para(a.questionsIntro, { style: { color: MUTED } }), ...numbered(audit.questions));
    }
    if (audit.negotiation.length > 0) children.push(heading(a.negotiation), ...bullets(audit.negotiation));

    const { commitments } = audit;
    children.push(heading(a.commitments));
    if (commitments.scope.length > 0) children.push(heading(a.scope, 3), ...bullets(commitments.scope));
    if (commitments.deliverables.length > 0) children.push(heading(a.deliverables, 3), ...bullets(commitments.deliverables));
    if (commitments.technologies.length > 0) children.push(labelled(a.technologies, commitments.technologies.join(", ")));
    for (const [label, value] of w.terms()) children.push(labelled(label, value));
    if (commitments.exclusions.length > 0) children.push(heading(a.exclusions, 3), ...bullets(commitments.exclusions));
    if (commitments.assumptions.length > 0) children.push(heading(a.assumptions, 3), ...bullets(commitments.assumptions));

    const alternative = audit.alternative;
    if (alternative) {
      const price = check?.statedTotal ?? check?.linesTotal ?? null;
      children.push(
        heading(a.alternative),
        para(a.alternativeNote, { style: { italics: true, color: MUTED } }),
        heading(alternative.title, 2),
        para(alternative.summary),
        table(
          ["", a.documentColumn, a.alternativeColumn],
          [
            [
              t.buildCost,
              price !== null ? w.money(price) : "–",
              alternative.buildCost ? `${formatRange(alternative.buildCost, session.locale)} (${t.estimate})` : "–",
            ],
            [
              t.buildTime,
              audit.timeline.weeks
                ? (w.weeks({ low: audit.timeline.weeks, high: audit.timeline.weeks }) ?? "–")
                : (audit.timeline.stated ?? "–"),
              w.weeks(alternative.buildWeeks) ?? "–",
            ],
            [
              t.monthlyCost,
              commitments.monthlyCost !== null ? fill(a.perMonth, { amount: w.money(commitments.monthlyCost) }) : "–",
              `${formatRange(alternative.monthlyCost, session.locale)} (${t.estimate})`,
            ],
          ],
        ),
      );
      if (alternative.feasibility && alternative.reason) children.push(labelled(t[alternative.feasibility], alternative.reason));
    }

    if (audit.risks.length > 0) {
      children.push(
        heading(t.risks),
        table(
          [t.risks, t.likelihood, t.impact, t.mitigation],
          audit.risks.map((risk) => [risk.risk, t[risk.likelihood], t[risk.impact], risk.mitigation]),
        ),
      );
    }
    if (audit.roadmap.length > 0) {
      children.push(
        heading(a.nextSteps),
        ...numbered(audit.roadmap.map((phase) => `${say(phase.phase, phase.content)} (${say(t.exitCriterion, phase.exitCriterion)})`)),
      );
    }
    if (audit.openQuestions.length > 0) children.push(heading(t.openQuestions), ...bullets(audit.openQuestions));
  }

  if (session.sheet) children.push(heading(a.need), para(session.sheet.summary), ...bullets(needFacts(session, t)));

  children.push(heading(a.method), ...auditMethodNotes(session, a, t).map((note) => para(note, { style: { color: MUTED } })));
  children.push(...bullets(participants(session, t).map((item) => say(item.role, item.model))));

  return document({ title: `${a.title}: ${title}`, description: a.title, footer: `${title} · ${t.preparedWith}`, children });
}
