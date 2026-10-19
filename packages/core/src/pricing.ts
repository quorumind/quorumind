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
  return (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
}

// Rough token profile of one call per task, measured on demo sessions. Used to show an estimate before a debate
// starts, and to keep the verdict within the cost cap; the real cost is tracked call by call.
export const TASK_PROFILE = {
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

export interface DebatePlan {
  proposerModels: string[];
  /** Participants that only criticise: the devil's advocate, or every seat in challenge mode. */
  criticModels?: string[];
  /** Participants that propose once and are never revised: the alternative of an audit. */
  draftModels?: string[];
  arbiterModel: string;
  rounds: number;
}

/** Estimated cost range of a debate in US dollars, or null if a model's price is unknown. */
export function estimateDebateCost(plan: DebatePlan): { low: number; high: number } | null {
  let total = 0;
  for (const model of plan.proposerModels) {
    const proposal = costOf(model, { inputTokens: TASK_PROFILE.proposal.input, outputTokens: TASK_PROFILE.proposal.output });
    const critique = costOf(model, { inputTokens: TASK_PROFILE.critique.input, outputTokens: TASK_PROFILE.critique.output });
    const revision = costOf(model, { inputTokens: TASK_PROFILE.revision.input, outputTokens: TASK_PROFILE.revision.output });
    if (proposal === null || critique === null || revision === null) return null;
    total += proposal + plan.rounds * (critique + revision);
  }
  for (const model of plan.draftModels ?? []) {
    const proposal = costOf(model, { inputTokens: TASK_PROFILE.proposal.input, outputTokens: TASK_PROFILE.proposal.output });
    if (proposal === null) return null;
    total += proposal;
  }
  for (const model of plan.criticModels ?? []) {
    const critique = costOf(model, { inputTokens: TASK_PROFILE.critique.input, outputTokens: TASK_PROFILE.critique.output });
    if (critique === null) return null;
    total += plan.rounds * critique;
  }
  const verdict = costOf(plan.arbiterModel, { inputTokens: TASK_PROFILE.verdict.input, outputTokens: TASK_PROFILE.verdict.output });
  if (verdict === null) return null;
  total += verdict;
  return { low: total * 0.6, high: total * 1.8 };
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
