import { agencyLabels } from "../agency-labels.ts";
import { type Branding, isAccent, parseLogo, QUORUMIND_ACCENT } from "../branding.ts";
import type { ClientProposal } from "../deliverable.ts";
import { localeInfo } from "../locales.ts";
import { checkLine, fill, formatDayRange, formatMoney, formatRange, labelled, reportLabels, weeksText } from "../report.ts";
import { formatDate } from "../revision-report.ts";
import { PRINT_SCRIPT, REPORT_PAGE } from "./html.ts";

// The client proposal as one printable page, in the report's style and the agency's colors: opened with print
// enabled, the browser's "Save as PDF" makes the PDF. Every interpolated text comes from models or users and is
// escaped.

const { esc, list, styles, mark, cssString } = REPORT_PAGE;

const PROPOSAL_STYLES = `
.proposal-cover { min-height: 70vh; display: flex; flex-direction: column; justify-content: center; gap: 14px; padding-block: 48px; border-block-end: 1px solid var(--line); }
.proposal-cover .brand img { max-height: 64px; max-width: 260px; }
.proposal-cover h1 { font-size: 40px; }
.proposal-cover dl { display: grid; gap: 6px; margin-block-start: 12px; }
.proposal-cover dl div { display: flex; gap: 8px; flex-wrap: wrap; }
.alternative { border: 1px solid var(--line); border-radius: 10px; padding: 18px 20px; margin-block-start: 14px; }
.alternative h3 { margin-block-end: 6px; }
@media print { .proposal-cover { min-height: 0; height: 240mm; break-after: page; border: 0; } .alternative { break-inside: avoid; } }
`;

