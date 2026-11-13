/** @vitest-environment happy-dom */
import "./test/dom.ts";
import type { Session, UsageRecord } from "@quorumind/core";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { Costs } from "./Costs.tsx";
import { demoSession } from "./test/sessions.ts";

let complete: Session;
beforeAll(async () => {
  complete = await demoSession("complete");
});

/** A call of proposer A, told apart by its model's name. */
const call = (model: string, extra: Partial<UsageRecord> = {}): UsageRecord => ({
  id: model,
  task: "proposal",
  seat: "A",
  model,
  inputTokens: 1000,
  outputTokens: 500,
  costUsd: 0.01,
  ...extra,
});

const rowOf = (model: string) => screen.getByText(model).closest("tr") as HTMLElement;

describe("the costs of a session", () => {
  it("marks a call billed although it failed, and one whose tokens are an estimate, and says what each means", () => {
    const usage = [
      call("model-ok"),
      call("model-failed", { failed: true }),
      call("model-estimated", { estimated: true }),
      call("model-both", { failed: true, estimated: true }),
    ];
    render(<Costs session={{ ...complete, usage }} />);
    expect(within(rowOf("model-ok")).queryByText("failed")).toBeNull();
    expect(within(rowOf("model-ok")).queryByText("estimated")).toBeNull();
    expect(within(rowOf("model-failed")).getByText("failed").getAttribute("title")).toMatch(/provider bills it/);
    expect(within(rowOf("model-failed")).queryByText("estimated")).toBeNull();
    expect(within(rowOf("model-estimated")).getByText("estimated").getAttribute("title")).toMatch(/estimated from the text sent/);
    expect(within(rowOf("model-both")).getByText("failed")).toBeTruthy();
    expect(within(rowOf("model-both")).getByText("estimated")).toBeTruthy();
    // Under the table, for a reader without a pointer to hover the labels.
    expect(screen.getByText(/^Failed: /).tagName).toBe("P");
    expect(screen.getByText(/^Estimated: /).tagName).toBe("P");
  });

  it("explains nothing when every call answered and reported its usage", () => {
    render(<Costs session={{ ...complete, usage: [call("model-ok")] }} />);
    expect(screen.queryByText(/^Failed: /)).toBeNull();
    expect(screen.queryByText(/^Estimated: /)).toBeNull();
  });

  it("groups the calls by step with the step's total, and folds them under a button", () => {
    const usage = [
      call("m-one", { inputTokens: 1000 }),
      call("m-two", { inputTokens: 2000 }),
      call("m-solo", { task: "verdict", seat: null }),
    ];
    render(<Costs session={{ ...complete, usage }} />);
    const toggle = screen.getByRole("button", { name: "Show the calls of “Proposal”" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // The step's row carries the sum of its calls; they are hidden until asked for.
    expect(within(toggle.closest("tr") as HTMLElement).getByText("3,000")).toBeTruthy();
    expect((rowOf("m-one") as HTMLElement).hidden).toBe(true);
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Hide the calls of “Proposal”" }).getAttribute("aria-expanded")).toBe("true");
    expect(rowOf("m-one").hidden).toBe(false);
    // A step of a single call is only that call, with no button of its own.
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(rowOf("m-solo").hidden).toBe(false);
  });

  it("says a step's subtotal is partial when some of its calls have no known price", () => {
    const usage = [
      call("m-known", { costUsd: 0.02 }),
      call("m-unknown", { costUsd: null }),
      call("m-solo", { task: "verdict", seat: null }),
    ];
    render(<Costs session={{ ...complete, usage }} />);
    const step = screen.getByRole("button", { name: /Show the calls of/ }).closest("tr") as HTMLElement;
    expect(within(step).getByText("Partial").getAttribute("title")).toMatch(/only the known ones are added/);
    // The step with a single call, and the call itself, carry no mark.
    expect(within(rowOf("m-solo")).queryByText("Partial")).toBeNull();
  });

  it('lists the web searches under one step, "Web research"', () => {
    const usage = [call("m-research", { task: "research", seat: null }), call("m-search", { task: "search", seat: null })];
    render(<Costs session={{ ...complete, usage }} />);
    expect(screen.getByRole("button", { name: "Show the calls of “Web research”" })).toBeTruthy();
    expect(screen.queryByText("Web search")).toBeNull();
  });
});
