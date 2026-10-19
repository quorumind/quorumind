import { type Branding, isAccent, parseLogo, QUORUMIND_ACCENT } from "../branding.ts";
import { decisionLabels } from "../decision-labels.ts";
import { comparisonDocument } from "../decision-report.ts";
import { localeInfo } from "../locales.ts";
import { reportLabels } from "../report.ts";
import type { Session } from "../session.ts";
import { PRINT_SCRIPT, REPORT_PAGE } from "./html.ts";

// Two versions of a decision side by side as one printable page, in the report's style: opened with print enabled,
// the browser's "Save as PDF" makes the PDF. A value that differs from the other version is in bold on a tinted
// cell, and marked for screen readers too. Every interpolated text comes from models or users and is escaped.

const { esc, list, styles, mark, cssString } = REPORT_PAGE;

const COMPARISON_STYLES = `
.versions { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-block-start: 20px; }
.version { border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; }
.version h2 { border: 0; padding: 0; margin-block-end: 6px; font-size: 17px; }
.compare th[scope="row"] { width: 30%; font-weight: 600; }
.compare td { width: 35%; }
.compare td.differs { background: color-mix(in srgb, var(--accent) 10%, transparent); font-weight: 700; }
.compare td.differs [aria-hidden] { color: var(--accent); }
.summary { font-size: 16px; font-weight: 600; margin-block-start: 18px; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media screen and (max-width: 720px) { .versions { grid-template-columns: 1fr; } }
@media print { .version, .compare tr { break-inside: avoid; } }
`;

/** The comparison of revisions `a` and `b` of a session as a printable page; null when either does not exist. */
export function renderComparisonHtml(
  session: Session,
  a: number,
  b: number,
  branding: Branding,
  options: { print: boolean },
): string | null {
  const doc = comparisonDocument(session, a, b);
  if (!doc) return null;
  const t = reportLabels(session.locale);
  const d = decisionLabels(session.locale);
  const info = localeInfo(session.locale);
  const accent = branding.accent && isAccent(branding.accent) ? branding.accent : QUORUMIND_ACCENT;
  const logo = branding.logoDataUrl && parseLogo(branding.logoDataUrl) ? branding.logoDataUrl : null;
  const branded = Boolean(branding.name || logo);
  const brand = branded
    ? `${logo ? `<img src="${esc(logo)}" alt="${esc(branding.name ?? "")}">` : ""}${branding.name ? `<span>${esc(branding.name)}</span>` : ""}`
    : `${mark}<span>Quorumind</span>`;
  const date = new Intl.DateTimeFormat(session.locale, { dateStyle: "long" }).format(new Date());
  const head = `<thead><tr><td></td><th scope="col">${esc(doc.columns[0])}</th><th scope="col">${esc(doc.columns[1])}</th></tr></thead>`;
  const value = (text: string, differs: boolean) =>
    differs
      ? `<td class="differs"><span aria-hidden="true">≠ </span>${esc(text)}<span class="visually-hidden"> (${esc(d.differs)})</span></td>`
      : `<td>${esc(text)}</td>`;
  const body: string[] = [
    `<header class="masthead"><div class="brand">${brand}</div><div class="meta">${esc(date)}</div></header>`,
    `<section class="cover"><p class="eyebrow">${esc(t.title)}</p><h1>${esc(doc.title)}</h1><p class="lead">${esc(doc.lead)}</p><p class="summary">${esc(doc.summary)}</p><p class="note">${esc(doc.legend)}</p></section>`,
    `<div class="versions">${[0, 1]
      .map((index) => {
        const notes = index === 0 ? doc.versions.left : doc.versions.right;
        return `<div class="version"><h2>${esc(doc.columns[index as 0 | 1])}</h2>${list(notes)}</div>`;
      })
      .join("")}</div>`,
  ];
  for (const section of doc.sections) {
    body.push(
      `<section><h2>${esc(section.title)}</h2><div class="table-wrap"><table class="table compare">${head}<tbody>${section.rows
        .map((row) => `<tr><th scope="row">${esc(row.label)}</th>${value(row.left, row.differs)}${value(row.right, row.differs)}</tr>`)
        .join("")}</tbody></table></div></section>`,
    );
  }
  for (const group of doc.risks) body.push(`<section><h2>${esc(group.title)}</h2>${list(group.items)}</section>`);
  body.push(
    `<footer class="foot"><span>${branded && branding.name ? `${esc(branding.name)} · ` : ""}${esc(t.preparedWith)}</span><span>${esc(date)}</span></footer>`,
  );
  const pageBoxes = `@page { @bottom-left { content: ${cssString(doc.title)}; font-size: 8pt; color: #535a78; } @bottom-right { content: ${cssString(`${t.page} `)} counter(page) " / " counter(pages); font-size: 8pt; color: #535a78; } }`;

  return `<!doctype html>
<html lang="${esc(session.locale)}" dir="${info.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Quorumind">
<title>${esc(doc.title)}</title>
<style>${styles.replace(":root {", `:root {\n  --accent: ${accent};`)}${COMPARISON_STYLES}${pageBoxes}</style>
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