export function renderProposalHtml(proposal: ClientProposal, branding: Branding, options: { print: boolean }): string {
  const t = reportLabels(proposal.locale);
  const a = agencyLabels(proposal.locale);
  const info = localeInfo(proposal.locale);
  const accent = branding.accent && isAccent(branding.accent) ? branding.accent : QUORUMIND_ACCENT;
  const logo = branding.logoDataUrl && parseLogo(branding.logoDataUrl) ? branding.logoDataUrl : null;
  const brand =
    branding.name || logo
      ? `${logo ? `<img src="${esc(logo)}" alt="${esc(branding.name ?? "")}">` : ""}${branding.name ? `<span>${esc(branding.name)}</span>` : ""}`
      : `${mark}<span>Quorumind</span>`;
  const say = (label: string, value: string) => esc(labelled(label, value, proposal.locale));
  const range = (value: { low: number; high: number; currency: string }) => formatRange(value, proposal.locale);
  const revision = proposal.revision
    ? fill(a.revisionDated, { number: proposal.revision.number, date: formatDate(proposal.revision.date, proposal.locale) })
    : null;
  const title = proposal.title || a.proposal;
  const section = (heading: string, content: string) => (content ? `<section><h2>${esc(heading)}</h2>${content}</section>` : "");
  const labelledList = (label: string, items: string[]) => (items.length > 0 ? `<p class="label">${esc(label)}</p>${list(items)}` : "");
  const body: string[] = [];

  const facts = [
    proposal.client ? `<div><dt>${esc(a.preparedFor)}</dt><dd>${esc(proposal.client)}</dd></div>` : "",
    branding.name ? `<div><dt>${esc(a.preparedBy)}</dt><dd>${esc(branding.name)}</dd></div>` : "",
  ].join("");
  body.push(
    `<header class="proposal-cover"><div class="brand">${brand}</div><p class="eyebrow">${esc(a.proposal)}</p><h1>${esc(title)}</h1>${
      facts ? `<dl>${facts}</dl>` : ""
    }${revision ? `<p class="muted">${esc(revision)}</p>` : ""}</header>`,
  );

  const context = proposal.context;
  if (context) {
    body.push(
      section(
        a.understanding,
        `<p class="prose">${esc(context.summary)}</p><div class="two"><div>${labelledList(t.goals, context.goals)}${labelledList(
          t.successCriteria,
          context.successCriteria,
        )}</div><div>${labelledList(a.scope, context.scope)}${labelledList(t.hardConstraints, context.constraints)}</div></div>${
          context.deadline ? `<p>${say(t.deadline, context.deadline)}</p>` : ""
        }${context.budget ? `<p>${say(t.budget, context.budget)}</p>` : ""}`,
      ),
    );
  }

  const solution = proposal.solution;
  if (solution) {
    const figures: [string, string][] = [];
    if (solution.buildCost) figures.push([`${t.buildCost} (${t.estimate})`, range(solution.buildCost)]);
    if (solution.monthlyCost) figures.push([`${t.monthlyCost} (${t.estimate})`, range(solution.monthlyCost)]);
    if (solution.buildTime) figures.push([t.buildTime, solution.buildTime]);
    body.push(
      section(
        a.recommendedSolution,
        `<h3>${esc(solution.title)}</h3>${solution.summary ? `<p class="prose">${esc(solution.summary)}</p>` : ""}<p class="label">${esc(
          a.whyThisSolution,
        )}</p><p class="prose">${esc(solution.rationale)}</p>${labelledList(t.conditions, solution.conditions)}${labelledList(
          t.architecture,
          solution.architecture,
        )}${solution.stack.length > 0 ? `<p>${say(t.stack, solution.stack.join(", "))}</p>` : ""}${
          figures.length > 0
            ? `<p class="label">${esc(a.investment)}</p><div class="facts">${figures
                .map(([label, value]) => `<div class="fact"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`)
                .join("")}</div><p class="note">${esc(a.estimatesNote)}</p>`
            : ""
        }`,
      ),
    );
  } else {
    body.push(
      section(
        a.recommendedSolution,
        `<p><strong>${esc(t.noRecommendation)}</strong></p>${proposal.rationale ? `<p class="prose">${esc(proposal.rationale)}</p>` : ""}`,
      ),
    );
  }

  // The recommended solution's costing by work package: days and amounts, never the day rates behind them.
  const costing = proposal.costing;
  if (costing) {
    const money = (value: { low: number; high: number }) =>
      value.low === value.high
        ? formatMoney(value.low, costing.currency, proposal.locale)
        : formatRange({ ...value, currency: costing.currency }, proposal.locale);
    const days = (value: { low: number; high: number }) => formatDayRange(value, proposal.locale);
    const weeks = weeksText(costing.buildWeeks, t, proposal.locale);
    const checks = checkLine(costing.checks ?? undefined, t, proposal.locale);
    const table =
      costing.packages.length > 0
        ? `<div class="table-wrap"><table class="table"><thead><tr><th scope="col">${esc(t.workPackage)}</th><th scope="col">${esc(
            t.personDays,
          )}</th><th scope="col">${esc(t.amount)}</th></tr></thead><tbody>${costing.packages
            .map(
              (item) =>
                `<tr><th scope="row">${esc(item.name)}${item.description ? `<span class="note">${esc(item.description)}</span>` : ""}</th><td>${esc(days(item.days))}</td><td>${esc(money(item.cost))}</td></tr>`,
            )
            .join(
              "",
            )}<tr><th scope="row">${esc(t.total)}</th><td><strong>${esc(days(costing.days))}</strong></td><td><strong>${esc(money(costing.total))}</strong></td></tr></tbody></table></div>`
        : `<p>${say(t.buildCost, money(costing.total))}</p>`;
    body.push(
      section(
        t.costing,
        `${table}${weeks ? `<p>${say(t.buildTime, weeks)}</p>` : ""}${checks ? `<p>${say(t.checks, checks)}</p>` : ""}<p class="note">${esc(a.estimatesNote)}</p>`,
      ),
    );
  }

  body.push(
    section(
      a.alternatives,
      proposal.alternatives
        .map(
          (alternative) =>
            `<article class="alternative"><h3>${esc(alternative.title)}</h3>${
              alternative.summary ? `<p class="prose">${esc(alternative.summary)}</p>` : ""
            }<p><span class="chip ${alternative.feasibility}">${esc(t[alternative.feasibility])}</span></p><p>${say(a.notRetained, alternative.reason)}</p>${
              alternative.conditions.length > 0 ? `<p class="note">${say(t.conditions, alternative.conditions.join(" · "))}</p>` : ""
            }</article>`,
        )
        .join(""),
    ),
  );

  if (proposal.risks.length > 0) {
    const level = (value: "low" | "medium" | "high") => `<span class="chip level-${value}">${esc(t[value])}</span>`;
    body.push(
      section(
        a.risksMitigations,
        `<div class="table-wrap"><table class="table"><thead><tr><th scope="col">${esc(t.risks)}</th><th scope="col">${esc(t.likelihood)}</th><th scope="col">${esc(
          t.impact,
        )}</th><th scope="col">${esc(t.mitigation)}</th></tr></thead><tbody>${proposal.risks
          .map(
            (risk) =>
              `<tr><td>${esc(risk.risk)}</td><td>${level(risk.likelihood)}</td><td>${level(risk.impact)}</td><td>${esc(risk.mitigation)}</td></tr>`,
          )
          .join("")}</tbody></table></div>`,
      ),
    );
  }

  if (proposal.roadmap.length > 0) {
    body.push(
      section(
        t.roadmap,
        `<ol class="roadmap">${proposal.roadmap
          .map(
            (phase) =>
              `<li><div><strong>${esc(phase.phase)}</strong><div>${esc(phase.content)}</div><span class="note">${say(t.exitCriterion, phase.exitCriterion)}</span></div></li>`,
          )
          .join("")}</ol>`,
      ),
    );
  }

  body.push(
    section(
      a.assumptionsExclusions,
      proposal.assumptions.length > 0 || proposal.exclusions.length > 0
        ? `<div class="two"><div>${labelledList(t.assumptions, proposal.assumptions)}</div><div>${labelledList(a.exclusions, proposal.exclusions)}</div></div>`
        : "",
    ),
  );
  if (proposal.openQuestions.length > 0) {
    body.push(
      section(a.toConfirm, `<ol class="steps">${proposal.openQuestions.map((question) => `<li>${esc(question)}</li>`).join("")}</ol>`),
    );
  }

  // Branded or not, the attribution stays, as on every export: Quorumind is AGPL software.
  body.push(
    `<footer class="foot"><span>${branding.name ? `${esc(branding.name)} · ` : ""}${esc(t.preparedWith)}</span><span>${esc(revision ?? "")}</span></footer>`,
  );
  const pageBoxes = `@page { @bottom-left { content: ${cssString(`${title}${revision ? ` · ${revision}` : ""}`)}; font-size: 8pt; color: #535a78; } @bottom-right { content: ${cssString(`${t.page} `)} counter(page) " / " counter(pages); font-size: 8pt; color: #535a78; } }`;

  return `<!doctype html>
<html lang="${esc(proposal.locale)}" dir="${info.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Quorumind">
<title>${esc(`${a.proposal}: ${title}`)}</title>
<style>${styles.replace(":root {", `:root {\n  --accent: ${accent};`)}${PROPOSAL_STYLES}${pageBoxes}</style>
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
