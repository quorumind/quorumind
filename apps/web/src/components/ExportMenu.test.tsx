/** @vitest-environment happy-dom */
import "../test/dom.ts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExportMenu } from "./ExportMenu.tsx";

describe("the export menu's archives", () => {
  it("shows the preparation on the entry, then hands the file to the browser", async () => {
    let finish: (response: Response) => void = () => undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (finish = resolve))),
    );
    URL.createObjectURL = vi.fn(() => "blob:handoff");
    URL.revokeObjectURL = vi.fn();
    render(<ExportMenu sessionId="s1" hasVerdict />);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    const entry = screen.getByRole("menuitem", { name: /Agent hand-off|hand-off/i });
    fireEvent.click(entry);
    await waitFor(() => expect(entry.getAttribute("aria-busy")).toBe("true"));
    expect(entry.textContent).toContain("Preparing…");
    expect(entry.querySelector('.mark[data-busy="true"]')).toBeTruthy();
    // A second click while it is being prepared asks for nothing more.
    fireEvent.click(entry);
    expect(fetch).toHaveBeenCalledTimes(1);
    finish(new Response(new Blob(["zip"]), { headers: { "content-disposition": 'attachment; filename="handoff.zip"' } }));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("menuitem")).toBeNull());
  });

  it("says so on the entry when the archive could not be prepared", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 500 })),
    );
    render(<ExportMenu sessionId="s1" hasVerdict />);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    const entry = screen.getByRole("menuitem", { name: /hand-off/i });
    fireEvent.click(entry);
    await waitFor(() => expect(entry.textContent).toContain("Could not prepare it"));
    expect(entry.getAttribute("aria-busy")).toBeNull();
  });
});
