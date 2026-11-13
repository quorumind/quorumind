/** @vitest-environment happy-dom */
import "./test/dom.ts";
import { clientDeliverable, type Session } from "@quorumind/core";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { ClientReport } from "./ClientReport.tsx";
import { demoSession } from "./test/sessions.ts";

let complete: Session;
beforeAll(async () => {
  complete = await demoSession("complete");
});

const brief = {
  headline: "Online booking for your 12 studios by September",
  summary: "Members book, pay and get reminders.",
  sections: [],
  nextSteps: [],
};

describe("the client's report", () => {
  it("opens on the version written for the client, without the arbiter's own words", () => {
    const session = { ...complete, briefs: { client: brief } };
    const view = render(<ClientReport deliverable={clientDeliverable(session)} reportUrl="/report.md" />);
    expect(screen.getByText(brief.summary)).toBeTruthy();
    expect(view.container.textContent).not.toContain(complete.verdict?.recommendation.rationale);
    expect(view.container.textContent).not.toContain(complete.verdict?.speech);
  });

  it("gives the arbiter's rationale until that version is written", () => {
    const view = render(<ClientReport deliverable={clientDeliverable(complete)} reportUrl="/report.md" />);
    expect(view.container.textContent).toContain(complete.verdict?.recommendation.rationale);
    expect(view.container.textContent).not.toContain(complete.verdict?.speech);
  });
});
