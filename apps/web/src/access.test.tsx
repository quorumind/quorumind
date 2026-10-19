/** @vitest-environment happy-dom */
import "./test/dom.ts";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App.tsx";
import { useCanEdit } from "./access.tsx";
import { json, PAGE_TIMEOUT, stubApi } from "./test/dom.ts";
import { demoSession } from "./test/sessions.ts";

function Probe() {
  return <p>{useCanEdit() ? "can edit" : "read only"}</p>;
}

describe("access to a session", () => {
  it("is read-only when no page says who is looking", () => {
    render(<Probe />);
    expect(screen.getByText("read only")).toBeTruthy();
  });

  it("never offers the interview's answer form on a share link, even mid-interview", async () => {
    const session = await demoSession("interview");
    stubApi({ "GET /api/shared/tok": () => json({ share: { mode: "full" }, session }) });
    window.location.hash = "#/shared/tok";
    render(<App />);
    await screen.findAllByText(session.idea, {}, { timeout: PAGE_TIMEOUT });
    expect(screen.queryByRole("button", { name: "Send answers" })).toBeNull();
    expect(document.querySelectorAll("textarea")).toHaveLength(0);
    // The visitor is not "You": the session's author wrote the idea.
    expect(screen.getAllByText("Author").length).toBeGreaterThan(0);
    expect(screen.queryByText("You")).toBeNull();
  });

  it("never offers the debate's questions on a share link", async () => {
    const session = await demoSession("awaiting_answers");
    expect(session.phase).toBe("awaiting_answers");
    stubApi({ "GET /api/shared/tok": () => json({ share: { mode: "full" }, session }) });
    window.location.hash = "#/shared/tok";
    render(<App />);
    await screen.findByRole("tablist", {}, { timeout: PAGE_TIMEOUT });
    expect(screen.queryByRole("button", { name: /Send/ })).toBeNull();
    expect(document.querySelectorAll("textarea")).toHaveLength(0);
  });

  it("opens a share link outside the app: no sidebar, no history of the server's sessions", async () => {
    const session = await demoSession("complete");
    const { calls } = stubApi({ "GET /api/shared/tok": () => json({ share: { mode: "full" }, session }) });
    window.location.hash = "#/shared/tok";
    render(<App />);
    await screen.findByText("You are reading a shared session. It cannot be changed.", {}, { timeout: PAGE_TIMEOUT });
    expect(screen.queryByRole("link", { name: "New session" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Sessions" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Share/ })).toBeNull();
    await waitFor(() => expect(calls.map((call) => call.path)).toEqual(["/api/shared/tok"]));
  });
});
