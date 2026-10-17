import { describe, expect, it } from "vitest";
import { liveLineupFromEnv } from "./config.ts";
import { partialStringField } from "./partial-json.ts";
import { costOf, estimateDebateCost } from "./pricing.ts";
import { InterviewTurn, toStrictJsonSchema, Verdict } from "./schemas.ts";

describe("partialStringField", () => {
  it("returns null before the field starts", () => {
    expect(partialStringField('{"spe', "speech")).toBeNull();
  });
  it("reads an unfinished string, decoding escapes", () => {
    expect(partialStringField('{"speech": "Line one\\nsaid \\"hi\\" \\u00e9t', "speech")).toBe('Line one\nsaid "hi" ét');
  });
  it("stops at the closing quote", () => {
    expect(partialStringField('{"speech":"done","title":"x"}', "speech")).toBe("done");
  });
  it("does not emit half an escape sequence", () => {
    expect(partialStringField('{"speech":"a\\u00', "speech")).toBe("a");
  });
});

describe("toStrictJsonSchema", () => {
  function walk(node: unknown, visit: (object: Record<string, unknown>) => void) {
    if (Array.isArray(node)) {
      for (const child of node) walk(child, visit);
    } else if (node && typeof node === "object") {
      visit(node as Record<string, unknown>);
      for (const child of Object.values(node)) walk(child, visit);
    }
  }
  it.each([
    ["interview", InterviewTurn],
    ["verdict", Verdict],
  ])("closes every object and requires every property (%s)", (_name, schema) => {
    const json = toStrictJsonSchema(schema);
    expect(json.$schema).toBeUndefined();
    walk(json, (object) => {
      if (object.type === "object" && object.properties) {
        expect(object.additionalProperties).toBe(false);
        expect(object.required).toEqual(Object.keys(object.properties as object));
      }
    });
  });
});

describe("pricing", () => {
  it("prices known models per million tokens", () => {
    expect(costOf("claude-opus-5-5", { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(24);
  });
  it("returns null for an unknown model", () => {
    expect(costOf("unknown-model", { inputTokens: 10, outputTokens: 10 })).toBeNull();
  });
  it("estimates a debate as a range", () => {
    const estimate = estimateDebateCost({
      proposerModels: ["claude-opus-5-5", "claude-opus-5-5"],
      arbiterModel: "claude-opus-5-5",
      rounds: 1,
    });
    expect(estimate).not.toBeNull();
    expect(estimate!.low).toBeLessThan(estimate!.high);
  });
});

describe("liveLineupFromEnv", () => {
  it("returns null without any key", () => {
    expect(liveLineupFromEnv({})).toBeNull();
  });
  it("puts two vendors face to face when both keys are set", () => {
    const lineup = liveLineupFromEnv({ ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o", OPENAI_MODEL: "some-model" });
    expect(lineup?.seats.A).toEqual({ provider: "anthropic", model: "claude-opus-5-5" });
    expect(lineup?.seats.B).toEqual({ provider: "openai", model: "some-model" });
  });
  it("lets the environment override a seat", () => {
    const lineup = liveLineupFromEnv({ ANTHROPIC_API_KEY: "a", QUORUMIND_SEAT_B: "anthropic:claude-sonnet-5-5" });
    expect(lineup?.seats.B).toEqual({ provider: "anthropic", model: "claude-sonnet-5-5" });
  });
  it("rejects an unknown provider", () => {
    expect(() => liveLineupFromEnv({ ANTHROPIC_API_KEY: "a", QUORUMIND_ARBITER: "acme:x" })).toThrow(/Unknown provider/);
  });
});
