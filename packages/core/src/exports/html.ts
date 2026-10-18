import { type Branding, isAccent, parseLogo, QUORUMIND_ACCENT } from "../branding.ts";
import { DIAGRAM_THEME, diagramSvg, layoutDiagram } from "../diagram.ts";
import { localeInfo } from "../locales.ts";
import { chosenOption, formatRange, modeName, type ReportLabels, reportLabels, seatName, sessionProbes } from "../report.ts";
import type { Proposal, TopicStatus } from "../schemas.ts";
import { currentProposals, DEVIL_SEAT, type Session, USER_SEAT } from "../session.ts";

// The printable report: one self-contained HTML page (inline CSS and SVG, no request to anything),
// styled with the "Contrepoint" palette. Opened with print enabled, it calls the browser's print
// dialog: "Save as PDF" then shapes every script correctly (Arabic, Devanagari, CJK), which
// JavaScript PDF libraries do not. Every interpolated text comes from models or users and is escaped.

/** The script of a print export; servers can allow exactly this one in their Content-Security-Policy. */
export const PRINT_SCRIPT = 'window.addEventListener("load",function(){window.print()});';

const esc = (value: string | number) =>
  String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

const MARK = `<svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><path d="M15.23 42.89A20 20 0 0 1 15.23 21.11M21.11 15.23A20 20 0 0 1 42.89 15.23" fill="none" stroke="#2b44c4" stroke-width="7"/><path d="M48.77 21.11A20 20 0 0 1 48.77 42.89M42.89 48.77A20 20 0 0 1 21.11 48.77" fill="none" stroke="#d9502f" stroke-width="7"/><circle cx="53.57" cy="53.57" r="6.2" fill="#141a3a"/></svg>`;

function seatClass(seat: string): string {
  if (seat === USER_SEAT) return "seat-u";
  if (seat === DEVIL_SEAT) return "seat-devil";
  return /^[A-D]$/.test(seat) ? `seat-${seat.toLowerCase()}` : "seat-other";
}

