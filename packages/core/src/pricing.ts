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

// Rough token profile of one call per task, measured on demo sessions. Used only to show
// an estimate before a debate starts; the real cost is tracked call by call.
const TASK_PROFILE = {
  proposal: { input: 3_000, output: 2_500 },
  critique: { input: 7_000, output: 2_000 },
  revision: { input: 9_000, output: 3_000 },
  verdict: { input: 14_000, output: 4_000 },
} as const;

export interface DebatePlan {
  proposerModels: string[];
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
  const verdict = costOf(plan.arbiterModel, { inputTokens: TASK_PROFILE.verdict.input, outputTokens: TASK_PROFILE.verdict.output });
  if (verdict === null) return null;
  total += verdict;
  return { low: total * 0.6, high: total * 1.8 };
}
