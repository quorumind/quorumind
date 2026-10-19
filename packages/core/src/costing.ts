// What each option costs to build, and whether it fits the budget and the deadline. Everything here is arithmetic
// done by the code: the models estimate person-days per work package and role, never the money. Browser-safe.

import { currencyCode, hasProfile, localeCurrency, type OrgProfile, roleId } from "./profile.ts";
import type { Proposal, RequirementsSheet } from "./schemas.ts";
import { currentProposals, type Session } from "./session.ts";

export interface Range {
  low: number;
  high: number;
}

/** One role's effort in a work package, priced with its daily rate (null when the rate card has no such role). */
export interface CostLine {
  role: string;
  /** The rate card's name for the role; null for a generic role, which the interfaces name. */
  name: string | null;
  days: Range;
  dailyRate: number | null;
  cost: Range | null;
}

export interface CostedPackage {
  name: string;
  description: string;
  lines: CostLine[];
  days: Range;
  /** The priced lines only. */
  cost: Range;
}

export interface Costing {
  currency: string;
  /**
   * profile: the organisation's day rates. estimated: no profile, the proposer's own rates. legacy: a proposal made
   * before work packages, with the total the model gave.
   */
  rates: "profile" | "estimated" | "legacy";
  packages: CostedPackage[];
  days: Range;
  total: Range;
  /** Roles some effort was given for but no rate is known: their days are counted, not their cost. */
  unpriced: string[];
  assumptions: string[];
  exclusions: string[];
}

/** The profile the debate follows: the snapshot taken when it started, unless the person set it aside. */
export function sessionProfile(session: Pick<Session, "profile" | "ignoreProfile">): OrgProfile | null {
  return !session.ignoreProfile && hasProfile(session.profile) ? session.profile : null;
}

/**
 * The one currency of every amount of a debate: the profile's, else the build or running budget's, else the
 * language's. Fixed when the requirements sheet is confirmed (Session.currency).
 */
export function debateCurrency(session: Pick<Session, "currency" | "profile" | "ignoreProfile" | "sheet" | "locale">): string {
  if (session.currency) return session.currency;
  const budget = session.sheet?.budget;
  return (
    currencyCode(sessionProfile(session)?.currency) ??
    currencyCode(budget?.build?.currency) ??
    currencyCode(budget?.run?.currency) ??
    localeCurrency(session.locale)
  );
}

/** Person-days are kept to the half day; a negative estimate counts as none. */
export const roundDays = (days: number): number => (Number.isFinite(days) ? Math.max(0, Math.round(days * 2) / 2) : 0);
/** Amounts are kept to the unit of the currency. */
export const roundMoney = (amount: number): number => Math.round(amount);

const ordered = (low: number, high: number): Range => (low <= high ? { low, high } : { low: high, high: low });
const add = (a: Range, b: Range): Range => ({ low: a.low + b.low, high: a.high + b.high });
const ZERO: Range = { low: 0, high: 0 };

/**
 * Prices a proposal's work packages: each line is its days times the role's daily rate, rounded to the unit; the
 * package and the total are the sums of the rounded lines, so the tables add up. With a profile, its rates apply
 * whatever the model wrote; without one, the proposer's own estimates do. Null for a proposal with no cost at all.
 */
export function proposalCosting(session: Session, proposal: Proposal): Costing | null {
  const currency = debateCurrency(session);
  const estimate = proposal.estimate;
  if (!estimate || estimate.workPackages.length === 0) {
    const legacy = proposal.buildCost;
    if (!legacy) return null;
    return {
      currency: currencyCode(legacy.currency) ?? currency,
      rates: "legacy",
      packages: [],
      days: ZERO,
      total: ordered(roundMoney(legacy.low), roundMoney(legacy.high)),
      unpriced: [],
      assumptions: [legacy.basis].filter(Boolean),
      exclusions: [],
    };
  }
  const profile = sessionProfile(session);
  const rateOf = profile ? profileRates(profile) : estimatedRates(estimate.dayRates);
  const unpriced = new Set<string>();
  const packages = estimate.workPackages.map((workPackage): CostedPackage => {
    const lines = workPackage.effort.map((effort): CostLine => {
      const days = ordered(roundDays(effort.low), roundDays(effort.high));
      const rate = rateOf(effort.role);
      if (!rate) unpriced.add(effort.role);
      return {
        role: rate?.id ?? effort.role,
        name: rate?.name ?? null,
        days,
        dailyRate: rate?.dailyRate ?? null,
        cost: rate ? { low: roundMoney(days.low * rate.dailyRate), high: roundMoney(days.high * rate.dailyRate) } : null,
      };
    });
    return {
      name: workPackage.name,
      description: workPackage.description,
      lines,
      days: lines.reduce((sum, line) => add(sum, line.days), ZERO),
      cost: lines.reduce((sum, line) => (line.cost ? add(sum, line.cost) : sum), ZERO),
    };
  });
  return {
    currency,
    rates: profile ? "profile" : "estimated",
    packages,
    days: packages.reduce((sum, item) => add(sum, item.days), ZERO),
    total: packages.reduce((sum, item) => add(sum, item.cost), ZERO),
    unpriced: [...unpriced],
    assumptions: estimate.assumptions,
    exclusions: estimate.exclusions,
  };
}

