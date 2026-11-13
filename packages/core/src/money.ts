/**
 * House style for euros: the sign comes after the amount in every language, English included ("1,234.50 €").
 * Other currencies keep the placement of the language ("$1,234.50"), and so does a euro that already comes after.
 * `formatter` must be built with `style: "currency"` for `currency`.
 */
export function formatCurrency(formatter: Intl.NumberFormat, amount: number, currency: string): string {
  const text = formatter.format(amount);
  if (currency.toUpperCase() !== "EUR") return text;
  const parts = formatter.formatToParts(amount);
  const at = parts.findIndex((part) => part.type === "currency");
  const firstNumber = parts.findIndex((part) => ["integer", "group", "decimal", "fraction"].includes(part.type));
  if (at < 0 || firstNumber < 0 || at > firstNumber) return text;
  const sign = parts[at]!.value;
  // Keep the minus or plus sign and any bidi mark; drop the currency and the white space next to it.
  const rest = parts
    .filter((_, index) => index !== at)
    .map((part) => (part.type === "literal" ? part.value.replace(/\s+/g, "") : part.value))
    .join("");
  return `${rest} ${sign}`;
}
