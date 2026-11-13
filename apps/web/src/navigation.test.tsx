/** @vitest-environment happy-dom */
import "./test/dom.ts";
import type { Lineup } from "@quorumind/core";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App, parseRoute } from "./App.tsx";
import { failure, json, PAGE_TIMEOUT, stubApi, stubEventSource } from "./test/dom.ts";
import { demoSession } from "./test/sessions.ts";

// The addresses of the app: every page has one, a wrong one says so, the steps of a new session and the tab of a
// session are in them, and the focus moves to a page's heading only when the person went to another page.

const lineup: Lineup = {
  interviewer: { provider: "mock", model: "mock" },
  arbiter: { provider: "mock", model: "mock" },
  seats: { A: { provider: "mock", model: "mock", persona: null }, B: { provider: "mock", model: "mock", persona: null } },
  devil: null,
};

function stub(live = true, extra: Parameters<typeof stubApi>[0] = {}) {
  return stubApi({
    "GET /api/config": () =>
      json({
        catalog: [{ provider: "mock", model: "mock", label: "Demo", local: false }],
        live: live ? { lineup, estimateUsd: null } : null,
        demo: { lineup, idea: "" },
        templates: [],
        personas: [],
        localOnly: false,
        providerCosts: true,
        profileSettings: false,
      }),
    "GET /api/sessions": () => json({ sessions: [] }),
    "POST /api/estimate": () => json({ estimateUsd: { low: 0, high: 0 }, price: null }),
    ...extra,
  });
}

/** Goes to an address as a link or the browser's Back would: the hash changes, then the page hears it. */
function go(hash: string) {
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

beforeEach(() => sessionStorage.clear());
afterEach(() => localStorage.clear());

describe("an address", () => {
  it("is read without its stray slashes, with its query apart", () => {
    expect(parseRoute("#/sessions/")).toMatchObject({ path: "sessions", segments: ["sessions"] });
    expect(parseRoute("#/s//abc/debate/")).toMatchObject({ path: "s/abc/debate", segments: ["s", "abc", "debate"] });
    const demo = parseRoute("#/?demo=1");
    expect(demo.path).toBe("");
    expect(demo.query.get("demo")).toBe("1");
  });

  it("that leads nowhere says so, with a heading, instead of showing the new session", async () => {
    stub();
    window.location.hash = "#/nimporte";
    render(<App />);
    const heading = await screen.findByRole("heading", { level: 1, name: "This page does not exist" });
    expect(document.title).toBe("This page does not exist · Quorumind");
    expect(screen.getByRole("link", { name: "Start a new debate" }).getAttribute("href")).toBe("#/");
    expect(screen.getByRole("link", { name: "See your debates" }).getAttribute("href")).toBe("#/sessions");
    // A link followed to another wrong address: that page's heading takes the focus.
    heading.blur();
    go("#/s/");
    await waitFor(() => expect(document.activeElement?.textContent).toBe("This page does not exist"));
    expect(document.activeElement?.tagName).toBe("H1");
    go("#/gallery/nope");
    expect(await screen.findByRole("heading", { level: 1, name: "This page does not exist" })).toBeTruthy();
  });

  it("with a trailing slash opens its page, and is rewritten without it", async () => {
    stub();
    window.location.hash = "#/sessions/";
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: "Debates" }, { timeout: PAGE_TIMEOUT })).toBeTruthy();
    expect(window.location.hash).toBe("#/sessions");
  });
});

