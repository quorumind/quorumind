import { auditLabels } from "../audit-labels.ts";
import { auditDeliverable, auditMethodNotes, auditSeatName, auditWords, needFacts } from "../audit-report.ts";
import { type Branding, isAccent, parseLogo, QUORUMIND_ACCENT } from "../branding.ts";
import { complianceHtml } from "../compliance-report.ts";
import { localeInfo } from "../locales.ts";
import { fill, formatRange, participants, reportLabels } from "../report.ts";
import type { Session } from "../session.ts";
import { documentReference, type HtmlOptions, PRINT_SCRIPT, REPORT_PAGE } from "./html.ts";

// The audit report as one printable page, in the style of the decision report: opened with print enabled, the
// browser's "Save as PDF" makes the PDF. Every interpolated text comes from models, documents or users and is escaped.

const AUDIT_STYLES = `
.verdict .hint { color: #b9bdd3; margin: 0 0 12px; }
.findings { display: grid; gap: 12px; }
.finding { border: 1px solid var(--line); border-inline-start: 4px solid var(--line); border-radius: 8px; padding: 12px 16px; }
.finding.blocking { border-inline-start-color: var(--infeasible); }
.finding.major { border-inline-start-color: var(--conditional); }
.finding header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; margin-block-end: 6px; }
.finding blockquote { margin: 6px 0 8px; padding: 6px 12px; border-inline-start: 3px solid var(--accent); background: var(--surface); font-style: italic; white-space: pre-line; }
.sev-blocking { background: var(--infeasible-soft); color: var(--infeasible); border-color: transparent; }
.sev-major { background: var(--conditional-soft); color: var(--conditional); border-color: transparent; }
.status-covered { background: var(--feasible-soft); color: var(--feasible); border-color: transparent; }
.status-partial { background: var(--conditional-soft); color: var(--conditional); border-color: transparent; }
.status-missing { background: var(--infeasible-soft); color: var(--infeasible); border-color: transparent; }
.recompute td.num, .recompute th.num { text-align: end; white-space: nowrap; }
.recompute .off { color: var(--infeasible); font-weight: 700; }
.recompute tfoot th, .recompute tfoot td { font-weight: 700; border-block-start: 2px solid var(--line); background: var(--surface); }
.questions li { margin-block-end: 6px; }
@media print { .finding { break-inside: avoid; } }
`;

