/** @vitest-environment happy-dom */
import "./test/dom.ts";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SessionView } from "./SessionView.tsx";
import { failure, json, stubApi, stubEventSource } from "./test/dom.ts";
import { demoSession } from "./test/sessions.ts";
import { detailsKey } from "./useSessionDetails.ts";

const details = (extra: Record<string, unknown> = {}) => ({
  busy: false,
  share: null,
  feedback: [],
  price: null,
  revisionPrice: null,
  providerCosts: true,
  ...extra,
});

describe("the details of a session", () => {
  it("are asked again when the session reaches a verdict, so the revision price shows at once", async () => {
    const review = await demoSession("review");
    const complete = await demoSession("complete");
    const price = { amount: 4, currency: "EUR", label: "One revision" };
    let asked = 0;
    stubApi({
      "GET /api/sessions/s1": () => {
        asked++;
        return json(details(asked === 1 ? {} : { revisionPrice: price }));
      },
      "GET /api/sessions/s1/questionnaires": () => json({ questionnaires: [] }),
      "GET /api/config": () => json({ typedNames: false }),
    });
    const source = stubEventSource();
    render(<SessionView id="s1" />);
    act(() => {
      source().open();
      source().send({ type: "session", session: { ...review, id: "s1" } });
    });
    await waitFor(() => expect(asked).toBe(1));
    act(() => source().send({ type: "session", session: { ...complete, id: "s1" } }));
    await waitFor(() => expect(asked).toBe(2));
    expect((await screen.findAllByText("€4")).length).toBeGreaterThan(0);
  });

  it("say so, and offer to try again, when they cannot be loaded: the owner is not silently read-only", async () => {
    const review = await demoSession("review");
    let fail = true;
    stubApi({
      "GET /api/sessions/s1": () => (fail ? failure(500, "internal_error") : json(details())),
    });
    const source = stubEventSource();
    render(<SessionView id="s1" />);
    act(() => {
      source().open();
      source().send({ type: "session", session: { ...review, id: "s1" } });
    });
    const notice = await screen.findByRole("alert");
    expect(notice.textContent).toContain("shown read-only for now");
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("button", { name: "Share" });
    expect(screen.queryByText(/shown read-only for now/)).toBeNull();
  });

  it("change with the phase, the verdict, the revisions and the adoption, not with every event", async () => {
    const complete = await demoSession("complete");
    const key = detailsKey(complete);
    expect(detailsKey({ ...complete, updatedAt: "2030-01-01T00:00:00.000Z" })).toBe(key);
    expect(detailsKey({ ...complete, revisions: [...complete.revisions, ...complete.revisions] })).not.toBe(key);
    expect(detailsKey({ ...complete, adopted: 2 })).not.toBe(key);
    expect(detailsKey({ ...complete, phase: "failed" })).not.toBe(key);
    expect(detailsKey(null)).toBeNull();
  });
});
