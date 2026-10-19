// Two versions of a decision side by side: two revisions of the verdict, or a scenario and the revision it branches
// from. Each side is the session as it stood at that revision, its costs and checks computed with its own numbers;
// the differences are flagged here so that the interface and every export highlight the same ones. Browser-safe.

import { activeRequirements, type ComplianceStatus, verdictCompliance } from "./compliance.ts";
import {
  type CheckStatus,
  type Costing,
  debateCurrency,
  deliveryChecks,
  type OptionChecks,
  proposalCosting,
  type Range,
} from "./costing.ts";
import { rankOptions } from "./ranking.ts";
import { changesBetween, type RevisionChanges } from "./revisions.ts";
import type { RevisionScenario } from "./scenarios.ts";
import type { Feasibility, Money, RequirementsSheet, Verdict } from "./schemas.ts";
import {
  currentProposals,
  currentRevision,
  type RevisionReason,
  type Session,
  sessionAtRevision,
  type VerdictRevision,
} from "./session.ts";

export interface ComparedOption {
  seat: string;
  title: string;
  /** Null when this version's verdict does not rule on the option. */
  feasibility: Feasibility | null;
  /** With the priorities of the requirements; null without scores. */
  weighted: number | null;
  /** By criterion; null when the option has no score for it. */
  scores: Record<string, number | null>;
  /** Priced from the work packages, in the debate's currency. */
  build: (Range & { currency: string }) | null;
  monthly: (Range & { currency: string }) | null;
  weeks: Range | null;
  checks: OptionChecks | null;
  /** The arbiter's compliance assessment, by requirement id; absent requirements were not assessed. */
  compliance: Record<string, ComplianceStatus>;
}

/** The figures of the requirements a scenario can change. */
export interface ComparedRequirements {
  build: Money | null;
  run: (Money & { period: "month" | "year" }) | null;
  deadline: RequirementsSheet["deadline"]["date"] | null;
  duration: RequirementsSheet["deadline"]["duration"];
  team: number | null;
  hardConstraints: string[];
}

export interface ComparedSide {
  number: number;
  createdAt: string;
  reason: RevisionReason;
  scenario: RevisionScenario | null;
  /** The revision the session shows (its decision): the adopted scenario, or the latest revision. */
  current: boolean;
  recommendation: { seat: string | null; title: string | null; rationale: string };
  options: ComparedOption[];
  risks: Verdict["risks"];
  requirements: ComparedRequirements;
}

/** What differs for one option, field by field. */
export interface OptionDiff {
  feasibility: boolean;
  weighted: boolean;
  /** The criteria whose score differs. */
  scores: string[];
  /** The compliance requirements whose assessment differs. */
  compliance: string[];
  build: boolean;
  monthly: boolean;
  weeks: boolean;
  checks: boolean;
}

export interface RevisionComparison {
  left: ComparedSide;
  right: ComparedSide;
  /** Every option of either side, in the order of their seats. */
  seats: string[];
  /** The criteria of the priorities, then any other one scored. */
  criteria: string[];
  /** The compliance requirements either side assessed, in the order of the requirements. */
  compliance: string[];
  diff: {
    recommendation: boolean;
    options: Record<string, OptionDiff>;
    /** From the left side to the right one. */
    risks: RevisionChanges["risks"];
    requirements: { build: boolean; run: boolean; deadline: boolean; team: boolean; constraints: { added: string[]; removed: string[] } };
    /** How many differences in all: 0 when the two sides are the same on every point compared. */
    count: number;
  };
}

const sameRange = (a: Range | null, b: Range | null) => (a === null ? b === null : b !== null && a.low === b.low && a.high === b.high);
const sameMoney = (a: Money | null, b: Money | null) =>
  a === null ? b === null : b !== null && a.amount === b.amount && a.currency === b.currency;
const checkStatus = (checks: OptionChecks | null): (CheckStatus | null)[] => [
  checks?.build?.status ?? null,
  checks?.run?.status ?? null,
  checks?.time?.status ?? null,
];
const key = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

