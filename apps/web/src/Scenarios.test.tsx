/** @vitest-environment happy-dom */
import "./test/dom.ts";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FeedConnected, REVISION_SILENCE_MS } from "./components/RevisionStatus.tsx";
import { ScenarioForm } from "./Scenarios.tsx";
import { json, stubApi } from "./test/dom.ts";
import { demoSession } from "./test/sessions.ts";

describe("the scenario form's keyboard", () => {
  it("does not send the scenario on Enter in the title, and sends it on Ctrl+Enter", async () => {
    const session = await demoSession("complete");
    const api = stubApi({ [`POST /api/sessions/${session.id}/scenarios`]: () => json({}) });
    render(<ScenarioForm session={session} price={null} />);
    const title = screen.getByLabelText("Name of the scenario");
    fireEvent.change(title, { target: { value: "Smaller budget" } });
    fireEvent.change(screen.getByLabelText(/What if/), { target: { value: "What if the budget halves?" } });

    expect(fireEvent.keyDown(title, { key: "Enter" })).toBe(false);
    expect(api.calls).toHaveLength(0);

    fireEvent.keyDown(title, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(api.calls).toHaveLength(1));
  });
});

describe("the scenario form while the scenario is being ruled on", () => {
  it("keeps what was written, locks it, and says the work is on next to the button", async () => {
    const session = await demoSession("complete");
    stubApi({ [`POST /api/sessions/${session.id}/scenarios`]: () => json({}) });
    const view = render(<ScenarioForm session={session} price={null} />);
    fireEvent.change(screen.getByLabelText("Name of the scenario"), { target: { value: "Smaller budget" } });
    fireEvent.change(screen.getByLabelText(/What if/), { target: { value: "What if the budget halves?" } });
    fireEvent.click(screen.getByRole("button", { name: "Try this scenario" }));

    const working = await screen.findByRole("button", { name: "Trying…" });
    expect(working.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status").textContent).toContain("The arbiter is ruling on the scenario");
    // Nothing is emptied, and the fields cannot be edited meanwhile.
    expect((screen.getByLabelText("Name of the scenario") as HTMLInputElement).value).toBe("Smaller budget");
    expect(screen.getByLabelText("Name of the scenario").closest("fieldset.form-locked")?.hasAttribute("disabled")).toBe(true);

    // The server begins the revision, then ends it with a new version: the form empties only then.
    const running = {
      ...session,
      revising: { scenario: { title: "Smaller budget" }, inputs: {}, error: null },
    } as unknown as typeof session;
    view.rerender(<ScenarioForm session={running} price={null} />);
    expect(screen.getByRole("button", { name: "See progress" })).toBeTruthy();
    await act(async () => view.rerender(<ScenarioForm session={{ ...session, revising: null }} price={null} />));
    await waitFor(() => expect((screen.getByLabelText("Name of the scenario") as HTMLInputElement).value).toBe(""));
    expect(screen.getByRole("button", { name: "Try this scenario" })).toBeTruthy();
  });
});

describe("a revision the session never shows", () => {
  it("gives the form back with its text and says it may still be working", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const session = await demoSession("complete");
      stubApi({ [`POST /api/sessions/${session.id}/scenarios`]: () => json({}) });
      render(<ScenarioForm session={session} price={null} />);
      fireEvent.change(screen.getByLabelText("Name of the scenario"), { target: { value: "Smaller budget" } });
      fireEvent.change(screen.getByLabelText(/What if/), { target: { value: "What if the budget halves?" } });
      fireEvent.click(screen.getByRole("button", { name: "Try this scenario" }));
      await screen.findByRole("button", { name: "Trying…" });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(REVISION_SILENCE_MS + 100);
      });
      expect(screen.getByRole("button", { name: "Try this scenario" })).toBeTruthy();
      expect((screen.getByLabelText("Name of the scenario") as HTMLInputElement).value).toBe("Smaller budget");
      expect(screen.getByRole("status").textContent).toContain("Still working in the background");
    } finally {
      vi.useRealTimers();
    }
  });

  async function sentThenSilent(connected = true) {
    const session = await demoSession("complete");
    stubApi({ [`POST /api/sessions/${session.id}/scenarios`]: () => json({}) });
    const running = {
      ...session,
      revising: { scenario: { title: "Smaller budget" }, inputs: {}, error: null },
    } as unknown as typeof session;
    const done = { ...session, revising: null };
    const form = (shown: typeof session, feed = connected) => (
      <FeedConnected.Provider value={feed}>
        <ScenarioForm session={shown} price={null} />
      </FeedConnected.Provider>
    );
    const view = render(form(session));
    fireEvent.change(screen.getByLabelText("Name of the scenario"), { target: { value: "Smaller budget" } });
    fireEvent.change(screen.getByLabelText(/What if/), { target: { value: "What if the budget halves?" } });
    fireEvent.click(screen.getByRole("button", { name: "Try this scenario" }));
    await screen.findByRole("button", { name: "Trying…" });
    const silence = () =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(REVISION_SILENCE_MS + 100);
      });
    const title = () => (screen.getByLabelText("Name of the scenario") as HTMLInputElement).value;
    return { view, form, running, done, silence, title };
  }

  it("keeps what the person wrote in the form given back when the revision ends later", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { view, form, running, done, silence, title } = await sentThenSilent();
      await silence();
      fireEvent.change(screen.getByLabelText("Name of the scenario"), { target: { value: "Smaller team" } });
      view.rerender(form(running));
      await act(async () => view.rerender(form(done)));
      expect(title()).toBe("Smaller team");
      expect(screen.getByRole("button", { name: "Try this scenario" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("empties the form given back when the revision ends later and nothing was written since", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { view, form, running, done, silence, title } = await sentThenSilent();
      await silence();
      view.rerender(form(running));
      await act(async () => view.rerender(form(done)));
      await waitFor(() => expect(title()).toBe(""));
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives the form back when the feed drops while the revision runs, and not before", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { view, form, running, done, silence, title } = await sentThenSilent();
      view.rerender(form(running));
      // Running with the feed up: its end will be heard, however long it takes.
      await silence();
      expect(screen.getByRole("button", { name: "Trying…" })).toBeTruthy();
      // The feed drops: the session on screen still says it runs, and nothing more will come.
      view.rerender(form(running, false));
      await silence();
      expect(screen.getByRole("button", { name: "Try this scenario" })).toBeTruthy();
      expect(screen.getByLabelText("Name of the scenario").closest("fieldset.form-locked")?.hasAttribute("disabled")).toBe(false);
      expect(screen.getByRole("status").textContent).toContain("Still working in the background");
      expect(title()).toBe("Smaller budget");
      // Back, the feed says the revision is over: the text that was sent goes.
      await act(async () => view.rerender(form(done, true)));
      await waitFor(() => expect(title()).toBe(""));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a revision this form did not send", () => {
  async function runningElsewhere() {
    const session = await demoSession("complete");
    stubApi({ [`POST /api/sessions/${session.id}/scenarios`]: () => json({}) });
    const running = {
      ...session,
      revising: { scenario: { title: "Smaller budget" }, inputs: {}, error: null },
    } as unknown as typeof session;
    // The revision sent from elsewhere ends with one more version.
    const done = { ...session, revising: null, revisions: [...session.revisions, session.revisions.at(-1)] } as typeof session;
    const form = (shown: typeof session, feed = true) => (
      <FeedConnected.Provider value={feed}>
        <ScenarioForm session={shown} price={null} />
      </FeedConnected.Provider>
    );
    const silence = () =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(REVISION_SILENCE_MS + 100);
      });
    const locked = () => screen.getByLabelText("Name of the scenario").closest("fieldset.form-locked")?.hasAttribute("disabled");
    const title = () => (screen.getByLabelText("Name of the scenario") as HTMLInputElement).value;
    return { session, running, done, form, silence, locked, title };
  }

  it("gives the form back when the feed drops while it runs, and keeps what the person writes when it ends", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { running, done, form, silence, locked, title } = await runningElsewhere();
      // Opened while a revision runs: locked, however long it takes, while the feed is up.
      const view = render(form(running));
      await silence();
      expect(locked()).toBe(true);
      // The feed drops: the end of that revision may never be heard.
      view.rerender(form(running, false));
      await silence();
      expect(locked()).toBe(false);
      expect(screen.getByRole("status").textContent).toContain("Still working in the background");
      fireEvent.change(screen.getByLabelText("Name of the scenario"), { target: { value: "Smaller team" } });
      // Back, the feed says that revision is over: this form sent nothing, so nothing it holds goes.
      await act(async () => view.rerender(form(done, true)));
      expect(title()).toBe("Smaller team");
      expect(locked()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays given back while that revision runs, whatever revisions ended before", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { session, running, done, form, silence, locked } = await runningElsewhere();
      // A revision ended earlier, while the form waited for nothing: its version count moved on.
      const view = render(form(session));
      view.rerender(form(done));
      const next = { ...running, revisions: done.revisions } as typeof session;
      view.rerender(form(next, false));
      await silence();
      expect(locked()).toBe(false);
      // Given back for good: an earlier version count does not count as this revision's end and lock it again.
      await silence();
      expect(locked()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not empty what the person writes again after their own revision ended", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { session, running, done, form, silence, locked, title } = await runningElsewhere();
      const write = () => {
        fireEvent.change(screen.getByLabelText("Name of the scenario"), { target: { value: "Smaller budget" } });
        fireEvent.change(screen.getByLabelText(/What if/), { target: { value: "What if the budget halves?" } });
      };
      // The person's own scenario runs and ends: the text it sent goes.
      const view = render(form(session));
      write();
      fireEvent.click(screen.getByRole("button", { name: "Try this scenario" }));
      await screen.findByRole("button", { name: "Trying…" });
      view.rerender(form(running));
      await act(async () => view.rerender(form(done)));
      await waitFor(() => expect(title()).toBe(""));
      // Another revision runs, the feed drops, the form is given back and the person writes the same text again.
      const next = { ...running, revisions: done.revisions } as typeof session;
      view.rerender(form(next, false));
      await silence();
      expect(locked()).toBe(false);
      write();
      // That revision ends: this form did not send what it now holds, so it stays.
      const after = { ...done, revisions: [...done.revisions, done.revisions.at(-1)] } as typeof session;
      await act(async () => view.rerender(form(after, true)));
      expect(title()).toBe("Smaller budget");
    } finally {
      vi.useRealTimers();
    }
  });
});
