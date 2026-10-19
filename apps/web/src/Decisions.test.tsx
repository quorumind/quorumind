/** @vitest-environment happy-dom */
import "./test/dom.ts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
});
