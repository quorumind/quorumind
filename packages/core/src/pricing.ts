import type { Usage } from "./providers/types.ts";

/** Prices in US dollars per million tokens. */
export interface ModelPrice {
  input: number;
  output: number;
}

const KNOWN_PRICES: Record<string, ModelPrice> = {
  "claude-fable-5-1": { input: 10, output: 50 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  mock: { input: 0, output: 0 },
};

const customPrices = new Map<string, ModelPrice>();

/** Registers the price of a model the table does not know, e.g. from configuration. */
export function setModelPrice(model: string, price: ModelPrice) {
  customPrices.set(model, price);
}

export function priceOf(model: string): ModelPrice | null {
  return customPrices.get(model) ?? KNOWN_PRICES[model] ?? null;
}

/** Cost in US dollars, or null when the model's price is unknown. */
export function costOf(model: string, usage: Usage): number | null {
  const price = priceOf(model);
  if (!price) return null;
  return priced(price, usage);
}

const priced = (price: ModelPrice, usage: Usage) => (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;

/**
 * The price a cost cap counts the calls of a model without a known price at (a model the table does not list, an
 * OpenAI or Gemini model without its price variables, an OpenRouter model when its list could not be read): that of
 * the dearest model the table lists, so a lineup without prices cannot run past its cap unseen.
 */
export const CAP_FALLBACK_PRICE: ModelPrice = { input: 10, output: 50 };

/** What a call counts for under a cost cap: its known price, or CAP_FALLBACK_PRICE when the model's is unknown. */
export function cappedCostOf(model: string, usage: Usage): number {
  return costOf(model, usage) ?? priced(CAP_FALLBACK_PRICE, usage);
}

// Rough token profile of one call per task, measured on demo sessions. Used to show an estimate before a debate
// starts, and to keep the verdict within the cost cap; the real cost is tracked call by call.
export const TASK_PROFILE = {
  // One call of the researcher: the plan of its searches, or what they found.
  research: { input: 4_000, output: 1_500 },
  proposal: { input: 3_000, output: 2_500 },
  critique: { input: 7_000, output: 2_000 },
  revision: { input: 9_000, output: 3_000 },
  probe: { input: 9_000, output: 1_500 },
  verdict: { input: 14_000, output: 4_000 },
  // A verdict revision: the arbiter reads the verdict and the new facts again, not the transcript.
  reassess: { input: 10_000, output: 4_000 },
} as const;

/** The typical cost of one call of a debate task, or null when the model's price is unknown. */
export function typicalCallCost(model: string, task: keyof typeof TASK_PROFILE): number | null {
  const profile = TASK_PROFILE[task];
  return costOf(model, { inputTokens: profile.input, outputTokens: profile.output });
}

/** The typical cost of one call as a cost cap counts it: at CAP_FALLBACK_PRICE when the model's price is unknown. */
export function typicalCappedCost(model: string, task: keyof typeof TASK_PROFILE): number {
  const profile = TASK_PROFILE[task];
  return cappedCostOf(model, { inputTokens: profile.input, outputTokens: profile.output });
}

export interface DebatePlan {
  proposerModels: string[];
  /** Participants that only criticise: the devil's advocate, or every seat in challenge mode. */
  criticModels?: string[];
  /**
   * Participants that propose once and are never revised: the alternative of an audit, and the interviewer that
   * restates the solution (challenge) or reads the document (audit).
   */
  draftModels?: string[];
  arbiterModel: string;
  rounds: number;
}

/**
 * Estimated cost of a debate in US dollars, or null if a model's price is unknown: its typical cost, at the token
 * profile of each task, and a range around it.
 */
export function estimateDebateCost(plan: DebatePlan): { low: number; typical: number; high: number } | null {
  const total = debateTotal(plan, costOf);
  return total === null ? null : { low: total * 0.6, typical: total, high: total * 1.8 };
}

/**
 * The typical cost of a debate as a cost cap counts it: a model without a known price at CAP_FALLBACK_PRICE, so a
 * lineup with one unpriced model is still weighed against the cap.
 */
export function cappedDebateCost(plan: DebatePlan): number {
  return debateTotal(plan, cappedCostOf) ?? 0;
}

/** The typical cost of a debate's calls, each priced by `cost`; null as soon as one of them has no price. */
function debateTotal(plan: DebatePlan, cost: (model: string, usage: Usage) => number | null): number | null {
  const call = (model: string, task: "proposal" | "critique" | "revision" | "verdict") =>
    cost(model, { inputTokens: TASK_PROFILE[task].input, outputTokens: TASK_PROFILE[task].output });
  let total = 0;
  for (const model of plan.proposerModels) {
    const proposal = call(model, "proposal");
    const critique = call(model, "critique");
    const revision = call(model, "revision");
    if (proposal === null || critique === null || revision === null) return null;
    total += proposal + plan.rounds * (critique + revision);
  }
  for (const model of plan.draftModels ?? []) {
    const proposal = call(model, "proposal");
    if (proposal === null) return null;
    total += proposal;
  }
  for (const model of plan.criticModels ?? []) {
    const critique = call(model, "critique");
    if (critique === null) return null;
    total += plan.rounds * critique;
  }
  const verdict = call(plan.arbiterModel, "verdict");
  if (verdict === null) return null;
  return total + verdict;
}

/**
 * Estimated cost of a verdict revision in US dollars: the arbiter's new ruling and, at most, one short critique of the
 * options. Null if a model's price is unknown.
 */
export function estimateRevisionCost(plan: { arbiterModel: string; criticModel: string | null }): { low: number; high: number } | null {
  const ruling = typicalCallCost(plan.arbiterModel, "reassess");
  const critique = plan.criticModel ? typicalCallCost(plan.criticModel, "critique") : 0;
  if (ruling === null || critique === null) return null;
  return { low: ruling * 0.6, high: (ruling + critique) * 1.8 };
}
