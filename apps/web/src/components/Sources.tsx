import type { ResearchSection, Session } from "@quorumind/core";
import { engineName, type NumberedSource, numberedSources, refsOf, researchSection } from "@quorumind/core/research-report";
import type { TFunction } from "i18next";
import { type MouseEvent, useId } from "react";
import { useTranslation } from "react-i18next";
import { ExternalIcon, SearchIcon } from "./Icons.tsx";

// The web research on screen: its progress in the debate's timeline, the inline references of the verdict's claims,
// and the sources panel of the verdict and of the client deliverable. Every link opens the source in a new tab without
// telling it where the reader came from.

const formatDate = (iso: string, locale: string) => {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(parsed) : iso;
};

/** Scrolls to a source of the list: the address's fragment belongs to the router, so it is left alone. */
function showSource(event: MouseEvent<HTMLAnchorElement>, ref: number) {
  event.preventDefault();
  const target = document.getElementById(`source-${ref}`);
  target?.scrollIntoView({ behavior: "smooth", block: "center" });
  target?.querySelector("a")?.focus({ preventScroll: true });
}

/** "[1, 3]" after a claim or a fact, each number a link to its source in the panel. */
export function SourceRefs({ refs }: { refs: number[] }) {
  if (refs.length === 0) return null;
  return (
    <sup className="source-refs">
      [
      {refs.map((ref, index) => (
        <span key={ref}>
          {index > 0 ? ", " : ""}
          <a href={`#source-${ref}`} onClick={(event) => showSource(event, ref)}>
            {ref}
          </a>
        </span>
      ))}
      ]
    </sup>
  );
}

/** The references of a claim of the session's verdict. */
export function ClaimRefs({ session, ids }: { session: Session; ids: string[] | undefined }) {
  return <SourceRefs refs={refsOf(ids, numberedSources(session))} />;
}

/** The address of a source, when it is a web page's: anything else is shown as text, never as a link. */
function webAddress(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed : null;
  } catch {
    return null;
  }
}

function SourceList({ sources }: { sources: NumberedSource[] }) {
  const { t, i18n } = useTranslation();
  return (
    <ol className="sources">
      {sources.map((source) => {
        const address = webAddress(source.url);
        return (
          <li id={`source-${source.number}`} key={source.id}>
            {address ? (
              <a href={address.href} target="_blank" rel="noopener noreferrer">
                {source.title}
                <ExternalIcon />
                <span className="visually-hidden">({t("research.newTab")})</span>
              </a>
            ) : (
              <span>{source.title}</span>
            )}
            <span className="field-hint">
              {address ? `${address.hostname} · ` : ""}
              {t("research.retrieved", { date: formatDate(source.retrievedAt, i18n.language) })}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The facts of a research section with their references, then its numbered sources. */
export function ResearchFacts({ section, claims = false }: { section: ResearchSection; claims?: boolean }) {
  const { t } = useTranslation();
  // The verdict and a client report can both show one: each heading has an id of its own.
  const titleId = useId();
  return (
    <section className="stack research-panel" aria-labelledby={titleId}>
      <h2 className="heading" id={titleId}>
        {t("research.title")}
      </h2>
      <p className="field-hint" style={{ margin: 0 }}>
        {t("research.intro", { date: section.date, engine: section.engine })}
      </p>
      {claims ? (
        <p className="field-hint" style={{ margin: 0 }}>
          {t("research.claimsNote")}
        </p>
      ) : null}
      <ul className="research-facts">
        {section.facts.map((fact) => (
          <li key={fact.fact}>
            {fact.fact}
            <SourceRefs refs={fact.refs} />
          </li>
        ))}
      </ul>
      <h3 className="title">{t("research.sources")}</h3>
      <SourceList sources={section.sources} />
    </section>
  );
}

/** Why a session has no sources to show, or null when it did not ask for research (the method box says so). */
function missingReason(session: Session, t: TFunction): string | null {
  const research = session.research;
  if (!research) return session.european ? t("research.skipped.european") : null;
  if (research.status === "skipped") return t(`research.skipped.${research.skipped ?? "unavailable"}`);
  if (research.status === "failed") return t("research.failed");
  if (research.status === "done" && research.facts.length === 0) return t("research.empty");
  return null;
}

/** The sources panel of the verdict: the facts the research found and their sources, or why there are none. */
export function SourcesPanel({ session }: { session: Session }) {
  const { t, i18n } = useTranslation();
  const section = researchSection(session);
  if (!section) {
    const reason = missingReason(session, t);
    return reason ? <p className="field-hint research-note">{reason}</p> : null;
  }
  // The dates and the engine in the interface's language, not the report's.
  const date = formatDate(session.research?.finishedAt ?? section.date, i18n.language);
  return (
    <ResearchFacts claims section={{ ...section, date, engine: engineName(session.research?.engine ?? null, t("research.engineDemo")) }} />
  );
}

/** The research in the debate's timeline: each search as it runs, then what was found. */
export function ResearchCard({ session, searching }: { session: Session; searching: boolean }) {
  const { t } = useTranslation();
  const research = session.research;
  if (!research) return null;
  const reason = missingReason(session, t);
  const next = research.queries.findIndex((item) => item.searchedAt === null && item.error === null);
  return (
    <div className="message voice-arbiter research-card">
      <div className="message-head">
        <span className="voice-icon">
          <SearchIcon />
        </span>
        <span className="label">{t("research.title")}</span>
      </div>
      <div className="bubble stack">
        {research.status === "running" ? <p className="speech">{t("research.running")}</p> : null}
        {reason ? <p className="speech">{reason}</p> : null}
        {research.queries.length > 0 ? (
          <ul className="research-queries">
            {research.queries.map((query, index) => {
              // The search under way: the first one not done yet.
              const current = searching && index === next;
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: two questions can lead to the same query.
                <li key={`${index}-${query.query}`}>
                  <span>{query.question}</span>
                  <span className="field-hint">
                    {query.searchedAt !== null
                      ? t("research.pages", { count: query.sources.length })
                      : query.error !== null
                        ? t("research.notSearched")
                        : current
                          ? t("research.searching")
                          : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
        {research.status === "done" && research.facts.length > 0 ? (
          <p className="field-hint" style={{ margin: 0 }}>
            {t("research.facts", { count: research.facts.length })}
          </p>
        ) : null}
      </div>
    </div>
  );
}
