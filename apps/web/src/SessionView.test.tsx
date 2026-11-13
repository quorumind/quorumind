/** @vitest-environment happy-dom */
import "./test/dom.ts";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SessionSkeleton, SessionView, TabPanel } from "./SessionView.tsx";
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
    expect((await screen.findAllByText("4 €")).length).toBeGreaterThan(0);
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

describe("raising the cost cap of a stopped debate", () => {
  async function stopped() {
    const review = await demoSession("review");
    const failed = {
      ...review,
      id: "s1",
      phase: "failed",
      error: { code: "budget_exceeded", message: "cap", params: { spentUsd: 3, budgetUsd: 3 } },
    };
    const { calls } = stubApi({
      "GET /api/sessions/s1": () => json(details()),
      "GET /api/sessions/s1/questionnaires": () => json({ questionnaires: [] }),
      "GET /api/config": () => json({ typedNames: false }),
      "POST /api/sessions/s1/resume": () => json({}),
    });
    const source = stubEventSource();
    render(<SessionView id="s1" />);
    act(() => {
      source().open();
      source().send({ type: "session", session: failed });
    });
    return { calls, field: (await screen.findByLabelText("New cost cap (optional)")) as HTMLInputElement };
  }

  it.each(["-2", "0", "5000"])("does not resume with the old cap when %s is typed", async (value) => {
    const { calls, field } = await stopped();
    fireEvent.change(field, { target: { value } });
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Enter an amount between $0.50 and $1,000.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry from where it stopped" }));
    expect(calls.some((call) => call.path.endsWith("/resume"))).toBe(false);
  });

  it("resumes with the new cap, or with none when the field is empty", async () => {
    const { calls, field } = await stopped();
    fireEvent.change(field, { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Retry from where it stopped" }));
    await waitFor(() => expect(calls.find((call) => call.path.endsWith("/resume"))?.body).toMatchObject({ budgetUsd: 8 }));
  });
});

describe("stopping a debate from the keyboard", () => {
  async function running() {
    const waiting = await demoSession("awaiting_answers");
    const debating = { ...waiting, id: "s1", phase: "debating" as const };
    const stopped = { ...debating, phase: "failed" as const, error: { code: "stopped", message: "Stopped." } };
    let answer: (response: Response) => void = () => undefined;
    stubApi({
      "GET /api/sessions/s1": () => json(details()),
      "GET /api/sessions/s1/questionnaires": () => json({ questionnaires: [] }),
      "GET /api/config": () => json({ typedNames: false }),
      "POST /api/sessions/s1/stop": () => new Promise<Response>((resolve) => (answer = resolve)),
    });
    const source = stubEventSource();
    render(<SessionView id="s1" />);
    act(() => {
      source().open();
      source().send({ type: "session", session: debating });
    });
    const stop = await screen.findByRole("button", { name: "Stop" });
    stop.focus();
    fireEvent.click(stop);
    const confirm = await screen.findByRole("button", { name: "Stop now" });
    confirm.focus();
    fireEvent.click(confirm);
    return {
      stop,
      confirm,
      answer: () => answer(json({ session: stopped })),
      stopped: () => act(() => source().send({ type: "session", session: stopped })),
    };
  }
  const focused = () => document.activeElement as HTMLElement;

  it("leaves the focus on Retry, not on the page, when the debate stops after the dialog closed", async () => {
    const { stop, answer, stopped } = await running();
    answer();
    await waitFor(() => expect(focused()).toBe(stop));
    stopped();
    await waitFor(() => expect(focused().textContent).toBe("Retry from where it stopped"));
    expect(focused().tagName).toBe("BUTTON");
  });

  it.each([
    ["on its button", false],
    ["on the page, as its button is disabled while the stop is sent", true],
  ])(
    "leaves the focus on Retry once the dialog closes, when the debate stopped while it was open with the focus %s",
    async (_, dropped) => {
      const { confirm, answer, stopped } = await running();
      // A browser drops the focus of a button that becomes disabled; happy-dom keeps it, and blurs no disabled button.
      if (dropped) {
        (confirm as HTMLButtonElement).disabled = false;
        confirm.blur();
        (confirm as HTMLButtonElement).disabled = true;
      }
      stopped();
      expect(focused()).toBe(dropped ? document.body : confirm);
      answer();
      await waitFor(() => expect(focused().textContent).toBe("Retry from where it stopped"));
    },
  );

  it("does not take the focus from a control the person moved to", async () => {
    const { stop, answer, stopped } = await running();
    answer();
    await waitFor(() => expect(focused()).toBe(stop));
    const elsewhere = screen.getByRole("button", { name: "Share" });
    elsewhere.focus();
    stopped();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(focused()).toBe(elsewhere);
  });
});

describe("the page on its way", () => {
  it("has the page's rows (meta, title, tabs, panel) and says it is loading to a screen reader", () => {
    const { container } = render(<SessionSkeleton label="Loading…" />);
    expect(screen.getByRole("status").textContent).toBe("Loading…");
    for (const part of [".session-meta-row", ".session-title-row", ".tabs", ".skeleton.card"])
      expect(container.querySelector(part)).toBeTruthy();
    expect(container.querySelectorAll(".skeleton-tab").length).toBeGreaterThan(2);
    expect(container.firstElementChild?.getAttribute("aria-busy")).toBe("true");
  });
});

describe("the entrances when a tab is shown", () => {
  const routes = {
    "GET /api/sessions/s1": () => json(details()),
    "GET /api/sessions/s1/questionnaires": () => json({ questionnaires: [] }),
    "GET /api/config": () => json({ typedNames: false }),
  };

  it("are not replayed on a return to a tab, and the verdict found on opening is at rest", async () => {
    const complete = await demoSession("complete");
    stubApi(routes);
    const source = stubEventSource();
    render(<SessionView id="s1" />);
    act(() => {
      source().open();
      source().send({ type: "session", session: { ...complete, id: "s1" } });
    });
    await screen.findByRole("tab", { name: "Verdict", selected: true });
    const panel = () => document.getElementById("tab-panel") as HTMLElement;
    expect(document.querySelector(".verdict-panel")?.hasAttribute("data-entering")).toBe(false);

    fireEvent.click(screen.getByRole("tab", { name: "Debate" }));
    await screen.findByRole("tab", { name: "Debate", selected: true });

    fireEvent.click(screen.getByRole("tab", { name: "Verdict" }));
    await screen.findByRole("tab", { name: "Verdict", selected: true });
    expect(panel().querySelectorAll(".map-topic[data-settled]").length).toBeGreaterThan(0);
    expect(panel().querySelectorAll(".map-topic:not([data-settled])")).toHaveLength(0);
  });

  it("play for a verdict that arrives while the page is open, once", async () => {
    const review = await demoSession("review");
    const complete = await demoSession("complete");
    stubApi(routes);
    const source = stubEventSource();
    render(<SessionView id="s-arrival" />);
    act(() => {
      source().open();
      source().send({ type: "session", session: { ...review, id: "s-arrival" } });
    });
    await screen.findByRole("heading", { level: 1 });
    act(() => source().send({ type: "session", session: { ...complete, id: "s-arrival" } }));
    await waitFor(() => expect(document.querySelector(".verdict-panel")?.getAttribute("data-entering")).toBe("true"));
  });
});

describe("the panel of a tab shown again", () => {
  // biome-ignore lint/suspicious/noArrayIndexKey: identical placeholder rows with no data of their own to key by.
  const items = (count: number) => Array.from({ length: count }, (_, index) => <li className="question" key={index} />);
  const settled = () => Array.from(document.querySelectorAll(".question")).map((item) => item.hasAttribute("data-settled"));

  it("settles what it already holds, and lets an item that arrives afterwards come in", () => {
    const view = render(
      <TabPanel tab="interview" tabbed>
        {items(2)}
      </TabPanel>,
    );
    expect(settled()).toEqual([false, false]);
    view.rerender(
      <TabPanel tab="debate" tabbed>
        {null}
      </TabPanel>,
    );
    view.rerender(
      <TabPanel tab="interview" tabbed>
        {items(2)}
      </TabPanel>,
    );
    expect(settled()).toEqual([true, true]);
    view.rerender(
      <TabPanel tab="interview" tabbed>
        {items(3)}
      </TabPanel>,
    );
    expect(settled()).toEqual([true, true, false]);
  });
});