const STYLES = `
:root {
  --surface: #f6f7fb; --raised: #ffffff; --line: #d9dce8; --ink: #141a3a; --muted: #535a78;
  --thesis: #2b44c4; --thesis-soft: #e4e8fa; --antithesis: #d9502f; --antithesis-text: #b23a1e; --antithesis-soft: #fce6df;
  --feasible: #0f766e; --feasible-soft: #ddf2ef; --conditional: #8a5a00; --conditional-soft: #fbf1dc;
  --infeasible: #b0174f; --infeasible-soft: #fbe4ec; --voice-3: #7c45b0; --voice-4: #5e6c00;
  --sans: "Instrument Sans", "Inter", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif;
  --display: "Bricolage Grotesque", var(--sans);
  --mono: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  color-scheme: light;
}
:lang(ja) { --sans: "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Yu Gothic", Meiryo, "Noto Sans JP", "Noto Sans CJK JP", "IPAPGothic", sans-serif; --display: var(--sans); }
:lang(zh-Hans) { --sans: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", "Noto Sans CJK SC", "Source Han Sans SC", "WenQuanYi Zen Hei", sans-serif; --display: var(--sans); }
:lang(ar) { --sans: "IBM Plex Sans Arabic", "Geeza Pro", "Segoe UI", Tahoma, "Noto Sans Arabic", "Noto Naskh Arabic", "DejaVu Sans", sans-serif; --display: var(--sans); }
:lang(hi) { --sans: "Noto Sans Devanagari", "Kohinoor Devanagari", "Nirmala UI", Mangal, "Lohit Devanagari", sans-serif; --display: var(--sans); }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; background: var(--surface); color: var(--ink); font: 15px/1.55 var(--sans); -webkit-font-smoothing: antialiased; }
:lang(ja) body, :lang(zh-Hans) body, :lang(ar) body, :lang(hi) body { line-height: 1.75; }
.doc { max-width: 920px; margin: 0 auto; padding: 40px 32px 56px; background: var(--raised); min-height: 100vh; }
h1, h2, h3 { font-family: var(--display); margin: 0; text-wrap: balance; }
h1 { font-size: 34px; line-height: 1.15; letter-spacing: -0.015em; }
h2 { font-size: 21px; line-height: 1.3; padding-block-end: 8px; border-block-end: 2px solid var(--accent); margin-block-end: 16px; }
h3 { font-size: 16px; line-height: 1.35; }
p { margin: 0 0 10px; }
ul, ol { margin: 0; padding-inline-start: 22px; }
li + li { margin-block-start: 4px; }
section { margin-block-start: 36px; }
.prose { white-space: pre-line; }
/* Model text may be in another script than the document: each paragraph takes the direction of its
   first letter, so punctuation lands on the right side, while alignment follows the document. */
p, li, td, th, blockquote, h1, h3, .note, .title, .chip { unicode-bidi: plaintext; }
[dir="rtl"] :is(p, li, td, th, blockquote, h1, h3, .note, .title) { text-align: right; }
.matrix tbody th { min-width: 170px; }
.matrix td:nth-child(2) { min-width: 200px; }
.muted { color: var(--muted); }
.eyebrow { font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin: 0 0 6px; }
:lang(ja) .eyebrow, :lang(zh-Hans) .eyebrow, :lang(ar) .eyebrow, :lang(hi) .eyebrow { letter-spacing: 0; text-transform: none; }
.masthead { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding-block-end: 16px; border-block-end: 1px solid var(--line); }
.brand { display: inline-flex; align-items: center; gap: 10px; font-family: var(--display); font-weight: 700; font-size: 19px; }
.brand img { max-height: 40px; max-width: 180px; object-fit: contain; }
.mark { width: 30px; height: 30px; }
.masthead .meta { font-size: 13px; color: var(--muted); text-align: end; }
.cover { margin-block-start: 28px; }
.cover .lead { font-size: 17px; color: var(--muted); max-width: 68ch; margin-block-start: 10px; }
.verdict { margin-block-start: 28px; background: var(--ink); color: #f6f7fb; border-radius: 10px; padding: 28px; border-inline-start: 6px solid var(--accent); }
.verdict .eyebrow { color: #b9bdd3; }
.verdict h2 { border: 0; padding: 0; margin: 0 0 4px; font-size: 26px; }
.verdict .title { font-size: 17px; font-weight: 600; margin-block-end: 12px; }
.verdict p { max-width: 70ch; }
.facts { display: flex; flex-wrap: wrap; gap: 12px 28px; margin-block-start: 16px; }
.fact { display: grid; gap: 2px; }
.fact span:first-child { font-size: 12px; color: var(--muted); }
.verdict .fact span:first-child { color: #b9bdd3; }
.fact strong { font-variant-numeric: tabular-nums; }
.table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.table th, .table td { text-align: start; vertical-align: top; padding: 10px 12px; border-block-end: 1px solid var(--line); }
.table thead th { background: var(--surface); font-size: 12px; font-weight: 600; color: var(--muted); }
.table tbody tr:last-child > * { border-block-end: 0; }
.table tbody th { font-weight: 600; }
.note { display: block; font-size: 13px; color: var(--muted); margin-block-start: 6px; }
.chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; white-space: nowrap; background: var(--surface); color: var(--muted); border: 1px solid var(--line); }
.feasible { background: var(--feasible-soft); color: var(--feasible); border-color: transparent; }
.conditional { background: var(--conditional-soft); color: var(--conditional); border-color: transparent; }
.infeasible { background: var(--infeasible-soft); color: var(--infeasible); border-color: transparent; }
.level-high { background: var(--infeasible-soft); color: var(--infeasible); border-color: transparent; }
.level-medium { background: var(--conditional-soft); color: var(--conditional); border-color: transparent; }
.score { display: inline-flex; align-items: center; gap: 2px; white-space: nowrap; }
.score i { width: 8px; height: 8px; border-radius: 50%; background: var(--line); }
.score i.on { background: var(--accent); }
.score b { font: 500 12px var(--mono); margin-inline-start: 6px; }
.seat { display: inline-flex; align-items: center; justify-content: center; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 11px; font-size: 12px; font-weight: 700; color: #fff; background: var(--muted); }
.seat-a { background: var(--thesis); } .seat-b { background: var(--antithesis); } .seat-c { background: var(--voice-3); }
.seat-d { background: var(--voice-4); } .seat-u { background: var(--accent); } .seat-devil { background: var(--ink); }
.map { display: grid; gap: 14px; }
.map h3 { display: flex; align-items: center; gap: 8px; margin-block: 10px 2px; }
.dot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
.dot.agreement { background: var(--feasible); } .dot.divided { background: var(--conditional); } .dot.opposed { background: var(--infeasible); }
.topic { border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; }
.topic > strong { display: block; margin-block-end: 6px; }
.positions { list-style: none; padding: 0; display: grid; gap: 6px; }
.positions li { display: grid; grid-template-columns: auto 1fr; gap: 10px; align-items: baseline; margin: 0; }
.positions .who { font-size: 12px; font-weight: 600; color: var(--muted); white-space: nowrap; }
.probe { border-inline-start: 4px solid var(--antithesis); background: var(--antithesis-soft); border-radius: 8px; padding: 14px 18px; }
.probe blockquote { margin: 0 0 8px; font-size: 17px; font-weight: 600; }
.roadmap { list-style: none; padding: 0; counter-reset: phase; display: grid; gap: 12px; }
.roadmap li { counter-increment: phase; display: grid; grid-template-columns: 30px 1fr; gap: 12px; margin: 0; }
.roadmap li::before { content: counter(phase); width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; background: var(--thesis-soft); color: var(--thesis); font-weight: 700; font-size: 13px; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
.claims { list-style: none; padding: 0; display: grid; gap: 8px; }
.claims li { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; margin: 0; }
.proposal { border: 1px solid var(--line); border-radius: 10px; padding: 22px; margin-block-start: 18px; }
.proposal header { display: flex; align-items: baseline; gap: 10px; margin-block-end: 8px; }
.proposal h3 { font-size: 19px; }
.recommended { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.diagram { margin: 16px 0; padding: 12px; background: var(--surface); border-radius: 8px; }
.diagram svg { display: block; max-width: 100%; height: auto; margin-inline: auto; }
.diagram figcaption { font-size: 12px; color: var(--muted); margin-block-start: 6px; text-align: center; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-block: 6px 12px; }
.chips .chip { font-weight: 500; color: var(--ink); background: var(--raised); }
.label { font-size: 12px; font-weight: 600; color: var(--muted); margin: 14px 0 6px; }
.hard { border-inline-start: 3px solid var(--infeasible); padding-inline-start: 14px; }
.foot { margin-block-start: 48px; padding-block-start: 14px; border-block-start: 1px solid var(--line); font-size: 12px; color: var(--muted); display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; }
@media screen and (max-width: 720px) {
  .doc { padding: 24px 16px 40px; }
  h1 { font-size: 27px; }
  .two { grid-template-columns: 1fr; }
  .table-wrap, .diagram { overflow-x: auto; }
  .diagram svg { max-width: none; }
  .masthead { flex-wrap: wrap; }
}
@page { size: A4; margin: 16mm 14mm 18mm; }
@media print {
  body { background: #fff; font-size: 10.5pt; }
  .doc { max-width: none; padding: 0; min-height: 0; }
  section { margin-block-start: 22px; }
  h2, h3, .label { break-after: avoid; }
  tr, .topic, .probe, .verdict, .diagram, .roadmap li, .claims li, .fact { break-inside: avoid; }
  .proposals { break-before: page; }
  .proposal { break-inside: auto; }
  .proposal + .proposal { break-before: page; }
}
`;

