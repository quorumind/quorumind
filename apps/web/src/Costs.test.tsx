/** @vitest-environment happy-dom */
import "./test/dom.ts";
import type { Session, UsageRecord } from "@quorumind/core";
import { render, screen, within } from "@testing-library/react";
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
});
