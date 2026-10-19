import { type AgencyLabels, agencyLabels } from "./agency-labels.ts";
import { debateCurrency } from "./costing.ts";
import { decisionLabels } from "./decision-labels.ts";
import { scenarioLines } from "./decision-report.ts";
import { fill, formatRange, formatScore, labelled, type ReportLabels, reportLabels, seatName, weeksText } from "./report.ts";
import { revisionChanges, unchanged } from "./revisions.ts";
import { currentProposals, currentRevision, type RevisionReason, type Session } from "./session.ts";

// The revision a document shows, and what changed since the previous one, as plain lines every export renders the
// same way (Markdown, HTML and PDF, Word).

export interface ChangeGroup {
  title: string;
  items: string[];
}

export interface RevisionNote {
  number: number;
  /** "Revision 2 · 19 October 2026". */
  label: string;
  /** Why the revision was made, e.g. "Updated with the client's answers". */
  reason: string;
  /** The facts it was made from, as "question: answer" lines; empty for the debate's verdict. */
  facts: string[];
  factsTitle: string;
  /** Null for the first revision. */
  changes: { title: string; groups: ChangeGroup[]; empty: string | null } | null;
}

const REASONS: Record<RevisionReason, keyof AgencyLabels> = {
  debate: "reasonDebate",
  client_answers: "reasonClientAnswers",
  edit: "reasonEdit",
  scenario: "reasonScenario",
};

export function formatDate(iso: string, locale: Session["locale"]): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(iso));
}

/** The revision of the verdict a session shows, with its changes; null before the arbiter ruled. */
export function revisionNote(session: Session): RevisionNote | null {
  const revision = currentRevision(session);
  if (!revision || !session.verdict) return null;
  const t = reportLabels(session.locale);
  const a = agencyLabels(session.locale);
  const label = fill(a.revisionDated, { number: revision.number, date: formatDate(revision.createdAt, session.locale) });
  const facts = revision.inputs.facts.map((fact) => {
    const answer = [fact.answer || a.none, fact.comment ? `(${fact.comment})` : ""].filter(Boolean).join(" ");
    return fact.question ? labelled(fact.question, answer, session.locale) : answer;
  });
  if (revision.inputs.note && !revision.scenario) facts.push(revision.inputs.note);
  const changes = revisionChanges(session, revision.number);
  const d = decisionLabels(session.locale);
  return {
    number: revision.number,
    label,
    reason: revision.scenario ? fill(d.scenarioNamed, { title: revision.scenario.title }) : a[REASONS[revision.reason]],
    // A scenario's changes, in the document's language, rather than the sentences the models read.
    facts: revision.scenario ? scenarioLines(revision.scenario, session.locale) : facts,
    factsTitle: revision.scenario ? d.changes : a.newFacts,
    changes: changes
      ? {
          title: fill(a.whatChanged, { number: changes.since }),
          groups: unchanged(changes) ? [] : changeGroups(session, changes, t, a),
          empty: unchanged(changes) ? a.noChange : null,
        }
      : null,
  };
}

function changeGroups(
  session: Session,
  changes: NonNullable<ReturnType<typeof revisionChanges>>,
  t: ReportLabels,
  a: AgencyLabels,
): ChangeGroup[] {
  const locale = session.locale;
  const proposals = currentProposals(session);
  const optionName = (seat: string | null) => {
    if (!seat) return t.noRecommendation;
    const title = proposals[seat]?.title ?? session.verdict?.options.find((option) => option.seat === seat)?.title;
    return title ? `${seatName(seat, t)} (${title})` : seatName(seat, t);
  };
  const arrow = (from: string, to: string) => fill(a.fromTo, { from, to });
  const score = (value: number | null) => (value === null ? "–" : formatScore(value, locale));
  const groups: ChangeGroup[] = [];
  const push = (title: string, items: string[]) => {
    if (items.length > 0) groups.push({ title, items });
  };

  if (changes.recommendation) {
    push(t.recommendation, [arrow(optionName(changes.recommendation.from), optionName(changes.recommendation.to))]);
  }
  push(
    t.feasibility,
    changes.feasibility.map((item) => labelled(seatName(item.seat, t), arrow(t[item.from], t[item.to]), locale)),
  );
  push(t.scores, [
    ...changes.weighted.map((item) =>
      labelled(`${seatName(item.seat, t)} · ${t.weightedScore}`, arrow(score(item.from), score(item.to)), locale),
    ),
    ...changes.scores.map((item) =>
      labelled(`${seatName(item.seat, t)} · ${item.criterion}`, arrow(String(item.from ?? "–"), String(item.to ?? "–")), locale),
    ),
  ]);
  push(
    a.risksAdded,
    changes.risks.added.map((risk) => `${risk.risk} (${t.likelihood}: ${t[risk.likelihood]}, ${t.impact}: ${t[risk.impact]})`),
  );
  push(
    a.risksRemoved,
    changes.risks.removed.map((risk) => risk.risk),
  );
  push(
    a.risksChanged,
    changes.risks.changed.map((item) =>
      labelled(
        item.risk,
        [
          item.from.likelihood !== item.to.likelihood ? `${t.likelihood} ${arrow(t[item.from.likelihood], t[item.to.likelihood])}` : "",
          item.from.impact !== item.to.impact ? `${t.impact} ${arrow(t[item.from.impact], t[item.to.impact])}` : "",
        ]
          .filter(Boolean)
          .join(", "),
        locale,
      ),
    ),
  );
  const currency = debateCurrency(session);
  const range = (value: { low: number; high: number } | null) => (value ? formatRange({ ...value, currency }, locale) : "–");
  push(
    a.costEstimates,
    changes.costs.map((item) => labelled(`${seatName(item.seat, t)} · ${t.monthlyCost}`, arrow(range(item.from), range(item.to)), locale)),
  );
  const weeks = (value: { low: number; high: number } | null) => weeksText(value, t, locale) ?? "–";
  push(
    t.buildTime,
    changes.schedules.map((item) =>
      labelled(`${seatName(item.seat, t)} · ${t.buildTime}`, arrow(weeks(item.from), weeks(item.to)), locale),
    ),
  );
  push(a.questionsAnswered, changes.questions.answered);
  push(a.questionsAdded, changes.questions.added);
  return groups;
}

/** The "What changed" section of the Markdown report: nothing for the debate's own verdict. */
export function revisionMarkdown(note: RevisionNote): string[] {
  if (!note.changes) return [];
  const lines = [`## ${note.changes.title}`, "", `_${note.label} · ${note.reason}_`, ""];
  if (note.changes.empty) lines.push(note.changes.empty, "");
  for (const group of note.changes.groups) lines.push(`### ${group.title}`, "", ...group.items.map((item) => `- ${item}`), "");
  if (note.facts.length > 0) lines.push(`### ${note.factsTitle}`, "", ...note.facts.map((fact) => `- ${fact}`), "");
  return lines;
}