type Rate = { id: string; name: string | null; dailyRate: number };

/** A role of the rate card by id, else by name: models sometimes cite the name. */
function profileRates(profile: OrgProfile): (role: string) => Rate | null {
  return (role) => {
    const wanted = roleId(role);
    const found =
      profile.roles.find((item) => item.id === role) ?? profile.roles.find((item) => item.id === wanted || roleId(item.name) === wanted);
    return found && found.dailyRate > 0 ? { id: found.id, name: found.name, dailyRate: found.dailyRate } : null;
  };
}

function estimatedRates(dayRates: { role: string; dailyRate: number }[]): (role: string) => Rate | null {
  return (role) => {
    const found = dayRates.find((item) => item.role === role) ?? dayRates.find((item) => roleId(item.role) === roleId(role));
    return found && Number.isFinite(found.dailyRate) && found.dailyRate > 0 ? { id: role, name: null, dailyRate: found.dailyRate } : null;
  };
}

/** The costing of every current option, by seat. */
export function sessionCostings(session: Session): Record<string, Costing> {
  const costings: Record<string, Costing> = {};
  for (const [seat, proposal] of Object.entries(currentProposals(session))) {
    const costing = proposalCosting(session, proposal);
    if (costing) costings[seat] = costing;
  }
  return costings;
}

/** Build cost plus three years of running cost, or null without a build cost. */
export function threeYearCost(session: Session, proposal: Proposal): (Range & { currency: string }) | null {
  const costing = proposalCosting(session, proposal);
  if (!costing) return null;
  // A proposal made before the single currency may give its running cost in another one.
  const legacyCurrency = (proposal.monthlyCost as { currency?: string }).currency;
  if (legacyCurrency && currencyCode(legacyCurrency) !== costing.currency) return null;
  return {
    low: costing.total.low + 36 * proposal.monthlyCost.low,
    high: costing.total.high + 36 * proposal.monthlyCost.high,
    currency: costing.currency,
  };
}

/** within: the whole range fits. at_risk: the low estimate fits, the high one does not. over: even the low one does not. */
export type CheckStatus = "within" | "at_risk" | "over";

export interface MoneyCheck {
  status: CheckStatus;
  /** The budget, per month for the running cost. */
  budget: number;
  currency: string;
  /** By how much the high (at_risk) or the low (over) estimate exceeds it; 0 when within. */
  by: number;
}

export interface TimeCheck {
  status: CheckStatus;
  /** Weeks between the start and the deadline. */
  availableWeeks: number;
  /** Weeks late, rounded up; 0 when within. */
  by: number;
}

export interface OptionChecks {
  build: MoneyCheck | null;
  run: MoneyCheck | null;
  time: TimeCheck | null;
}

const WEEKS_PER_MONTH = 52 / 12;
const DAY_MS = 86_400_000;

/**
 * The weeks the deadline leaves: a duration as given, a date counted from when the sheet was confirmed (or the
 * session started). Null when the sheet sets no deadline.
 */
export function availableWeeks(sheet: RequirementsSheet, from: string): number | null {
  const { duration, date } = sheet.deadline;
  if (duration && duration.amount > 0) return duration.unit === "week" ? duration.amount : duration.amount * WEEKS_PER_MONTH;
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const days = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / DAY_MS;
    return Number.isFinite(days) ? Math.max(0, days / 7) : null;
  }
  return null;
}

/**
 * A cost range against a budget, compared unrounded (a yearly budget gives a monthly one with decimals); the budget and
 * the gap are rounded for display only, and a gap that rounds to nothing is within.
 */
