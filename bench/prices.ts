// Re-checks the reference cloud prices the proposers read (packages/core/reference/cloud-prices.json):
//   npm run prices:check            warns when the figures are older than 90 days
//   npm run prices:check -- --strict  fails instead, for a scheduled job
// The figures themselves are read again by hand, each from the source address the file gives for it.
import { isPriceReferenceStale, PRICE_MAX_AGE_DAYS, PRICE_REFERENCE, priceAgeDays, priceReferenceProblems } from "@quorumind/core";

const problems = priceReferenceProblems(PRICE_REFERENCE);
if (problems.length > 0) {
  console.error(`The price file is invalid:\n${problems.map((problem) => `- ${problem}`).join("\n")}`);
  process.exit(1);
}

const age = priceAgeDays();
const sources = new Set(PRICE_REFERENCE.items.map((item) => item.source)).size;
if (isPriceReferenceStale()) {
  console.warn(
    `Warning: the reference cloud prices are ${age} days old (as of ${PRICE_REFERENCE.asOf}), more than ${PRICE_MAX_AGE_DAYS}. ` +
      `Read each of the ${PRICE_REFERENCE.items.length} figures again from its source (${sources} addresses), then update "asOf".`,
  );
  if (process.argv.includes("--strict")) process.exit(1);
} else {
  console.log(
    `The reference cloud prices are ${age} days old (as of ${PRICE_REFERENCE.asOf}): ${PRICE_REFERENCE.items.length} figures from ${sources} sources.`,
  );
}
