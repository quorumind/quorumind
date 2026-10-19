// "What if" scenarios: from a completed session, the person tries a variant of the facts (a larger team, a smaller
// budget, an earlier deadline, a new constraint) and the arbiter rules again on the same options. The changes to the
// numbers of the requirements are applied here, by code, so the costing, budget and deadline checks of the scenario
// are computed with them; the scenario is a revision of its own, beside the others. Browser-safe.

import type { DurationUnit, RequirementsSheet } from "./schemas.ts";
import { currentRevision, isScenario, type Session, type VerdictRevision } from "./session.ts";

/**
 * One structured change of a scenario. team: people added (negative: removed). budget: the build or running budget
 * changed by a percentage (-30: 30% less). deadline: moved by weeks or months (negative: earlier). constraint: a new
 * hard constraint, e.g. "must run on-premises".
 */
export type ScenarioChange =
  | { kind: "team"; delta: number }
  | { kind: "budget"; target: "build" | "run"; percent: number }
  | { kind: "deadline"; delta: number; unit: DurationUnit }
  | { kind: "constraint"; text: string };

export interface RevisionScenario {
  /** The name the person gives it, e.g. "Budget cut". */
  title: string;
  /** The what-if in the person's own words; null when the structured changes say it all. */
  question: string | null;
  changes: ScenarioChange[];
}

/** Limits of a scenario, checked by the server and shown by the forms. */
export const SCENARIO_LIMITS = {
  title: 120,
  question: 4_000,
  changes: 10,
  constraint: 300,
  /** People added or removed at most. */
  team: 1_000,
  /** The budget changed by at least -95% and at most +500%. */
  minPercent: -95,
  maxPercent: 500,
  /** Weeks or months the deadline moves at most. */
  deadline: 104,
} as const;

/** A value of the requirements before and after a change, for the documents and the arbiter. */
export type ChangeValue =
  | { kind: "people"; value: number }
  | { kind: "money"; amount: number; currency: string; period: "month" | "year" | null }
  | { kind: "duration"; amount: number; unit: DurationUnit }
  | { kind: "date"; value: string };

/** What a change did to the requirements: applied with the values it moved, or not when the sheet had no such value. */
export interface AppliedChange {
  change: ScenarioChange;
  applied: boolean;
  from: ChangeValue | null;
  to: ChangeValue | null;
}

const WEEKS_PER_MONTH = 52 / 12;

