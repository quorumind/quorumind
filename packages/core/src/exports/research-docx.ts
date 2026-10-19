import type { Locale } from "../locales.ts";
import { researchLabels } from "../research-labels.ts";
import { formatResearchDate, type ResearchSection, refsText } from "../research-report.ts";
import { type Block, type docxKit, MUTED } from "./docx-kit.ts";

/**
 * The web research in a Word document: the facts with the numbers of their sources, then the sources with their
 * number, address and the day they were read. The numbers are written out: a Word numbered list would carry on the
 * numbering of the document's other lists.
 */
export function researchDocx(kit: ReturnType<typeof docxKit>, section: ResearchSection | null, locale: Locale): Block[] {
  if (!section) return [];
  const t = researchLabels(locale);
  const fill = (template: string, date: string) => template.replace("{date}", date);
  return [
    kit.heading(t.heading),
    kit.para(t.intro, { style: { color: MUTED, size: 18 } }),
    ...kit.bullets(section.facts.map((fact) => `${fact.fact} ${refsText(fact.refs)}`.trimEnd())),
    kit.heading(t.sources, 2),
    ...section.sources.map((source) =>
      kit.para(
        [
          kit.run(`[${source.number}] `, { bold: true }),
          kit.run(`${source.title}, ${source.url} `),
          kit.run(`(${fill(t.retrieved, formatResearchDate(source.retrievedAt, locale))})`, { color: MUTED }),
        ],
        { spacing: 60 },
      ),
    ),
  ];
}
