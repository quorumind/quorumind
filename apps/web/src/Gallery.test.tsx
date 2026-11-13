/** @vitest-environment happy-dom */
import "./test/dom.ts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Gallery } from "./Gallery.tsx";
import { json, stubApi } from "./test/dom.ts";

const item = (token: string, idea: string) => ({
  id: token,
  token,
  idea,
  phase: "complete",
  updatedAt: "2026-10-01T10:00:00.000Z",
  summary: null,
});

describe("the gallery", () => {
  it("shows the published debates a page at a time, and moves the focus to the first new card at the end", async () => {
    const all = ["a", "b", "c", "d", "e"].map((token) => item(token, `Published ${token}`));
    const api = stubApi({
      "GET /api/gallery": ({ url }) => {
        const from = Number(url.searchParams.get("before") ?? 0);
        return json({ sessions: all.slice(from, from + 3), next: from + 3 < all.length ? String(from + 3) : null });
      },
    });
    render(<Gallery />);
    await screen.findByText("Published a");
    expect(screen.getAllByRole("link")).toHaveLength(3);
    const more = screen.getByRole("button", { name: "Show more" });
    more.focus();
    fireEvent.click(more);
    await screen.findByText("Published e");
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
    await waitFor(() => expect(document.activeElement?.textContent).toContain("Published d"));
    expect(document.querySelector(".show-more [aria-live]")?.textContent).toBe("Shown: 5 (+2).");
    expect(api.fetch.mock.calls.map(([input]) => String(input))).toEqual(["/api/gallery", "/api/gallery?before=3"]);
  });

  it("offers no button when everything fits on one page", async () => {
    stubApi({ "GET /api/gallery": () => json({ sessions: [item("a", "Only one")], next: null }) });
    render(<Gallery />);
    await screen.findByText("Only one");
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("still works with a server that answers no cursor", async () => {
    stubApi({ "GET /api/gallery": () => json({ sessions: [item("a", "From an older server")] }) });
    render(<Gallery />);
    await screen.findByText("From an older server");
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });
});