describe("the steps of a new session", () => {
  it("are entries of the browser's history: Back goes to the step before, Forward to the next, the focus on the step", async () => {
    stub();
    window.location.hash = "#/";
    render(<App />);
    fireEvent.change(await screen.findByLabelText("Your project idea"), { target: { value: "A booking app" } });
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(window.location.hash).toBe("#/new/context");
    go("#/new/context");
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(window.location.hash).toBe("#/new/panel");
    go("#/new/panel");
    expect(document.activeElement?.textContent).toBe("The panel");

    // Back: the step before, its heading focused, what was typed kept.
    go("#/new/context");
    expect(screen.getByRole("heading", { level: 2, name: "Context" })).toBe(document.activeElement);
    go("#/");
    expect(screen.getByRole("heading", { level: 2, name: "Your need" })).toBe(document.activeElement);
    expect((screen.getByLabelText("Your project idea") as HTMLTextAreaElement).value).toBe("A booking app");
    // Forward.
    go("#/new/context");
    expect(screen.getByRole("heading", { level: 2, name: "Context" })).toBe(document.activeElement);
    // A step heading's focus is not taken back by the page's heading at the next page.
    expect(document.activeElement?.tagName).toBe("H2");
  });

  it("open at the first step not done when the address names a later one, without offering the steps after it", async () => {
    stub();
    window.location.hash = "#/new/review";
    render(<App />);
    await waitFor(() => expect(window.location.hash).toBe("#/"));
    expect(screen.getByRole("heading", { level: 2, name: "Your need" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Your project idea"), { target: { value: "A booking app" } });
    const steps = screen.getByRole("navigation", { name: "Steps of the new debate" });
    expect(within(steps).queryByRole("button")).toBeNull();
  });

  it("follow every move, even two that end where they started before the page was drawn again", async () => {
    stub();
    window.location.hash = "#/";
    render(<App />);
    fireEvent.change(await screen.findByLabelText("Your project idea"), { target: { value: "A booking app" } });
    // Next, then Back to the first step, both heard in the same update.
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Next/ }));
      window.location.hash = "#/";
      const at = (hash: string) => `${window.location.origin}${window.location.pathname}${hash}`;
      window.dispatchEvent(new HashChangeEvent("hashchange", { oldURL: at("#/"), newURL: at("#/new/context") }));
      window.dispatchEvent(new HashChangeEvent("hashchange", { oldURL: at("#/new/context"), newURL: at("#/") }));
    });
    await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: "Your need" }).closest("section")?.hidden).toBe(false));
  });

  it("resume at the step a draft reached, which the address then says", async () => {
    sessionStorage.setItem("quorumind.newSession", JSON.stringify({ step: "panel", idea: "A booking app", mode: "standard" }));
    stub();
    window.location.hash = "#/";
    render(<App />);
    await waitFor(() => expect(window.location.hash).toBe("#/new/panel"));
    const panel = await screen.findByRole("heading", { level: 2, name: "The panel" });
    expect(panel.closest("section")?.hidden).toBe(false);
  });

  it("an address to watch the recorded demo brings its offer first and gives it the focus, without starting it", async () => {
    const { calls } = stub();
    window.location.hash = "#/?demo=1";
    render(<App />);
    const play = await screen.findByRole("button", { name: /Replay the recorded demo/ });
    await waitFor(() => expect(document.activeElement).toBe(play));
    expect(screen.getAllByRole("button", { name: /Replay the recorded demo/ })).toHaveLength(1);
    // Above the form.
    const form = document.querySelector(".wizard") as Element;
    expect(play.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(calls.some((call) => call.method === "POST" && call.path === "/api/sessions")).toBe(false);
  });
});

