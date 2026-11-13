/** @vitest-environment happy-dom */
import "./test/dom.ts";
import type { Session } from "@quorumind/core";
import { render } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { AccessContext, FULL_ACCESS } from "./access.tsx";
import { Debate } from "./Debate.tsx";
import { stubApi } from "./test/dom.ts";
import { demoSession } from "./test/sessions.ts";

let complete: Session;
beforeAll(async () => {
  complete = { ...(await demoSession("complete")), id: "t1" };
});

const show = (session: Session) => (
  <AccessContext.Provider value={FULL_ACCESS}>
    <Debate session={session} live={{}} />
  </AccessContext.Provider>
);

describe("the transcript's entrances", () => {
  it("settles what the tab already held, and lets an entry added afterwards arrive", () => {
    stubApi({});
    const view = render(show({ ...complete, debate: complete.debate.slice(0, 3) }));
    const children = () => Array.from(document.querySelectorAll(".transcript > *"));
    const held = children().filter((child) => !child.classList.contains("transcript-end"));
    expect(held.length).toBeGreaterThan(0);
    expect(held.every((child) => child.getAttribute("data-settled") === "true")).toBe(true);

    view.rerender(show(complete));
    const added = children().filter((child) => !held.includes(child) && !child.classList.contains("transcript-end"));
    expect(added.length).toBeGreaterThan(0);
    expect(added.some((child) => child.hasAttribute("data-settled"))).toBe(false);
  });

  it("settles everything again when the tab is shown again", () => {
    stubApi({});
    render(show(complete)).unmount();
    render(show(complete));
    const all = Array.from(document.querySelectorAll(".transcript > :not(.transcript-end)"));
    expect(all.every((child) => child.getAttribute("data-settled") === "true")).toBe(true);
  });
});