/** A date YYYY-MM-DD moved by weeks or months; a month change keeps the day, or the last day of a shorter month. */
export function shiftDate(date: string, delta: number, unit: DurationUnit): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  if (unit === "week") return new Date(Date.UTC(year, month, day + delta * 7)).toISOString().slice(0, 10);
  const target = new Date(Date.UTC(year, month + delta, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.toISOString().slice(0, 10);
}

/**
 * The requirements with the scenario's changes applied: the team size, the budgets and the deadline moved, the new
 * hard constraints added. A change whose value the sheet does not give (no team size, no build budget) is left for
 * the arbiter to read as a fact.
 */
export function applyScenario(sheet: RequirementsSheet, changes: ScenarioChange[]): { sheet: RequirementsSheet; applied: AppliedChange[] } {
  const next = structuredClone(sheet);
  const applied: AppliedChange[] = [];
  for (const change of changes) {
    if (change.kind === "team") {
      const people = next.team.people;
      if (people === null) {
        applied.push({ change, applied: false, from: null, to: null });
        continue;
      }
      next.team.people = Math.max(1, people + change.delta);
      applied.push({ change, applied: true, from: { kind: "people", value: people }, to: { kind: "people", value: next.team.people } });
    } else if (change.kind === "budget") {
      const budget = change.target === "build" ? next.budget.build : next.budget.run;
      if (!budget) {
        applied.push({ change, applied: false, from: null, to: null });
        continue;
      }
      const period = change.target === "run" ? (next.budget.run?.period ?? null) : null;
      const from = { kind: "money" as const, amount: budget.amount, currency: budget.currency, period };
      budget.amount = Math.max(0, Math.round(budget.amount * (1 + change.percent / 100)));
      applied.push({ change, applied: true, from, to: { ...from, amount: budget.amount } });
    } else if (change.kind === "deadline") {
      const { date, duration } = next.deadline;
      if (duration && duration.amount > 0) {
        const from: ChangeValue = { kind: "duration", ...duration };
        if (duration.unit === change.unit && duration.amount + change.delta > 0) {
          duration.amount += change.delta;
        } else {
          // Another unit, or nothing left: counted in weeks, at least one.
          const weeks =
            (duration.unit === "week" ? duration.amount : duration.amount * WEEKS_PER_MONTH) +
            (change.unit === "week" ? change.delta : change.delta * WEEKS_PER_MONTH);
          next.deadline.duration = { amount: Math.max(1, Math.round(weeks)), unit: "week" };
        }
        applied.push({ change, applied: true, from, to: { kind: "duration", ...(next.deadline.duration ?? duration) } });
      } else if (date && shiftDate(date, change.delta, change.unit)) {
        next.deadline.date = shiftDate(date, change.delta, change.unit);
        applied.push({
          change,
          applied: true,
          from: { kind: "date", value: date },
          to: { kind: "date", value: next.deadline.date ?? date },
        });
      } else {
        applied.push({ change, applied: false, from: null, to: null });
      }
    } else {
      const text = change.text.trim();
      if (text && !next.hardConstraints.some((item) => item.trim().toLowerCase() === text.toLowerCase())) next.hardConstraints.push(text);
      applied.push({ change, applied: true, from: null, to: null });
    }
  }
  return { sheet: next, applied };
}

const number = (value: number) => new Intl.NumberFormat("en").format(value);

function valueText(value: ChangeValue | null): string {
  if (!value) return "";
  if (value.kind === "people") return `${number(value.value)} ${value.value === 1 ? "person" : "people"}`;
  if (value.kind === "money") return `${number(value.amount)} ${value.currency}${value.period ? ` per ${value.period}` : ""}`;
  if (value.kind === "duration") return `${number(value.amount)} ${value.unit}${value.amount === 1 ? "" : "s"}`;
  return value.value;
}

/** One change as a plain English sentence for the models, with the values it moved. */
export function changeFact(item: AppliedChange): string {
  const { change } = item;
  const moved = item.applied && item.from && item.to ? `: from ${valueText(item.from)} to ${valueText(item.to)}` : "";
  const missing = item.applied ? "" : " (the requirements give no value to apply it to)";
  if (change.kind === "team") {
    const count = Math.abs(change.delta);
    return `The team ${change.delta >= 0 ? "grows" : "shrinks"} by ${number(count)} ${count === 1 ? "person" : "people"}${moved}${missing}.`;
  }
  if (change.kind === "budget") {
    const what = change.target === "build" ? "The build budget" : "The running budget";
    return `${what} is ${number(Math.abs(change.percent))}% ${change.percent >= 0 ? "higher" : "lower"}${moved}${missing}.`;
  }
  if (change.kind === "deadline") {
    const count = Math.abs(change.delta);
    const unit = `${change.unit}${count === 1 ? "" : "s"}`;
    return `The deadline is ${number(count)} ${unit} ${change.delta >= 0 ? "later" : "earlier"}${moved}${missing}.`;
  }
  return `New hard constraint: ${change.text.trim()}.`;
}

/** The scenario as the facts the models read: each change, then the question in the person's words. */
export function scenarioFacts(
  applied: AppliedChange[],
  question: string | null,
): { question: string | null; answer: string; comment: string | null }[] {
  return [
    ...applied.map((item) => ({ question: null, answer: changeFact(item), comment: null })),
    ...(question?.trim() ? [{ question: "What if", answer: question.trim(), comment: null }] : []),
  ];
}

/** The scenarios of a session, oldest first. */
export function scenariosOf(session: Session): VerdictRevision[] {
  return session.revisions.filter(isScenario);
}

/** True when this revision is the scenario the session adopted. */
export const isAdopted = (session: Session, revision: Pick<VerdictRevision, "number">) => session.adopted === revision.number;

/**
 * Adopts a scenario as the decision, or goes back to the latest revision that is not one (null): the session's verdict
 * becomes that revision's, and the reader versions written for the other are dropped. Throws on a number that is not
 * one of its scenarios.
 */
export function adoptScenario(session: Session, number: number | null): void {
  if (number !== null) {
    const revision = session.revisions.find((item) => item.number === number);
    if (!revision || !isScenario(revision)) throw new RangeError(`Revision ${number} is not a scenario of this session.`);
  }
  if (session.adopted === number) return;
  session.adopted = number;
  const current = currentRevision(session);
  if (current) session.verdict = current.verdict;
  session.briefs = {};
}