describe("the tab of a session", () => {
  const details = { busy: false, share: null, feedback: [], price: null, revisionPrice: null, providerCosts: true };

  async function open(hash: string) {
    const complete = await demoSession("complete");
    stub(true, {
      "GET /api/sessions/s1": () => json(details),
      "GET /api/sessions/s1/questionnaires": () => json({ questionnaires: [] }),
    });
    const source = stubEventSource();
    window.location.hash = hash;
    render(<App />);
    await waitFor(() => expect(() => source()).not.toThrow(), { timeout: PAGE_TIMEOUT });
    act(() => {
      source().open();
      source().send({ type: "session", session: { ...complete, id: "s1" } });
    });
    return screen.findByRole("tablist", {}, { timeout: PAGE_TIMEOUT });
  }

  it("is in the address: a reload opens it, a click on another tab writes it in place, without moving the focus", async () => {
    const tabs = await open("#/s/s1/debate");
    expect(within(tabs).getByRole("tab", { name: "Debate" }).getAttribute("aria-selected")).toBe("true");
    const interview = within(tabs).getByRole("tab", { name: "Interview" });
    interview.focus();
    const before = window.history.length;
    fireEvent.click(interview);
    await waitFor(() => expect(window.location.hash).toBe("#/s/s1/interview"));
    expect(interview.getAttribute("aria-selected")).toBe("true");
    expect(window.history.length).toBe(before);
    expect(document.activeElement).toBe(interview);
  });

  it("named wrongly in the address shows the phase's own and leaves the address, in place", async () => {
    const tabs = await open("#/s/s1/nope");
    const before = window.history.length;
    expect(
      within(tabs)
        .getByRole("tab", { name: /Verdict/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
    await waitFor(() => expect(window.location.hash).toBe("#/s/s1"));
    // Rewritten in place: no entry added for it.
    expect(window.history.length).toBe(before);
  });

  it("changed by a link to another tab of the same debate follows it without moving the focus", async () => {
    const tabs = await open("#/s/s1");
    const verdict = within(tabs).getByRole("tab", { name: /Verdict/ });
    verdict.focus();
    go("#/s/s1/debate");
    await waitFor(() => expect(within(tabs).getByRole("tab", { name: "Debate" }).getAttribute("aria-selected")).toBe("true"));
    expect(document.activeElement).toBe(verdict);
  });

  it("without one in the address is the phase's own, and an address naming it is written without it", async () => {
    const tabs = await open("#/s/s1/verdict");
    expect(
      within(tabs)
        .getByRole("tab", { name: /Verdict/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
    await waitFor(() => expect(window.location.hash).toBe("#/s/s1"));
  });

  it("opens from a step reached, as the tabs do", async () => {
    const tabs = await open("#/s/s1");
    const steps = document.querySelector("ol.progress") as HTMLElement;
    fireEvent.click(within(steps).getByRole("button", { name: "Interview" }));
    expect(within(tabs).getByRole("tab", { name: "Interview" }).getAttribute("aria-selected")).toBe("true");
    await waitFor(() => expect(window.location.hash).toBe("#/s/s1/interview"));
    // The step shown is no longer a button; the others reached are.
    expect(within(steps).queryByRole("button", { name: "Interview" })).toBeNull();
    expect(within(steps).getByRole("button", { name: "Verdict" })).toBeTruthy();
  });
});

describe("a session that cannot be opened", () => {
  async function missing(code: string, shared = false) {
    stub(true, {
      "GET /api/sessions": () => json({ sessions: [], shared }),
      "GET /api/sessions/gone": () => failure(404, code),
    });
    const source = stubEventSource();
    window.location.hash = "#/s/gone";
    render(<App />);
    await waitFor(() => expect(() => source()).not.toThrow(), { timeout: PAGE_TIMEOUT });
    act(() => {
      source().readyState = 2;
      source().onerror?.();
    });
  }

  it("is a page with a heading and the ways on", async () => {
    await missing("not_found");
    expect(await screen.findByRole("heading", { level: 1, name: "Debate not found" })).toBeTruthy();
    expect(screen.getByText("This debate does not exist, or it was deleted.")).toBeTruthy();
    expect(document.title).toBe("Debate not found · Quorumind");
    expect(screen.getByRole("link", { name: "See your debates" })).toBeTruthy();
  });

  it("says it is private to a member of its workspace, and to ask its author", async () => {
    await missing("private_session", true);
    expect(await screen.findByRole("heading", { level: 1, name: "This debate is private" })).toBeTruthy();
    expect(screen.getByText(/Only the person who started it can open it now/)).toBeTruthy();
  });
});

describe("a share link", () => {
  it("that no longer works says so with a heading and who to ask, without the shared page's notice or a way into the app", async () => {
    stubApi({ "GET /api/shared/zzz": () => failure(404, "not_found") });
    window.location.hash = "#/shared/zzz";
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: "This link no longer works" }, { timeout: PAGE_TIMEOUT })).toBeTruthy();
    expect(screen.getByText(/Ask the person who sent it to you for a new one/)).toBeTruthy();
    expect(screen.queryByText(/You are reading a shared session/)).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("keeps its tab in its address", async () => {
    const complete = await demoSession("complete");
    stubApi({ "GET /api/shared/tok": () => json({ share: { mode: "full" }, session: complete }) });
    window.location.hash = "#/shared/tok/debate";
    render(<App />);
    const tabs = await screen.findByRole("tablist", {}, { timeout: PAGE_TIMEOUT });
    expect(within(tabs).getByRole("tab", { name: "Debate" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(within(tabs).getByRole("tab", { name: "Interview" }));
    await waitFor(() => expect(window.location.hash).toBe("#/shared/tok/interview"));
  });
});
