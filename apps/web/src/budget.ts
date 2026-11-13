import { MAX_BUDGET_USD } from "./api.ts";
import { formatUsd } from "./format.ts";

/** The lowest cost cap the interface offers: a debate costs more than this, so a lower cap would only stop it. */
export const MIN_BUDGET_USD = 0.5;

/**
 * What a cost cap field holds: an empty field means no cap of the person's own; anything else is an amount within
 * the limits, or invalid. An invalid entry is never turned into "no cap": the person is told instead.
 */
export function capOf(text: string, badInput = false): { amount: number | null; invalid: boolean } {
  // A number field holds "" for text it cannot read ("1e", "-"): the browser says so, and that is not an empty field.
  if (badInput) return { amount: null, invalid: true };
  if (text.trim() === "") return { amount: null, invalid: false };
  const amount = Number(text.replace(",", "."));
  if (!Number.isFinite(amount) || amount < MIN_BUDGET_USD || amount > MAX_BUDGET_USD) return { amount: null, invalid: true };
  return { amount, invalid: false };
}

/** The limits as the "common.budgetRange" message gives them: "$0.50" and "$1,000". */
export function capRange(language: string) {
  const max = new Intl.NumberFormat(language, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(MAX_BUDGET_USD);
  const min = formatUsd(MIN_BUDGET_USD, language);
  // Isolated, so that an amount in a right-to-left sentence keeps its own order.
  return language.startsWith("ar") ? { min: `\u2068${min}\u2069`, max: `\u2068${max}\u2069` } : { min, max };
}
