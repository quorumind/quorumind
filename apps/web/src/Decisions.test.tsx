/** @vitest-environment happy-dom */
import "./test/dom.ts";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Register } from "./Decisions.tsx";
import { json, stubApi } from "./test/dom.ts";

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
});