export function renderAuditHtml(session: Session, branding: Branding, options: Pick<HtmlOptions, "print">): string {
  const { esc, list, styles, mark, cssString } = REPORT_PAGE;
  const t = reportLabels(session.locale);
  const a = auditLabels(session.locale);
  const info = localeInfo(session.locale);
  const audit = auditDeliverable(session);
  const w = audit ? auditWords(audit) : null;
  const title = session.sheet?.projectName ?? session.audit?.extraction?.title ?? session.idea;
  const reference = documentReference(session);
  const date = new Intl.DateTimeFormat(session.locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(session.updatedAt));
  const accent = branding.accent && isAccent(branding.accent) ? branding.accent : QUORUMIND_ACCENT;
  const logo = branding.logoDataUrl && parseLogo(branding.logoDataUrl) ? branding.logoDataUrl : null;
  const branded = Boolean(branding.name || logo);
  const brand = branded
    ? `${logo ? `<img src="${esc(logo)}" alt="${esc(branding.name ?? "")}">` : ""}${branding.name ? `<span>${esc(branding.name)}</span>` : ""}`
    : `${mark}<span>Quorumind</span>`;
  const revision = session.revisions.at(-1);
  const revisionText =
    w && revision && session.revisions.length > 1 ? w.revision({ number: revision.number, date: revision.createdAt }) : null;
  const say = (label: string, value: string) => esc(w ? w.say(label, value) : `${label}: ${value}`);
  const section = (heading: string, content: string, className = "") =>
    content ? `<section${className ? ` class="${className}"` : ""}><h2>${esc(heading)}</h2>${content}</section>` : "";
  const fact = (label: string, value: string) => `<div class="fact"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  const body: string[] = [];

  body.push(
    `<header class="masthead"><div class="brand">${brand}</div><div class="meta">${esc(date)}<br>${say(t.reference, reference)}${revisionText ? `<br>${esc(revisionText)}` : ""}</div></header>`,
    `<section class="cover"><p class="eyebrow">${esc(a.title)}</p><h1>${esc(title)}</h1>${
      session.audit?.extraction ? `<p class="lead">${esc(session.audit.extraction.title)}</p>` : ""
    }</section>`,
  );

  if (audit && w) {
    const facts = [
      fact(a.documentAudited, `${w.kind}${audit.document.provider ? ` · ${audit.document.provider}` : ""}`),
      w.statedTotal ? fact(a.statedTotal, w.statedTotal) : "",
      w.market ? fact(a.marketRange, `${w.market}${w.position ? ` · ${w.position}` : ""}`) : "",
      w.budget ? fact(t.budget, w.budget) : "",
      fact(a.categoryTimeline, `${w.timelineAssessment}${w.deadline ? ` · ${w.deadline}` : ""}`),
    ].join("");
    body.push(
      `<section class="verdict"><p class="eyebrow">${esc(a.opinion)}</p><h2>${esc(w.opinion)}</h2><p class="hint">${esc(w.opinionHint)}</p><p class="prose">${esc(
        audit.rationale,
      )}</p>${audit.summary ? `<p class="prose">${esc(audit.summary)}</p>` : ""}<div class="facts">${facts}</div></section>`,
    );

    body.push(
      section(
        a.findings,
        audit.findings.length > 0
          ? `<p class="note">${esc(a.severityLegend)}</p><div class="findings">${audit.findings
              .map(
                (finding) =>
                  `<article class="finding ${finding.severity}"><header><span class="chip sev-${finding.severity}">${esc(w.severity(finding.severity))}</span><span class="chip">${esc(
                    w.category(finding.category),
                  )}</span><strong>${esc(finding.title)}</strong></header>${
                    finding.quote
                      ? `<p class="label">${esc(a.inDocument)}</p><blockquote>${esc(finding.quote)}</blockquote>`
                      : `<p class="note">${esc(a.notInDocument)}</p>`
                  }${finding.detail ? `<p>${esc(finding.detail)}</p>` : ""}${finding.fix ? `<p>${say(a.fix, finding.fix)}</p>` : ""}</article>`,
              )
              .join("")}</div>`
          : "",
      ),
    );

    body.push(
      section(
        a.coverage,
        audit.coverage.length > 0
          ? `<div class="table-wrap"><table class="table"><thead><tr><th scope="col">${esc(a.checkItem)}</th><th scope="col">${esc(a.status)}</th><th scope="col">${esc(
              a.note,
            )}</th></tr></thead><tbody>${audit.coverage
              .map(
                (entry) =>
                  `<tr><th scope="row">${esc(w.item(entry.item))}</th><td><span class="chip status-${entry.status}">${esc(w.status(entry.status))}</span></td><td>${esc(entry.note)}</td></tr>`,
              )
              .join("")}</tbody></table></div>`
          : "",
      ),
    );

    body.push(complianceHtml(session, (seat) => auditSeatName(seat, a), esc));

    const check = audit.check;
    const money = (value: number | null) => (value === null ? "–" : esc(w.money(value)));
    const recompute =
      check && check.lines.length > 0
        ? `<h3>${esc(a.recomputed)}</h3><div class="table-wrap"><table class="table recompute"><thead><tr><th scope="col">${esc(a.line)}</th><th scope="col" class="num">${esc(
            a.days,
          )}</th><th scope="col" class="num">${esc(a.dayRate)}</th><th scope="col" class="num">${esc(a.stated)}</th><th scope="col" class="num">${esc(
            a.computed,
          )}</th><th scope="col" class="num">${esc(a.gap)}</th></tr></thead><tbody>${check.lines
            .map(
              (line) =>
                `<tr><th scope="row">${esc(line.name)}</th><td class="num">${esc(w.days(line.days))}</td><td class="num">${money(line.dailyRate)}</td><td class="num">${money(
                  line.stated,
                )}</td><td class="num">${money(line.computed)}</td><td class="num${line.gap ? " off" : ""}">${line.gap === null ? "–" : money(line.gap)}</td></tr>`,
            )
            .join(
              "",
            )}</tbody><tfoot><tr><th scope="row">${esc(a.linesTotal)}</th><td class="num">${esc(w.days(check.days))}</td><td></td><td class="num">${money(
            check.linesTotal,
          )}</td><td></td><td></td></tr>${
            w.statedTotal
              ? `<tr><th scope="row">${esc(a.statedTotal)}</th><td></td><td></td><td class="num">${esc(w.statedTotal)}</td><td></td><td class="num${check.totalGap ? " off" : ""}">${
                  check.totalGap === null ? "–" : money(check.totalGap)
                }</td></tr>`
              : ""
          }</tfoot></table></div>`
        : "";
    const notes = [...w.figureNotes(), check?.averageRate != null ? w.say(a.averageRate, w.money(check.averageRate)) : ""].filter(Boolean);
    const market =
      audit.price.market && w.market
        ? `<p>${say(a.marketRange, `${w.market}${w.position ? ` (${w.position})` : ""}`)}</p><p class="note">${esc(audit.price.market.basis)} ${esc(a.marketNote)}</p>`
        : "";
    body.push(
      section(
        a.price,
        `<p><span class="chip">${esc(w.priceAssessment)}</span> ${esc(audit.price.comment)}</p>${recompute}${notes.length > 0 ? list(notes) : ""}${market}`,
      ),
    );

    body.push(
      section(
        a.timeline,
        `<p><span class="chip">${esc(w.timelineAssessment)}</span> ${esc(audit.timeline.comment)}</p>${list(
          [audit.timeline.stated ? w.say(a.statedTimeline, audit.timeline.stated) : "", w.deadline ?? ""].filter(Boolean),
        )}`,
      ),
    );

    body.push(
      section(
        a.questions,
        audit.questions.length > 0
          ? `<p class="note">${esc(a.questionsIntro)}</p><ol class="questions">${audit.questions.map((question) => `<li>${esc(question)}</li>`).join("")}</ol>`
          : "",
      ),
      section(a.negotiation, list(audit.negotiation)),
    );

    const { commitments } = audit;
    const labelled = (label: string, items: string[]) => (items.length > 0 ? `<p class="label">${esc(label)}</p>${list(items)}` : "");
    body.push(
      section(
        a.commitments,
        `<div class="two"><div>${labelled(a.scope, commitments.scope)}${labelled(a.deliverables, commitments.deliverables)}${labelled(
          a.technologies,
          commitments.technologies,
        )}</div><div><dl class="context">${w
          .terms()
          .map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`)
          .join("")}</dl>${labelled(a.exclusions, commitments.exclusions)}${labelled(a.assumptions, commitments.assumptions)}</div></div>`,
      ),
    );

    const alternative = audit.alternative;
    if (alternative) {
      const price = check?.statedTotal ?? check?.linesTotal ?? null;
      const rows: [string, string, string][] = [
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
      ];
      body.push(
        section(
          a.alternative,
          `<p class="note">${esc(a.alternativeNote)}</p><h3>${esc(alternative.title)}</h3><p class="prose">${esc(alternative.summary)}</p>${
            alternative.feasibility && alternative.reason
              ? `<p><span class="chip ${alternative.feasibility}">${esc(t[alternative.feasibility])}</span> ${esc(alternative.reason)}</p>`
              : ""
          }<div class="table-wrap"><table class="table"><thead><tr><th scope="col"></th><th scope="col">${esc(a.documentColumn)}</th><th scope="col">${esc(
            a.alternativeColumn,
          )}</th></tr></thead><tbody>${rows
            .map(([label, document, other]) => `<tr><th scope="row">${esc(label)}</th><td>${esc(document)}</td><td>${esc(other)}</td></tr>`)
            .join("")}</tbody></table></div>`,
        ),
      );
    }

    if (audit.risks.length > 0) {
      const level = (value: "low" | "medium" | "high") => `<span class="chip level-${value}">${esc(t[value])}</span>`;
      body.push(
        section(
          t.risks,
          `<div class="table-wrap"><table class="table"><thead><tr><th scope="col">${esc(t.risks)}</th><th scope="col">${esc(t.likelihood)}</th><th scope="col">${esc(
            t.impact,
          )}</th><th scope="col">${esc(t.mitigation)}</th></tr></thead><tbody>${audit.risks
            .map(
              (risk) =>
                `<tr><td>${esc(risk.risk)}</td><td>${level(risk.likelihood)}</td><td>${level(risk.impact)}</td><td>${esc(risk.mitigation)}</td></tr>`,
            )
            .join("")}</tbody></table></div>`,
        ),
      );
    }
    body.push(
      section(
        a.nextSteps,
        audit.roadmap.length > 0
          ? `<ol class="roadmap">${audit.roadmap
              .map(
                (phase) =>
                  `<li><div><strong>${esc(phase.phase)}</strong><div>${esc(phase.content)}</div><span class="note">${say(t.exitCriterion, phase.exitCriterion)}</span></div></li>`,
              )
              .join("")}</ol>`
          : "",
      ),
      section(t.openQuestions, list(audit.openQuestions)),
    );
  }

  if (session.sheet) {
    body.push(section(a.need, `<p class="prose">${esc(session.sheet.summary)}</p>${list(needFacts(session, t))}`, "appendix"));
  }

  body.push(
    `<section class="method"><h2>${esc(a.method)}</h2>${auditMethodNotes(session, a, t)
      .map((note) => `<p>${esc(note)}</p>`)
      .join("")}<dl class="roles">${participants(session, t)
      .map((item) => `<div><dt>${esc(item.role)}</dt><dd>${esc(item.model)}</dd></div>`)
      .join("")}</dl></section>`,
    // Branded or not, the attribution stays, as on every export: Quorumind is AGPL software.
    `<footer class="foot"><span>${branded && branding.name ? `${esc(branding.name)} · ` : ""}${esc(t.preparedWith)}</span><span>${esc(date)} · ${say(
      t.reference,
      reference,
    )}</span></footer>`,
  );

  const pageBoxes = `@page { @bottom-left { content: ${cssString(`${title} · ${reference}`)}; font-size: 8pt; color: #535a78; } @bottom-right { content: ${cssString(`${t.page} `)} counter(page) " / " counter(pages); font-size: 8pt; color: #535a78; } }`;
  return `<!doctype html>
<html lang="${esc(session.locale)}" dir="${info.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Quorumind">
<title>${esc(`${a.title}: ${title}`)}</title>
<style>${styles.replace(":root {", `:root {\n  --accent: ${accent};`)}${AUDIT_STYLES}${pageBoxes}</style>
</head>
<body>
<main class="doc">
${body.filter(Boolean).join("\n")}
</main>
${options.print ? `<script>${PRINT_SCRIPT}</script>` : ""}
</body>
</html>
`;
}
