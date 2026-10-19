import type { Locale } from "./locales.ts";
import { citedSources, type ResearchRecord, type Source } from "./research.ts";
import { researchLabels } from "./research-labels.ts";
import type { Session } from "./session.ts";

// What the documents show of the web research: the facts it found with their numbered sources, the inline references of
// the verdict's claims, and the line of the method box that says whether it was used and when. Kept apart from
// report.ts and the exports, which call in here.

const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);

export function formatResearchDate(iso: string, locale: Locale): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return iso.slice(0, 10);
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(parsed);
}

/** The search engine as the documents name it. */
export function engineName(engine: string | null, demo: string): string {
  if (!engine || engine === "demo") return demo;
  if (engine === "brave") return "Brave Search";
  const [gateway, search] = engine.split(":");
  if (gateway === "openrouter") return search ? `OpenRouter (${search.charAt(0).toUpperCase()}${search.slice(1)})` : "OpenRouter";
  return engine;
}

/** A source as the documents list it: its number, its page and when it was read. */
export interface NumberedSource extends Source {
  number: number;
}

/** What a document shows of the research: the facts with the numbers of their sources, then the sources. */
export interface ResearchSection {
  date: string;
  engine: string;
  facts: { fact: string; question: string; refs: number[] }[];
  sources: NumberedSource[];
}

/** The sources the facts rest on, numbered from 1 in the order the research found them. */
export function numberedSources(session: Pick<Session, "research" | "sources">): NumberedSource[] {
  return citedSources(session).map((source, index) => ({ ...source, number: index + 1 }));
}

/** The numbers of the sources these ids name, in order; ids of sources the documents do not list are left out. */
export function refsOf(ids: string[] | undefined, sources: NumberedSource[]): number[] {
  const numbers = (ids ?? []).flatMap((id) => sources.find((source) => source.id === id)?.number ?? []);
  return [...new Set(numbers)].sort((a, b) => a - b);
}

/** "[1, 3]", or "" without references. */
export function refsText(refs: number[]): string {
  return refs.length > 0 ? `[${refs.join(", ")}]` : "";
}

/** The research of a session as the documents show it, or null when it found nothing to show. */
export function researchSection(session: Pick<Session, "research" | "sources" | "locale">): ResearchSection | null {
  const research = session.research;
  if (research?.status !== "done" || research.facts.length === 0) return null;
  const sources = numberedSources(session);
  const t = researchLabels(session.locale);
  return {
    date: formatResearchDate(research.finishedAt ?? research.startedAt, session.locale),
    engine: engineName(research.engine, t.engineDemo),
    facts: research.facts.map((fact) => ({ fact: fact.fact, question: fact.question, refs: refsOf(fact.sources, sources) })),
    sources,
  };
}

/** The line of the method box: whether web research was used, when and through what, or why not. */
export function researchNote(session: Pick<Session, "research" | "webResearch" | "european" | "locale">): string {
  const t = researchLabels(session.locale);
  const research: ResearchRecord | null = session.research;
  if (!research) return session.european ? t.methodEuropean : t.methodOff;
  const values = {
    date: formatResearchDate(research.finishedAt ?? research.startedAt, session.locale),
    engine: engineName(research.engine, t.engineDemo),
  };
  switch (research.status) {
    case "done":
      return fill(research.facts.length > 0 ? t.methodDone : t.methodEmpty, values);
    case "skipped":
      return research.skipped === "european" ? t.methodEuropean : research.skipped === "budget" ? t.methodBudget : t.methodUnavailable;
    case "failed":
      return t.methodFailed;
    case "running":
      return t.methodOff;
  }
}

const mdText = (text: string) => text.replace(/\s+/g, " ").replaceAll("[", "(").replaceAll("]", ")");

/** The research and sources sections of the report in Markdown; none when the research found nothing. */
export function researchMarkdown(session: Pick<Session, "research" | "sources" | "locale">): string[] {
  return researchSectionMarkdown(researchSection(session), session.locale, { intro: true });
}

/** The facts of a research section with the numbers of their sources, then the numbered sources, in Markdown. */
export function researchSectionMarkdown(section: ResearchSection | null, locale: Locale, options: { intro?: boolean } = {}): string[] {
  if (!section) return [];
  const t = researchLabels(locale);
  return [
    `## ${t.heading}`,
    "",
    ...(options.intro ? [`_${t.intro}_`, ""] : []),
    ...section.facts.map((fact) => `- ${fact.fact} ${refsText(fact.refs)}`.trimEnd()),
    "",
    ...sourcesMarkdown(section.sources, locale),
  ];
}

/** The numbered sources in Markdown, each with the day it was read. */
export function sourcesMarkdown(sources: NumberedSource[], locale: Locale): string[] {
  if (sources.length === 0) return [];
  const t = researchLabels(locale);
  return [
    `## ${t.sources}`,
    "",
    ...sources.map(
      (source) =>
        `${source.number}. [${mdText(source.title)}](<${source.url}>), ${fill(t.retrieved, { date: formatResearchDate(source.retrievedAt, locale) })}`,
    ),
    "",
  ];
}

/** Inline references in HTML: superscript numbers that link to the sources list. */
export function refsHtml(refs: number[]): string {
  if (refs.length === 0) return "";
  return ` <sup class="refs">[${refs.map((ref) => `<a href="#source-${ref}">${ref}</a>`).join(", ")}]</sup>`;
}

/** The numbered sources in HTML: each page opens in a new tab, without telling it where the reader came from. */
export function sourcesHtml(sources: NumberedSource[], locale: Locale, esc: (value: string) => string): string {
  if (sources.length === 0) return "";
  const t = researchLabels(locale);
  return `<h2>${esc(t.sources)}</h2><ol class="sources">${sources
    .map(
      (source) =>
        `<li id="source-${source.number}"><a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.title)}</a> <span class="muted">${esc(new URL(source.url).hostname)} · ${esc(fill(t.retrieved, { date: formatResearchDate(source.retrievedAt, locale) }))}</span></li>`,
    )
    .join("")}</ol>`;
}

/** The research section of the HTML report, or an empty string. `esc` escapes text for HTML. */
export function researchHtml(session: Pick<Session, "research" | "sources" | "locale">, esc: (value: string) => string): string {
  const section = researchSection(session);
  if (!section) return "";
  const t = researchLabels(session.locale);
  const facts = section.facts.map((fact) => `<li>${esc(fact.fact)}${refsHtml(fact.refs)}</li>`).join("");
  return `<section class="research"><h2>${esc(t.heading)}</h2><p class="muted">${esc(t.intro)}</p><ul>${facts}</ul>${sourcesHtml(section.sources, session.locale, esc)}</section>`;
}