function moneyCheck(range: Range, budget: number, currency: string): MoneyCheck {
  const shown = roundMoney(budget);
  const over = roundMoney(range.low - budget);
  const atRisk = roundMoney(range.high - budget);
  if (range.low > budget && over > 0) return { status: "over", budget: shown, currency, by: over };
  if (range.high > budget && atRisk > 0) return { status: "at_risk", budget: shown, currency, by: atRisk };
  return { status: "within", budget: shown, currency, by: 0 };
}

const sameCurrency = (a: string | null | undefined, b: string) => currencyCode(a) === b;

/**
 * Each option against the budget and the deadline of the sheet, when both sides are known and in the same currency:
 * the build cost against the build budget, the monthly cost against the running budget, the build time against the
 * deadline. These are facts, shown as badges and given to the arbiter.
 */
export function deliveryChecks(session: Session): Record<string, OptionChecks> {
  const sheet = session.sheet;
  const checks: Record<string, OptionChecks> = {};
  if (!sheet?.budget || !sheet.deadline) return checks;
  const currency = debateCurrency(session);
  const weeks = availableWeeks(sheet, session.sheetConfirmedAt ?? session.createdAt);
  const run = sheet.budget.run;
  const monthlyBudget = run && sameCurrency(run.currency, currency) ? (run.period === "year" ? run.amount / 12 : run.amount) : null;
  for (const [seat, proposal] of Object.entries(currentProposals(session))) {
    const costing = proposalCosting(session, proposal);
    const build = sheet.budget.build;
    const legacyCurrency = (proposal.monthlyCost as { currency?: string }).currency;
    checks[seat] = {
      build:
        costing && build && build.amount > 0 && sameCurrency(build.currency, costing.currency)
          ? moneyCheck(costing.total, build.amount, costing.currency)
          : null,
      run:
        monthlyBudget !== null && monthlyBudget > 0 && (!legacyCurrency || sameCurrency(legacyCurrency, currency))
          ? moneyCheck(ordered(proposal.monthlyCost.low, proposal.monthlyCost.high), monthlyBudget, currency)
          : null,
      time: weeks !== null && proposal.buildWeeks ? timeCheck(ordered(proposal.buildWeeks.low, proposal.buildWeeks.high), weeks) : null,
    };
  }
  return checks;
}

function timeCheck(range: Range, available: number): TimeCheck {
  const rounded = Math.round(available * 10) / 10;
  if (range.low > available) return { status: "over", availableWeeks: rounded, by: Math.ceil(range.low - available) };
  if (range.high > available) return { status: "at_risk", availableWeeks: rounded, by: Math.ceil(range.high - available) };
  return { status: "within", availableWeeks: rounded, by: 0 };
}

const amount = (value: number, currency: string) => `${new Intl.NumberFormat("en").format(value)} ${currency}`;

/** The checks as plain English sentences for the arbiter, one per computable check. Empty when none is. */
export function checkFacts(session: Session): string[] {
  const facts: string[] = [];
  const costings = sessionCostings(session);
  for (const [seat, checks] of Object.entries(deliveryChecks(session))) {
    const costing = costings[seat];
    if (checks.build && costing) {
      const { status, budget, currency, by } = checks.build;
      const cost = `${amount(costing.total.low, currency)} to ${amount(costing.total.high, currency)}`;
      facts.push(
        `Option ${seat}: build cost ${cost} (computed from its work packages) against a build budget of ${amount(budget, currency)}: ${
          status === "over"
            ? `over budget by at least ${amount(by, currency)}`
            : status === "at_risk"
              ? `may exceed it by up to ${amount(by, currency)}`
              : "within budget"
        }.`,
      );
    }
    if (checks.run) {
      const { status, budget, currency, by } = checks.run;
      facts.push(
        `Option ${seat}: running cost against a running budget of ${amount(budget, currency)} per month: ${
          status === "over"
            ? `over by at least ${amount(by, currency)} per month`
            : status === "at_risk"
              ? `may exceed it by up to ${amount(by, currency)} per month`
              : "within budget"
        }.`,
      );
    }
    if (checks.time) {
      const { status, availableWeeks: weeks, by } = checks.time;
      facts.push(
        `Option ${seat}: build time against ${weeks} weeks to the deadline: ${
          status === "over" ? `late by at least ${by} week(s)` : status === "at_risk" ? `may be late by up to ${by} week(s)` : "on time"
        }.`,
      );
    }
  }
  return facts;
}
