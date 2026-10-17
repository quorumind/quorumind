import type { Feasibility, Verdict } from "./schemas.ts";

export interface RankedOption {
  seat: string;
  title: string;
  feasibility: Feasibility;
  /** Weighted average of the scores, from 1 to 5; null when no weighted criterion is scored. */
  score: number | null;
}

const ORDER: Record<Feasibility, number> = { feasible: 0, conditional: 1, infeasible: 2 };

/**
 * Ranks the options of a verdict with the weights the person chooses. An infeasible option
 * stays last whatever its scores: violating a hard constraint is not something weights can buy back.
 */
export function rankOptions(verdict: Verdict, weights: Record<string, number>): RankedOption[] {
  return verdict.options
    .map((option) => {
      let total = 0;
      let weightSum = 0;
      for (const { criterion, score } of option.scores) {
        const weight = weights[criterion] ?? 0;
        total += weight * score;
        weightSum += weight;
      }
      return {
        seat: option.seat,
        title: option.title,
        feasibility: option.feasibility,
        score: weightSum > 0 ? total / weightSum : null,
      };
    })
    .sort((a, b) => ORDER[a.feasibility] - ORDER[b.feasibility] || (b.score ?? 0) - (a.score ?? 0) || a.seat.localeCompare(b.seat));
}