function side(session: Session, view: Session, revision: VerdictRevision): ComparedSide {
  const verdict = view.verdict as Verdict;
  const weights = Object.fromEntries((view.sheet?.priorities ?? []).map((priority) => [priority.criterion, priority.weight]));
  const weighted = new Map(rankOptions(verdict, weights).map((option) => [option.seat, option.score]));
  const proposals = currentProposals(view);
  const checks = deliveryChecks(view);
  const assessed = verdictCompliance(verdict);
  const options = Object.entries(proposals).map(([seat, proposal]): ComparedOption => {
    const option = verdict.options.find((item) => item.seat === seat) ?? null;
    const costing: Costing | null = proposalCosting(view, proposal);
    const legacy = (proposal.monthlyCost as { currency?: string }).currency;
    return {
      seat,
      title: proposal.title,
      feasibility: option?.feasibility ?? null,
      weighted: weighted.get(seat) ?? null,
      scores: Object.fromEntries((option?.scores ?? []).map((score) => [score.criterion, score.score])),
      build: costing ? { ...costing.total, currency: costing.currency } : null,
      monthly: { low: proposal.monthlyCost.low, high: proposal.monthlyCost.high, currency: legacy ?? debateCurrency(view) },
      weeks: proposal.buildWeeks,
      checks: checks[seat] ?? null,
      compliance: Object.fromEntries(assessed.filter((check) => check.seat === seat).map((check) => [check.requirement, check.status])),
    };
  });
  const seat = verdict.recommendation.seat;
  const sheet = view.sheet;
  return {
    number: revision.number,
    createdAt: revision.createdAt,
    reason: revision.reason,
    scenario: revision.scenario ?? null,
    current: currentRevision(session)?.number === revision.number,
    recommendation: { seat, title: seat ? (proposals[seat]?.title ?? null) : null, rationale: verdict.recommendation.rationale },
    options,
    risks: verdict.risks,
    requirements: {
      build: sheet?.budget.build ?? null,
      run: sheet?.budget.run ?? null,
      deadline: sheet?.deadline.date ?? null,
      duration: sheet?.deadline.duration ?? null,
      team: sheet?.team.people ?? null,
      hardConstraints: sheet?.hardConstraints ?? [],
    },
  };
}

/**
 * Two revisions of a session side by side, `a` on the left and `b` on the right, with what differs from one to the
 * other. Null when either does not exist.
 */
export function compareRevisions(session: Session, a: number, b: number): RevisionComparison | null {
  const leftRevision = session.revisions.find((revision) => revision.number === a);
  const rightRevision = session.revisions.find((revision) => revision.number === b);
  const leftView = sessionAtRevision(session, a);
  const rightView = sessionAtRevision(session, b);
  if (!leftRevision || !rightRevision || !leftView?.verdict || !rightView?.verdict) return null;
  const left = side(session, leftView, leftRevision);
  const right = side(session, rightView, rightRevision);

  const seats = [...new Set([...left.options, ...right.options].map((option) => option.seat))].sort();
  const priorities = (rightView.sheet?.priorities ?? []).map((priority) => priority.criterion);
  const scored = [...left.options, ...right.options].flatMap((option) => Object.keys(option.scores));
  const criteria = [...new Set([...priorities, ...scored])];
  const assessed = new Set([...left.options, ...right.options].flatMap((option) => Object.keys(option.compliance)));
  const known = [...activeRequirements(leftView), ...activeRequirements(rightView)].map((requirement) => requirement.id);
  const compliance = [...new Set([...known, ...assessed])].filter((id) => assessed.has(id));

  let count = 0;
  const flag = (differs: boolean) => {
    if (differs) count++;
    return differs;
  };
  const options: Record<string, OptionDiff> = {};
  for (const seat of seats) {
    const was = left.options.find((option) => option.seat === seat) ?? null;
    const is = right.options.find((option) => option.seat === seat) ?? null;
    const weightedDiffers =
      (was?.weighted ?? null) !== (is?.weighted ?? null) &&
      (was?.weighted == null || is?.weighted == null || Math.abs(was.weighted - is.weighted) >= 0.05);
    options[seat] = {
      feasibility: flag((was?.feasibility ?? null) !== (is?.feasibility ?? null)),
      weighted: flag(weightedDiffers),
      scores: criteria.filter((criterion) => flag((was?.scores[criterion] ?? null) !== (is?.scores[criterion] ?? null))),
      compliance: compliance.filter((id) => flag((was?.compliance[id] ?? null) !== (is?.compliance[id] ?? null))),
      build: flag(!sameRange(was?.build ?? null, is?.build ?? null)),
      monthly: flag(!sameRange(was?.monthly ?? null, is?.monthly ?? null)),
      weeks: flag(!sameRange(was?.weeks ?? null, is?.weeks ?? null)),
      checks: flag(checkStatus(was?.checks ?? null).join() !== checkStatus(is?.checks ?? null).join()),
    };
  }

  const changes = changesBetween(leftView, rightView, a);
  count += changes.risks.added.length + changes.risks.removed.length + changes.risks.changed.length;
  const leftConstraints = new Set(left.requirements.hardConstraints.map(key));
  const rightConstraints = new Set(right.requirements.hardConstraints.map(key));
  const added = right.requirements.hardConstraints.filter((item) => !leftConstraints.has(key(item)));
  const removed = left.requirements.hardConstraints.filter((item) => !rightConstraints.has(key(item)));
  count += added.length + removed.length;
  const sameDuration = JSON.stringify(left.requirements.duration) === JSON.stringify(right.requirements.duration);
  const recommendation = flag(left.recommendation.seat !== right.recommendation.seat);
  const requirements = {
    build: flag(!sameMoney(left.requirements.build, right.requirements.build)),
    run: flag(
      !sameMoney(left.requirements.run, right.requirements.run) || left.requirements.run?.period !== right.requirements.run?.period,
    ),
    deadline: flag(left.requirements.deadline !== right.requirements.deadline || !sameDuration),
    team: flag(left.requirements.team !== right.requirements.team),
    constraints: { added, removed },
  };

  return { left, right, seats, criteria, compliance, diff: { recommendation, options, risks: changes.risks, requirements, count } };
}
