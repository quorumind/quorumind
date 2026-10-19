/** @vitest-environment happy-dom */
import "./test/dom.ts";
import type { Session, VerdictRevision } from "@quorumind/core";
import { currentProposals } from "@quorumind/core/session";
import { render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { WhatChanged } from "./Revisions.tsx";
import { demoSession } from "./test/sessions.ts";

let complete: Session;
beforeAll(async () => {
  complete = { ...(await demoSession("complete")), id: "s1" };
});

/** The session with a second revision that keeps the verdict and changes what `extra` says. */
function revised(session: Session, extra: Partial<VerdictRevision>): Session {
  const first = session.revisions[0] as VerdictRevision;
  const second: VerdictRevision = {
    ...first,
    number: 2,
    reason: "edit",
    basedOn: 1,
    inputs: { facts: [], note: "The studios open in March", questionnaireId: null },
    costs: [],
    ...extra,
  };
  return { ...session, revisions: [first, second] };
}

describe("what changed", () => {
  it("lists a build time that a revision changed alone", () => {
    const before = currentProposals(complete).A?.buildWeeks;
    expect(before).toBeTruthy();
    render(<WhatChanged session={revised(complete, { schedules: [{ seat: "A", buildWeeks: { low: 30, high: 32 } }] })} number={2} />);
    const group = screen.getByRole("heading", { name: "Build times" }).closest(".change-group") as HTMLElement;
    const item = within(group).getByRole("listitem");
    expect(item.textContent).toContain(", build time: ");
    expect(item.textContent).toContain(`${before?.low} – ${before?.high} weeks → 30 – 32 weeks`);
    expect(screen.queryByText(/changed neither/)).toBeNull();
  });

  it("says nothing changed when the build times stay the same", () => {
    const before = currentProposals(complete).A?.buildWeeks as { low: number; high: number };
    render(<WhatChanged session={revised(complete, { schedules: [{ seat: "A", buildWeeks: { ...before } }] })} number={2} />);
    expect(screen.queryByRole("heading", { name: "Build times" })).toBeNull();
    expect(screen.getByText(/changed neither/)).toBeTruthy();
  });
});