const list = (items: string[], className = "") =>
  items.length > 0 ? `<ul${className ? ` class="${className}"` : ""}>${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : "";

function score(value: number, label: string) {
  const dots = [1, 2, 3, 4, 5].map((step) => `<i${step <= value ? ' class="on"' : ""}></i>`).join("");
  return `<span class="score" role="img" aria-label="${esc(label)}">${dots}<b>${esc(value)}</b></span>`;
}

function proposalCard(seat: string, proposal: Proposal, t: ReportLabels, session: Session, recommended: boolean, index: number) {
  const rtl = localeInfo(session.locale).dir === "rtl";
  const components = proposal.components ?? [];
  const flows = proposal.flows ?? [];
  const names = new Map(components.map((component) => [component.id, component.label]));
  const diagram =
    components.length > 0
      ? `<figure class="diagram">${diagramSvg(layoutDiagram(components, flows, { rtl }), DIAGRAM_THEME, {
          title: `${t.diagram}: ${proposal.title}`,
          description: flows
            .map((flow) => `${names.get(flow.from) ?? flow.from} → ${names.get(flow.to) ?? flow.to}: ${flow.label}`)
            .join("; "),
          idPrefix: `d${index}`,
        })}<figcaption>${esc(t.diagram)}</figcaption></figure>`
      : "";
  const facts = [
    [t.monthlyCost, `${formatRange(proposal.monthlyCost, session.locale)}`, t.estimate],
    // Proposals stored before V1 have no build cost.
    ...(proposal.buildCost ? [[t.buildCost, formatRange(proposal.buildCost, session.locale), t.estimate]] : []),
    [t.buildTime, proposal.buildTime, ""],
  ] as [string, string, string][];
  return `<article class="proposal${recommended ? " recommended" : ""}">
