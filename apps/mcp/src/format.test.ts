import { describe, expect, it } from "vitest";
import { mismatchedLines, pricedWith } from "./format.ts";

describe("counted sentences of the summaries", () => {
  it("say one day rate and one line in the singular", () => {
    expect(pricedWith(1, "EUR")).toBe("priced with 1 day rate in EUR");
    expect(pricedWith(4, "EUR")).toBe("priced with 4 day rates in EUR");
    expect(mismatchedLines(1)).toBe("1 line does not match its days and day rate");
    expect(mismatchedLines(3)).toBe("3 lines do not match their days and day rate");
  });
});
