/** @vitest-environment happy-dom */
import "./test/dom.ts";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App.tsx";
import { AccessContext, FULL_ACCESS } from "./access.tsx";
import { Debate } from "./Debate.tsx";
import { json, PAGE_TIMEOUT, stubApi } from "./test/dom.ts";
import { demoSession } from "./test/sessions.ts";

const shell = {
  "GET /api/sessions": () => json({ sessions: [] }),
  "GET /api/config": () =>
    json({ catalog: [], live: null, demo: { lineup: null, idea: "" }, templates: [], personas: [], localOnly: false, providerCosts: true }),
  "GET /api/profile": () => json({ profile: null }),
  "GET /api/branding": () => json({ branding: { name: null, logoDataUrl: null, accent: null } }),
  "GET /api/decisions": () => json({ decisions: [], authors: [], shared: false }),
};

describe("navigation", () => {
  it("names the tab after the page, and moves the focus to its heading", async () => {
    stubApi(shell);
    window.location.hash = "#/";
    render(<App />);
    await waitFor(() => expect(document.title).toBe("New session · Quorumind"));
    act(() => {
      window.location.hash = "#/settings";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    const heading = await screen.findByRole("heading", { level: 1, name: "Settings" }, { timeout: PAGE_TIMEOUT });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(document.title).toBe("Settings · Quorumind");
  });

  it("offers a link past the sidebar to the page's content", async () => {
    stubApi(shell);
    window.location.hash = "#/";
    render(<App />);
    const skip = screen.getByRole("button", { name: "Skip to content" });
    fireEvent.click(skip);
    expect(document.activeElement?.id).toBe("main-content");
    // The route stays: it moves the focus only.
    expect(window.location.hash).toBe("#/");
  });
});

describe("the debate for screen readers", () => {
  it("says who is writing, without reading out each token", async () => {
    const session = await demoSession("awaiting_answers");
    const view = render(
      <AccessContext.Provider value={FULL_ACCESS}>
        <Debate session={session} live={{ "critique:A": { task: "critique", seat: "A", text: "The first" } }} />
      </AccessContext.Provider>,
    );
    expect(screen.getByRole("status").textContent).toBe("Writing now: Proposer A");
    view.rerender(
      <AccessContext.Provider value={FULL_ACCESS}>
        <Debate session={session} live={{}} />
      </AccessContext.Provider>,
    );
    expect(screen.getByRole("status").textContent).toBe("");
  });
});
