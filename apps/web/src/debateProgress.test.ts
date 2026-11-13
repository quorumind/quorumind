/** @vitest-environment happy-dom */
import "./test/dom.ts";
import type { Session } from "@quorumind/core";
import { beforeAll, describe, expect, it } from "vitest";
import { debateStep, debateWriters, roundOf } from "./debateProgress.ts";
import i18n from "./i18n.ts";
import { demoSession } from "./test/sessions.ts";

const t = i18n.t.bind(i18n);
let complete: Session;
beforeAll(async () => {
  complete = await demoSession("complete");
});

/** The debate as it stood after its entries up to `kind`, running. */
const runningAfter = (count: number): Session => ({
  ...complete,
  phase: "debating",
  debate: complete.debate.slice(0, count),
  verdict: null,
});

describe("where a running debate stands", () => {
  it("names the step at work, its round out of the debate's, from what the roles write", () => {
    const session = runningAfter(2);
    expect(debateStep(session, { "critique:A": { task: "critique", seat: "A", text: "" } }, t)).toMatchObject({
      key: "critique:1",
      label: "Round 1 of 1: critiques",
    });
    // The furthest step wins when two overlap.
    expect(
      debateStep(
        session,
        { "proposal:B": { task: "proposal", seat: "B", text: "" }, "critique:A": { task: "critique", seat: "A", text: "" } },
        t,
      )?.key,
    ).toBe("critique:1");
  });

  it("keeps the step it last recorded between two calls, and is silent outside a running debate", () => {
    const answered = complete.debate.findIndex((entry) => entry.kind === "answers") + 1;
    expect(debateStep(runningAfter(answered), {}, t)?.label).toBe("Round 1 of 1: revisions");
    expect(debateStep(runningAfter(0), {}, t)?.label).toBe(complete.research ? "Web research" : "Blind proposals");
    expect(debateStep(complete, {}, t)).toBeNull();
  });

  it("never falls behind what the debate recorded: a role that just finished, nobody writing after a reconnection", () => {
    const revised = complete.debate.findIndex((entry) => entry.kind === "revision") + 1;
    // A late proposal call (a retry) does not take a debate already in its revisions back to the proposals.
    const late = debateStep(runningAfter(revised), { "proposal:A": { task: "proposal", seat: "A", text: "" } }, t);
    expect(late?.label).toBe("Round 1 of 1: revisions");
    const steps = ["research", "proposal", "critique", "revision", "verdict"] as const;
    const orders = steps.map(
      (task) => debateStep(runningAfter(0), { [`${task}:A`]: { task, seat: task === "verdict" ? null : "A", text: "" } }, t)?.order ?? -1,
    );
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
  });

  it("never counts a round past the debate's last one", () => {
    expect(roundOf(complete, "critique", "A")).toBe(1);
  });

  it("lists who writes in the debate, once each, in the person's language", () => {
    const live = {
      "critique:A": { task: "critique", seat: "A", text: "" },
      "critique:devil": { task: "critique", seat: "devil", text: "" },
      "brief:-": { task: "brief", seat: null, text: "" },
    } as const;
    expect(debateWriters(complete, live, t, "en")).toBe("Debater A and Devil's advocate");
    expect(debateWriters(complete, {}, t, "en")).toBe("");
  });
});
