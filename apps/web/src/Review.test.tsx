/** @vitest-environment happy-dom */
import "./test/dom.ts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { Review } from "./Review.tsx";
import { json, stubApi } from "./test/dom.ts";
import { demoSession } from "./test/sessions.ts";

beforeEach(() => localStorage.clear());

async function renderReview() {
  const session = await demoSession("review");
  const api = stubApi({ [`PUT /api/sessions/${session.id}/sheet`]: () => json({}) });
  render(<Review session={session} />);
  return { session, api };
}

describe("the requirements sheet's keyboard", () => {
  it("does not confirm the sheet on Enter in a one-line field", async () => {
    const { api } = await renderReview();
    const name = screen.getByLabelText("Project name");
    // The browser's implicit submission is the default action of this event: it must be prevented.
    expect(fireEvent.keyDown(name, { key: "Enter" })).toBe(false);
    expect(api.calls).toHaveLength(0);
  });

  it("does not confirm the sheet on Enter in a checkbox either", async () => {
    const { api } = await renderReview();
    const box = screen.getAllByRole("checkbox")[0] as HTMLElement;
    expect(fireEvent.keyDown(box, { key: "Enter" })).toBe(false);
    expect(api.calls).toHaveLength(0);
  });

  it("leaves Enter to a textarea, where it starts a new line", async () => {
    await renderReview();
    expect(fireEvent.keyDown(screen.getByLabelText("Summary"), { key: "Enter" })).toBe(true);
  });

  it("confirms the sheet on Ctrl+Enter or Cmd+Enter", async () => {
    const { session, api } = await renderReview();
    fireEvent.keyDown(screen.getByLabelText("Project name"), { key: "Enter", metaKey: true });
    await waitFor(() => expect(api.calls.some((call) => call.path === `/api/sessions/${session.id}/sheet`)).toBe(true));
  });
});

describe("the requirements sheet's validation", () => {
  it("marks a negative count under its field, says why and moves the focus there, without calling the server", async () => {
    const { api } = await renderReview();
    const launch = screen.getByLabelText("Users at launch");
    fireEvent.change(launch, { target: { value: "-5" } });
    fireEvent.click(screen.getByRole("button", { name: /Start the debate/ }));
    expect(launch.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(launch.getAttribute("aria-describedby") ?? "")?.textContent).toBe("Enter a number, 0 or more.");
    expect(document.activeElement).toBe(launch);
    expect(api.calls).toHaveLength(0);
    fireEvent.change(launch, { target: { value: "5" } });
    expect(launch.getAttribute("aria-invalid")).toBeNull();
  });

  it("attaches a refusal naming a field of the sheet to that field", async () => {
    const session = await demoSession("review");
    stubApi({
      [`PUT /api/sessions/${session.id}/sheet`]: () =>
        json({ error: "invalid_request", message: "bad", params: { field: "sheet.users.launch" } }, 400),
    });
    render(<Review session={session} />);
    fireEvent.click(screen.getByRole("button", { name: /Start the debate/ }));
    const launch = screen.getByLabelText("Users at launch");
    await waitFor(() => expect(launch.getAttribute("aria-invalid")).toBe("true"));
    expect(document.activeElement).toBe(launch);
  });
});

describe("the requirements sheet's draft", () => {
  it("keeps the edits across a reload, and drops them once the sheet is confirmed", async () => {
    const { session, api } = await renderReview();
    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "My edited name" } });
    fireEvent.change(screen.getByLabelText("Summary"), { target: { value: "My edited summary" } });
    cleanupRender();
    render(<Review session={session} />);
    expect((screen.getByLabelText("Project name") as HTMLInputElement).value).toBe("My edited name");
    expect((screen.getByLabelText("Summary") as HTMLTextAreaElement).value).toBe("My edited summary");

    fireEvent.click(screen.getByRole("button", { name: /Start the debate/ }));
    await waitFor(() => expect(api.calls).toHaveLength(1));
    expect(Object.keys(localStorage).filter((key) => key.includes(session.id))).toEqual([]);
  });

  it("writes nothing for a sheet that was only looked at", async () => {
    const { session } = await renderReview();
    expect(Object.keys(localStorage).filter((key) => key.includes(session.id))).toEqual([]);
  });

  it("does not save the edits made on an old sheet against a sheet that changed under the form", async () => {
    const session = await demoSession("review");
    stubApi({});
    const view = render(<Review session={session} />);
    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "Edit on the old sheet" } });
    const changed = { ...session, sheet: { ...(session.sheet as object), projectName: "New sheet" } } as typeof session;
    view.rerender(<Review session={changed} />);
    // The same mounted form keeps showing A's edit, and what is stored stays pinned to sheet A.
    expect((screen.getByLabelText("Project name") as HTMLInputElement).value).toBe("Edit on the old sheet");
    const stored = JSON.parse(localStorage.getItem(`quorumind.sheetDraft.${session.id}`) ?? "null") as { base: string };
    expect(stored.base).toBe(JSON.stringify(session.sheet));
    expect(stored.base).not.toBe(JSON.stringify(changed.sheet));
    cleanup();
    render(<Review session={changed} />);
    expect((screen.getByLabelText("Project name") as HTMLInputElement).value).toBe("New sheet");
  });

  it("ignores a draft of another session", async () => {
    const { session } = await renderReview();
    localStorage.setItem("quorumind.sheetDraft.other", JSON.stringify({ sheet: { ...session.sheet, projectName: "Other" } }));
    expect((screen.getByLabelText("Project name") as HTMLInputElement).value).not.toBe("Other");
  });
});

import { cleanup } from "@testing-library/react";

const cleanupRender = () => cleanup();
