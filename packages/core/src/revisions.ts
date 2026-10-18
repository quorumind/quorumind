import { rankOptions } from "./ranking.ts";
import type { Feasibility, Verdict } from "./schemas.ts";
import { type CostEstimate, currentProposals, type Session, sessionAtRevision, type VerdictRevision } from "./session.ts";

// What changed between two revisions of a verdict, for the "What changed" section of the reports and the interface:
// the recommendation, the feasibility and scores of each option, the risks and the cost estimates.

export interface RevisionChanges {
  /** The revision compared with: the one this revision starts from. */
  since: number;
  /** Set when the recommended option changed. */
  recommendation: { from: string | null; to: string | null } | null;
  feasibility: { seat: string; from: Feasibility; to: Feasibility }[];
  /** Scores that moved, criterion by criterion. */
  scores: { seat: string; criterion: string; from: number | null; to: number | null }[];
  /** Weighted scores that moved, with the priorities of the requirements sheet. */
  weighted: { seat: string; from: number | null; to: number | null }[];
  risks: {
    added: Verdict["risks"];
    removed: Verdict["risks"];
    /** Same risk, another likelihood or impact. */
    changed: {
      risk: string;
      from: Pick<Verdict["risks"][number], "likelihood" | "impact">;
      to: Pick<Verdict["risks"][number], "likelihood" | "impact">;
    }[];
  };
  /** Running costs that moved, in the debate's currency (the build cost comes from the work packages). */
  costs: { seat: string; kind: "monthly"; from: CostEstimate | null; to: CostEstimate | null }[];
  /** Open questions that are no longer open, and new ones. */
  questions: { answered: string[]; added: string[] };
}

const key = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

const sameRange = (a: CostEstimate | null | undefined, b: CostEstimate | null | undefined) =>
  (a ?? null) === (b ?? null) || (!!a && !!b && a.low === b.low && a.high === b.high);

/** The revision with this number, or null. */
export function revisionOf(session: Session, number: number): VerdictRevision | null {
  return session.revisions.find((revision) => revision.number === number) ?? null;
}

/**
 * What a revision changed compared with the one it starts from. Null for the first revision, or when either is
 * missing. Model-written text is compared after trimming and folding case, so rewording a risk counts as a new one.
 */
export function revisionChanges(session: Session, number: number): RevisionChanges | null {
  const current = revisionOf(session, number);
  if (!current || current.basedOn === null) return null;
  const before = sessionAtRevision(session, current.basedOn);
  const after = sessionAtRevision(session, number);
  if (!before?.verdict || !after?.verdict) return null;
  const old = before.verdict;
  const now = after.verdict;

  const weights = Object.fromEntries((session.sheet?.priorities ?? []).map((priority) => [priority.criterion, priority.weight]));
  const oldWeighted = new Map(rankOptions(old, weights).map((option) => [option.seat, option.score]));
  const newWeighted = new Map(rankOptions(now, weights).map((option) => [option.seat, option.score]));
  const seats = [...new Set([...old.options, ...now.options].map((option) => option.seat))];

  const feasibility: RevisionChanges["feasibility"] = [];
  const scores: RevisionChanges["scores"] = [];
  const weighted: RevisionChanges["weighted"] = [];
  for (const seat of seats) {
    const was = old.options.find((option) => option.seat === seat);
    const is = now.options.find((option) => option.seat === seat);
    if (was && is && was.feasibility !== is.feasibility) feasibility.push({ seat, from: was.feasibility, to: is.feasibility });
    const criteria = [...new Set([...(was?.scores ?? []), ...(is?.scores ?? [])].map((score) => score.criterion))];
    for (const criterion of criteria) {
      const from = was?.scores.find((score) => score.criterion === criterion)?.score ?? null;
      const to = is?.scores.find((score) => score.criterion === criterion)?.score ?? null;
      if (from !== to) scores.push({ seat, criterion, from, to });
    }
    const from = oldWeighted.get(seat) ?? null;
    const to = newWeighted.get(seat) ?? null;
    if (from !== to && (from === null || to === null || Math.abs(from - to) >= 0.05)) weighted.push({ seat, from, to });
  }

  const oldRisks = new Map(old.risks.map((risk) => [key(risk.risk), risk]));
  const newRisks = new Map(now.risks.map((risk) => [key(risk.risk), risk]));
  const changed: RevisionChanges["risks"]["changed"] = [];
  for (const [id, risk] of newRisks) {
    const was = oldRisks.get(id);
    if (was && (was.likelihood !== risk.likelihood || was.impact !== risk.impact)) {
      changed.push({
        risk: risk.risk,
        from: { likelihood: was.likelihood, impact: was.impact },
        to: { likelihood: risk.likelihood, impact: risk.impact },
      });
    }
  }

  const oldProposals = currentProposals(before);
  const newProposals = currentProposals(after);
  const costs: RevisionChanges["costs"] = [];
  for (const seat of Object.keys(newProposals)) {
    const was = oldProposals[seat];
    const is = newProposals[seat];
    if (!was || !is) continue;
    if (!sameRange(was.monthlyCost, is.monthlyCost)) costs.push({ seat, kind: "monthly", from: was.monthlyCost, to: is.monthlyCost });
  }

  const oldQuestions = new Set(old.openQuestions.map(key));
  const newQuestions = new Set(now.openQuestions.map(key));
  return {
    since: current.basedOn,
    recommendation:
      old.recommendation.seat === now.recommendation.seat ? null : { from: old.recommendation.seat, to: now.recommendation.seat },
    feasibility,
    scores,
    weighted,
    risks: {
      added: now.risks.filter((risk) => !oldRisks.has(key(risk.risk))),
      removed: old.risks.filter((risk) => !newRisks.has(key(risk.risk))),
      changed,
    },
    costs,
    questions: {
      answered: old.openQuestions.filter((question) => !newQuestions.has(key(question))),
      added: now.openQuestions.filter((question) => !oldQuestions.has(key(question))),
    },
  };
}

/** True when the revision changed nothing that the "What changed" section lists. */
export function unchanged(changes: RevisionChanges): boolean {
  return (
    !changes.recommendation &&
    changes.feasibility.length === 0 &&
    changes.scores.length === 0 &&
    changes.risks.added.length === 0 &&
    changes.risks.removed.length === 0 &&
    changes.risks.changed.length === 0 &&
    changes.costs.length === 0 &&
    changes.questions.answered.length === 0 &&
    changes.questions.added.length === 0
  );
}
