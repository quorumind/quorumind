/** @vitest-environment happy-dom */
import "./test/dom.ts";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AccessContext, FULL_ACCESS } from "./access.tsx";
import { DecisionPanel, Register } from "./Decisions.tsx";
import { json, stubApi } from "./test/dom.ts";
import { demoSession } from "./test/sessions.ts";

const row = (sessionId: string, title: string) => ({
  sessionId,
  title,
  status: "proposed",
  revision: { number: 1, scenario: null },
  decidedAt: "2026-10-01T00:00:00.000Z",
  recommendation: null,
  approval: null,
  previousApproval: null,
  request: null,
  review: { on: null, when: null },
  note: null,
  supersededBy: null,
  revisits: null,
  author: null,
  mine: true,
  canEdit: true,
  private: false,
});

describe("the decision register", () => {
  it("shows the rows of the latest filters, even when an earlier answer arrives last", async () => {
    let releaseFirst: () => void = () => undefined;
    stubApi({
      "GET /api/decisions": ({ url }) => {
        const body = { authors: [], shared: false };
        if (!url.searchParams.get("status")) {
          return new Promise((resolve) => {
            releaseFirst = () => resolve(json({ ...body, decisions: [row("old", "Every decision")] }));
          });
        }
        return json({ ...body, decisions: [row("new", "Approved only")] });
      },
    });
    render(<Register />);
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "approved" } });
    await screen.findByText("Approved only");
    releaseFirst();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText("Every decision")).toBeNull();
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Decisions shown: 1"));
  });

  it("shows the register fifty rows at a time, keeps the focus on the button while more remain, then on the first new row", async () => {
    const all = Array.from({ length: 5 }, (_, index) => row(`d${index}`, `Decision ${index}`));
    const api = stubApi({
      "GET /api/decisions": ({ url }) => {
        const from = Number(url.searchParams.get("before") ?? 0);
        const size = 3;
        return json({
          authors: [],
          shared: false,
          decisions: all.slice(from, from + size),
          next: from + size < all.length ? String(from + size) : null,
        });
      },
    });
    render(<Register />);
    await screen.findByText("Decision 0");
    expect(new URL(String(api.fetch.mock.calls[0]?.[0]), "http://localhost").searchParams.get("limit")).toBe("50");
    const more = screen.getByRole("button", { name: "Show more" });
    more.focus();
    fireEvent.click(more);
    await screen.findByText("Decision 4");
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("link", { name: "Decision 3" })));
    // The register's own status line says it: one announcement, not two.
    expect(document.querySelector(".show-more [aria-live]")?.textContent).toBe("");
    expect(screen.getByRole("status").textContent).toBe("Decisions shown: 5");
  });

  it("filters on a period of verdicts, exports what is filtered, and resets the filters in one click", async () => {
    const { calls } = stubApi({
      "GET /api/decisions": () => json({ authors: [], shared: false, decisions: [row("one", "A decision")] }),
    });
    render(<Register />);
    await screen.findByText("A decision");
    expect(screen.queryByRole("button", { name: "Clear the filters" })).toBeNull();

    const period = screen.getByRole("group", { name: "Verdict date" });
    fireEvent.change(within(period).getByLabelText("From"), { target: { value: "2026-09-01" } });
    fireEvent.change(within(period).getByLabelText("To"), { target: { value: "2026-09-30" } });
    await waitFor(() => expect(calls.at(-1)?.path).toBe("/api/decisions"));
    expect(within(period).getByLabelText("To").getAttribute("min")).toBe("2026-09-01");
    const exported = new URL(screen.getByRole("link", { name: "Export as CSV" }).getAttribute("href") ?? "", "http://localhost");
    expect(exported.searchParams.get("from")).toBe("2026-09-01");
    expect(exported.searchParams.get("to")).toBe("2026-09-30");

    fireEvent.click(screen.getByRole("button", { name: "Clear the filters" }));
    expect((within(period).getByLabelText("From") as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("button", { name: "Clear the filters" })).toBeNull();
  });

  it("says when no decision matches, and offers to clear the filters", async () => {
    stubApi({
      "GET /api/decisions": ({ url }) =>
        json({ authors: [], shared: false, decisions: url.searchParams.get("status") ? [] : [row("one", "A decision")] }),
    });
    render(<Register />);
    await screen.findByText("A decision");
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "rejected" } });
    expect(await screen.findByText("No decision matches these filters.")).toBeTruthy();
    const clear = screen.getAllByRole("button", { name: "Clear the filters" });
    expect(clear).toHaveLength(2);
    fireEvent.click(clear[1] as HTMLElement);
    expect(await screen.findByText("A decision")).toBeTruthy();
  });
});

describe("the decision panel", () => {
  async function renderPanel() {
    const session = await demoSession("complete");
    const api = stubApi({
      "GET /api/config": () => json({ typedNames: false }),
      [`POST /api/sessions/${session.id}/decision/approve`]: () => json({}),
      [`POST /api/sessions/${session.id}/decision/reject`]: () => json({}),
    });
    render(
      <AccessContext.Provider value={FULL_ACCESS}>
        <DecisionPanel session={session} />
      </AccessContext.Provider>,
    );
    return api;
  }

  it("approves on Enter in the comment, the step it puts first", async () => {
    const { calls } = await renderPanel();
    const comment = await screen.findByLabelText("Comment (optional)");
    fireEvent.change(comment, { target: { value: "Go" } });
    fireEvent.submit(comment.closest("form") as HTMLFormElement);
    await waitFor(() =>
      expect(calls.find((call) => call.method === "POST")).toMatchObject({
        path: expect.stringMatching(/\/approve$/),
        body: { comment: "Go" },
      }),
    );
  });

  it("asks before rejecting, and rejects only when confirmed", async () => {
    const { calls } = await renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Reject" }));
    const dialog = await screen.findByRole("dialog", { name: "Reject this decision?" });
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(calls.find((call) => call.method === "POST")?.path).toMatch(/\/reject$/));
  });

  it("refuses a day that has passed for the review, and says why", async () => {
    await renderPanel();
    const date = (await screen.findByLabelText("Revisit on")) as HTMLInputElement;
    fireEvent.change(date, { target: { value: "2020-01-01" } });
    expect(date.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(/cannot be sent for a past date/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save the note and the review" })).toHaveProperty("disabled", true);
  });

  it("folds the note and the review date while the decision is only proposed, and opens them on request", async () => {
    await renderPanel();
    const summary = await screen.findByText("Note and date to revisit");
    const fold = summary.closest("details") as HTMLDetailsElement;
    expect(fold.open).toBe(false);
    // The fold holds the form that saves them, and nothing the decision itself needs.
    expect(fold.contains(screen.getByLabelText("Revisit on"))).toBe(true);
    expect(fold.contains(screen.getByRole("button", { name: "Approve this version" }))).toBe(false);
    // The summary is the control: a native one, so Enter and Space open it from the keyboard.
    expect(summary.closest("summary")?.tagName).toBe("SUMMARY");
    // The browser opens it on that key; here, its own toggle event is what the panel listens to.
    fold.open = true;
    fireEvent(fold, new Event("toggle"));
    expect(fold.open).toBe(true);
  });
});