<header><span class="seat ${seatClass(seat)}">${esc(seat === USER_SEAT ? "U" : seat)}</span><h3>${esc(seatName(seat, t))}: ${esc(proposal.title)}</h3></header>
<p class="prose">${esc(proposal.summary)}</p>
${diagram}
<div class="facts">${facts.map(([label, value, note]) => `<div class="fact"><span>${esc(label)}${note ? ` (${esc(note)})` : ""}</span><strong>${esc(value)}</strong></div>`).join("")}</div>
<p class="note">${esc(t.estimate)}: ${esc(proposal.monthlyCost.basis)}${proposal.buildCost ? ` · ${esc(proposal.buildCost.basis)}` : ""}</p>
<p class="label">${esc(t.stack)}</p>
<div class="chips">${proposal.stack.map((item) => `<span class="chip">${esc(item)}</span>`).join("")}</div>
<div class="two"><div><p class="label">${esc(t.architecture)}</p>${list(proposal.architecture)}</div><div><p class="label">${esc(t.infrastructure)}</p>${list(proposal.infrastructure)}</div></div>
${proposal.risks.length > 0 ? `<p class="label">${esc(t.risks)}</p>${list(proposal.risks)}` : ""}
</article>`;
}

export interface HtmlOptions {
  /** Open the browser's print dialog as soon as the page is loaded: the PDF export. */
  print: boolean;
}

export function renderHtml(session: Session, branding: Branding, options: HtmlOptions): string {
  const t = reportLabels(session.locale);
  const info = localeInfo(session.locale);
  const verdict = session.verdict;
  const sheet = session.sheet;
  const proposals = currentProposals(session);
  const chosen = chosenOption(session);
  const project = sheet?.projectName ?? session.idea;
  const date = new Intl.DateTimeFormat(session.locale, { dateStyle: "long" }).format(new Date(session.updatedAt));
  const accent = branding.accent && isAccent(branding.accent) ? branding.accent : QUORUMIND_ACCENT;
  const logo = branding.logoDataUrl && parseLogo(branding.logoDataUrl) ? branding.logoDataUrl : null;
  const branded = Boolean(branding.name || logo);
  const brand = branded
    ? `${logo ? `<img src="${esc(logo)}" alt="${esc(branding.name ?? "")}">` : ""}${branding.name ? `<span>${esc(branding.name)}</span>` : ""}`
    : `${MARK}<span>Quorumind</span>`;
  const body: string[] = [];

  body.push(
    `<header class="masthead"><div class="brand">${brand}</div><div class="meta">${esc(date)}<br>${esc(t.mode)}: ${esc(modeName(session, t))}</div></header>`,
  );
  body.push(
    `<section class="cover"><p class="eyebrow">${esc(t.title)}</p><h1>${esc(project)}</h1>${sheet ? `<p class="lead prose">${esc(sheet.summary)}</p>` : ""}</section>`,
  );

  if (verdict) {
    const proposal = chosen?.proposal;
    const facts = proposal
      ? `<div class="facts"><div class="fact"><span>${esc(t.monthlyCost)} (${esc(t.estimate)})</span><strong>${esc(formatRange(proposal.monthlyCost, session.locale))}</strong></div>${
          proposal.buildCost
            ? `<div class="fact"><span>${esc(t.buildCost)} (${esc(t.estimate)})</span><strong>${esc(formatRange(proposal.buildCost, session.locale))}</strong></div>`
            : ""
        }<div class="fact"><span>${esc(t.buildTime)}</span><strong>${esc(proposal.buildTime)}</strong></div></div>`
      : "";
    body.push(
      `<section class="verdict"><p class="eyebrow">${esc(t.recommendation)}</p>${
        chosen
          ? `<h2>${esc(seatName(chosen.seat, t))}</h2>${proposal ? `<p class="title">${esc(proposal.title)}</p>` : ""}`
          : `<h2>${esc(t.noRecommendation)}</h2>`
      }<p class="prose">${esc(verdict.recommendation.rationale)}</p>${facts}</section>`,
    );

    const criteria = sheet?.priorities.map((priority) => priority.criterion) ?? [];
    const rows = verdict.options.map((option) => {
      const scores = criteria.map((criterion) => {
        const value = option.scores.find((item) => item.criterion === criterion)?.score;
        return `<td>${value ? score(value, `${criterion}: ${value}/5`) : "–"}</td>`;
      });
      const conditions =
        option.conditions.length > 0 ? `<span class="note">${esc(t.conditions)}: ${esc(option.conditions.join(" · "))}</span>` : "";
      return `<tr><th scope="row"><span class="seat ${seatClass(option.seat)}">${esc(option.seat)}</span> ${esc(option.title)}</th><td><span class="chip ${option.feasibility}">${esc(t[option.feasibility])}</span><span class="note">${esc(option.reason)}</span>${conditions}</td>${scores.join("")}</tr>`;
    });
    body.push(
      `<section><h2>${esc(t.options)}</h2><div class="table-wrap"><table class="table matrix"><thead><tr><th scope="col">${esc(t.option)}</th><th scope="col">${esc(t.feasibility)}</th>${criteria.map((criterion) => `<th scope="col">${esc(criterion)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div></section>`,
    );

    const topics = verdict.topics ?? [];
    if (topics.length > 0) {
      const groups = (
        [
          ["agreement", t.consensus],
          ["divided", t.divided],
          ["opposed", t.opposed],
        ] as [TopicStatus, string][]
      )
        .map(([status, heading]) => {
          const group = topics.filter((topic) => topic.status === status);
          if (group.length === 0) return "";
          const cards = group.map(
            (topic) =>
              `<div class="topic"><strong>${esc(topic.topic)}</strong><ul class="positions">${topic.positions
                .map(
                  (item) =>
                    `<li><span class="who">${item.seat ? `${item.seat === DEVIL_SEAT ? "" : `<span class="seat ${seatClass(item.seat)}">${esc(item.seat)}</span> `}${esc(seatName(item.seat, t))}` : ""}</span><span>${esc(item.position)}</span></li>`,
                )
                .join("")}</ul></div>`,
          );
          return `<h3><span class="dot ${status}"></span>${esc(heading)}</h3>${cards.join("")}`;
        })
        .join("");
      body.push(`<section><h2>${esc(t.debateMap)}</h2><div class="map">${groups}</div></section>`);
    }
  }

  const probes = sessionProbes(session);
  if (probes.length > 0) {
    body.push(
      `<section><h2>${esc(t.probe)}</h2>${probes
        .map(
          (probe) =>
            `<div class="probe"><blockquote>${esc(probe.data.angle)}</blockquote><p class="muted">${esc(t.probeRationale)}: ${esc(probe.data.rationale)}</p></div>`,
        )
        .join("")}</section>`,
    );
  }

  if (verdict) {
    if (verdict.risks.length > 0) {
      const level = (value: "low" | "medium" | "high") => `<span class="chip level-${value}">${esc(t[value])}</span>`;
      body.push(
        `<section><h2>${esc(t.risks)}</h2><div class="table-wrap"><table class="table"><thead><tr><th scope="col">${esc(t.risks)}</th><th scope="col">${esc(t.likelihood)}</th><th scope="col">${esc(t.impact)}</th><th scope="col">${esc(t.mitigation)}</th></tr></thead><tbody>${verdict.risks
          .map(
            (risk) =>
              `<tr><td>${esc(risk.risk)}</td><td>${level(risk.likelihood)}</td><td>${level(risk.impact)}</td><td>${esc(risk.mitigation)}</td></tr>`,
          )
          .join("")}</tbody></table></div></section>`,
      );
    }
    const roadmap =
      verdict.roadmap.length > 0
        ? `<div><h2>${esc(t.roadmap)}</h2><ol class="roadmap">${verdict.roadmap
            .map(
              (phase) =>
                `<li><div><strong>${esc(phase.phase)}</strong><div>${esc(phase.content)}</div><span class="note">${esc(t.exitCriterion)}: ${esc(phase.exitCriterion)}</span></div></li>`,
            )
            .join("")}</ol></div>`
        : "";
    const claims =
      verdict.claims.length > 0 || verdict.openQuestions.length > 0
        ? `<div>${
            verdict.claims.length > 0
              ? `<h2>${esc(t.claims)}</h2><ul class="claims">${verdict.claims
                  .map(
                    (claim) =>
                      `<li><span>${esc(claim.claim)}</span><span class="chip${claim.confidence === "verified" ? " feasible" : claim.confidence === "estimated" ? " conditional" : ""}">${esc(t[claim.confidence])}</span></li>`,
                  )
                  .join("")}</ul>`
              : ""
          }${verdict.openQuestions.length > 0 ? `<p class="label">${esc(t.openQuestions)}</p>${list(verdict.openQuestions)}` : ""}</div>`
        : "";
    if (roadmap || claims) body.push(`<section class="two">${roadmap}${claims}</section>`);
  }

  const seats = Object.keys(proposals);
  if (seats.length > 0) {
    body.push(
      `<section class="proposals"><h2>${esc(session.mode === "challenge" ? t.yourSolution : t.proposals)}</h2>${seats
        .map((seat, index) => proposalCard(seat, proposals[seat] as Proposal, t, session, seat === chosen?.seat, index))
        .join("")}</section>`,
    );
  }

  if (sheet) {
    const block = (title: string, items: string[], className = "") =>
      items.length > 0 ? `<div${className ? ` class="${className}"` : ""}><p class="label">${esc(title)}</p>${list(items)}</div>` : "";
    body.push(
      `<section><h2>${esc(t.requirements)}</h2><div class="two">${block(t.goals, sheet.goals)}${block(t.mustHave, sheet.mustHave)}${block(t.hardConstraints, sheet.hardConstraints, "hard")}${block(t.outOfScope, sheet.outOfScope)}${block(
        t.priorities,
        sheet.priorities.map((priority) => `${priority.criterion} (${priority.weight}/5)`),
      )}${block(t.assumptions, sheet.assumptions)}</div></section>`,
    );
  }

  const answers = session.debate.flatMap((entry) => (entry.kind === "answers" ? entry.answers : []));
  if (answers.length > 0) {
    body.push(`<section><h2>${esc(t.answers)}</h2>${list(answers.map((entry) => `${entry.question} → ${entry.answer}`))}</section>`);
  }

  // Branded or not, the attribution stays: Quorumind is AGPL software.
  body.push(
    `<footer class="foot"><span>${branded && branding.name ? `${esc(branding.name)} · ` : ""}${esc(t.preparedWith)}</span><span>${esc(date)}</span></footer>`,
  );

  return `<!doctype html>
<html lang="${esc(session.locale)}" dir="${info.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Quorumind">
<title>${esc(`${t.title}: ${project}`)}</title>
<style>${STYLES.replace(":root {", `:root {\n  --accent: ${accent};`)}</style>
</head>
<body>
<main class="doc">
${body.join("\n")}
</main>
${options.print ? `<script>${PRINT_SCRIPT}</script>` : ""}
</body>
</html>
`;
}
