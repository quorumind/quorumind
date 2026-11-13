/** @vitest-environment happy-dom */
import "./test/dom.ts";
import type { Session } from "@quorumind/core";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { AccessContext, FULL_ACCESS } from "./access.tsx";
import { SessionBody } from "./SessionView.tsx";
import { demoSession } from "./test/sessions.ts";
import type { LiveSpeech } from "./useSession.ts";

// How a person follows a debate from its page: where it stands, what waits on them, where the focus goes when a phase
// ends, and what a screen reader hears (once per step, never per token).

let awaiting: Session;
let complete: Session;
let review: Session;
beforeAll(async () => {
  [awaiting, complete, review] = await Promise.all([demoSession("awaiting_answers"), demoSession("complete"), demoSession("review")]);
});

/** The debate running, at its first critiques: the proposals are in, the question not asked yet. */
const debating = (): Session => ({
  ...awaiting,
  phase: "debating",
  debate: awaiting.debate.filter((entry) => entry.kind === "proposal"),
});
/** Just after the person answered: their answers are in, the revisions run. */
const resumed = (): Session => ({
  ...complete,
  phase: "debating",
  verdict: null,
  revisions: [],
  debate: complete.debate.filter((entry) => entry.kind !== "revision" && entry.kind !== "verdict"),
});

function Page({
  session,
  live = {},
  connected = true,
  onReconnect,
}: {
  session: Session;
  live?: LiveSpeech;
  connected?: boolean;
  onReconnect?: () => void;
}) {
  return (
    <AccessContext.Provider value={FULL_ACCESS}>
      <SessionBody session={session} live={live} connected={connected} {...(onReconnect ? { onReconnect } : {})} />
    </AccessContext.Provider>
  );
}

const announced = () => (document.querySelector(".session > p[role=status]") as HTMLElement).textContent?.trim();

/** Everything the page's polite region says from now on, in order (read after each change: await `flush`). */
function listen() {
  const said: string[] = [];
  const region = document.querySelector(".session > p[role=status]") as HTMLElement;
  new MutationObserver(() => {
    if (region.textContent) said.push(region.textContent.trim());
  }).observe(region, { childList: true, characterData: true, subtree: true });
  return said;
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const focused = () => document.activeElement as HTMLElement;

describe("a debate waiting for the person's answer", () => {
  it("says so at the top, in the steps and in the browser tab, and takes them to the question", () => {
    render(<Page session={awaiting} />);
    const banner = screen.getByRole("heading", { level: 2, name: "The debate is waiting for your answer" });
    expect(banner).toBeTruthy();
    expect(document.title).toBe("(1) Studio booking app · Quorumind");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Studio booking app");
    const step = document.querySelector(".progress li[aria-current=step]") as HTMLElement;
    expect(step.dataset.state).toBe("waiting");
    expect(step.textContent).toBe("Your input");
    fireEvent.click(screen.getByRole("button", { name: "Answer now" }));
    expect(focused().id).toBe("debate-questions-title");
  });

  it('offers "I don\'t know" for each question, and says a blank one is sent as such', () => {
    render(<Page session={awaiting} />);
    const form = document.getElementById("debate-questions") as HTMLFormElement;
    expect(form.textContent).toContain("a question left blank is sent as “I don't know”");
    const chip = screen.getByRole("button", { name: "I don't know", pressed: false });
    fireEvent.click(chip);
    expect((document.getElementById("dq-0") as HTMLTextAreaElement).value).toBe("I don't know");
    expect(chip.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("when a phase ends", () => {
  it("puts the focus the pressed button lost on what appeared, without announcing it twice", () => {
    const view = render(<Page session={review} />);
    expect(focused()).toBe(document.body);
    // The person started the debate: the requirements and their button went away.
    view.rerender(<Page session={debating()} />);
    expect(focused().tagName).toBe("H1");
    expect(announced()).toBe("Blind proposals");
    // The debate asks them something: the banner at the top, with the focus; nothing more is announced.
    view.rerender(<Page session={awaiting} />);
    expect(focused().id).toBe("awaiting-title");
    expect(announced()).toBe("Blind proposals");
    // They answered: their answers stand where the form was.
    view.rerender(<Page session={resumed()} />);
    expect(focused().dataset.answers).toBe("1");
    // The verdict: its tab, its recommendation focused.
    view.rerender(<Page session={complete} />);
    expect(screen.getByRole("tab", { name: "Verdict" }).getAttribute("aria-selected")).toBe("true");
    expect(focused().closest(".verdict-panel")).not.toBeNull();
    expect(focused().tagName).toBe("H2");
  });

  it("never takes the focus from a control the person chose: the change is announced instead, once", () => {
    const view = render(<Page session={debating()} />);
    const tab = screen.getByRole("tab", { name: "Debate" });
    tab.focus();
    view.rerender(<Page session={awaiting} />);
    expect(focused()).toBe(tab);
    expect(announced()).toBe("The debate is waiting for your answer");
    view.rerender(<Page session={resumed()} />);
    view.rerender(<Page session={complete} />);
    expect(announced()).toBe("The verdict is ready");
  });

  it("keeps the tab the person chose to read when the verdict arrives, and offers it", () => {
    const view = render(<Page session={resumed()} />);
    const requirements = screen.getByRole("tab", { name: "Requirements" });
    fireEvent.click(requirements);
    requirements.focus();
    view.rerender(<Page session={complete} />);
    expect(screen.getByRole("tab", { name: "Requirements" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("heading", { level: 2, name: "The verdict is ready" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "See the verdict" }));
    expect(screen.getByRole("tab", { name: "Verdict" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("heading", { level: 2, name: "The verdict is ready" })).toBeNull();
    expect(focused().closest(".verdict-panel")).not.toBeNull();
  });
});

describe("the progress of a running debate", () => {
  const critique: LiveSpeech = {
    "critique:A": { task: "critique", seat: "A", text: "Option B" },
    "critique:B": { task: "critique", seat: "B", text: "Option A" },
  };

  it("shows the step, its round and who writes, and announces each new step once", () => {
    const view = render(<Page session={debating()} live={{ "proposal:A": { task: "proposal", seat: "A", text: "I" } }} />);
    const line = () => (document.querySelector(".debate-progress") as HTMLElement).textContent;
    expect(line()).toBe("Blind proposalsWriting now: Debater A");
    expect(announced()).toBe("");
    view.rerender(<Page session={debating()} live={{ "critique:A": critique["critique:A"] as LiveSpeech[string] }} />);
    expect(line()).toBe("Round 1 of 1: critiquesWriting now: Debater A");
    expect(announced()).toBe("Round 1 of 1: critiques");
    // Another voice of the same step: shown, not announced again.
    view.rerender(<Page session={debating()} live={critique} />);
    expect(line()).toBe("Round 1 of 1: critiquesWriting now: Debater A and Debater B");
    expect(announced()).toBe("Round 1 of 1: critiques");
  });

  it("breathes only while something works, and marks a stopped step in words", () => {
    const view = render(<Page session={debating()} />);
    expect((document.querySelector(".progress li[aria-current=step]") as HTMLElement).dataset.live).toBe("true");
    view.rerender(<Page session={complete} />);
    expect((document.querySelector(".progress li[aria-current=step]") as HTMLElement).dataset.live).toBeUndefined();
    view.rerender(<Page session={{ ...debating(), phase: "failed", error: { code: "provider_error", message: "" } }} />);
    const step = document.querySelector(".progress li[aria-current=step]") as HTMLElement;
    expect(step.dataset.state).toBe("failed");
    expect(step.textContent).toBe("DebateStopped");
  });

  it("stops the writing marks while the connection is down, and offers to reconnect at once", () => {
    const onReconnect = vi.fn();
    render(<Page session={debating()} live={critique} connected={false} onReconnect={onReconnect} />);
    expect(document.querySelector(".transcript")?.getAttribute("data-stale")).toBe("true");
    expect((document.querySelector(".debate-progress") as HTMLElement).textContent).toBe("Round 1 of 1: critiques");
    expect((document.querySelector(".connection-banner") as HTMLElement).textContent).toContain("Connection lost. Reconnecting…");
    fireEvent.click(screen.getByRole("button", { name: "Reconnect now" }));
    expect(onReconnect).toHaveBeenCalledOnce();
  });
});

describe("the announcements of a running debate", () => {
  const critique = { "critique:A": { task: "critique", seat: "A", text: "Option B" } } as LiveSpeech;

  it("are not repeated after a reconnection, and the step found again is not news", async () => {
    const view = render(<Page session={debating()} />);
    const said = listen();
    view.rerender(<Page session={debating()} live={critique} />);
    await flush();
    // The stream drops, then opens again: nothing is written for a moment (live cleared), then the critique resumes.
    view.rerender(<Page session={debating()} live={critique} connected={false} />);
    await flush();
    view.rerender(<Page session={{ ...debating() }} live={{}} />);
    await flush();
    expect((document.querySelector(".debate-progress-step") as HTMLElement).textContent).toBe("Round 1 of 1: critiques");
    view.rerender(<Page session={{ ...debating() }} live={critique} />);
    await flush();
    expect(said).toEqual(["Round 1 of 1: critiques"]);
  });

  it("do not go back to the revisions between the arbiter's last word and its saved verdict", async () => {
    const view = render(<Page session={resumed()} live={{ "revision:A": { task: "revision", seat: "A", text: "" } } as LiveSpeech} />);
    const said = listen();
    const revised = { ...resumed(), debate: complete.debate.filter((entry) => entry.kind !== "verdict") };
    view.rerender(<Page session={revised} live={{ "verdict:-": { task: "verdict", seat: null, text: "" } } as LiveSpeech} />);
    await flush();
    // "spoke" arrives before the session with the verdict: nobody writes, the record still ends on the revisions.
    view.rerender(<Page session={revised} live={{}} />);
    await flush();
    expect((document.querySelector(".debate-progress-step") as HTMLElement).textContent).toBe("Verdict");
    const tab = screen.getByRole("tab", { name: "Debate" });
    tab.focus();
    view.rerender(<Page session={complete} />);
    await flush();
    expect(said).toEqual(["Verdict", "The verdict is ready"]);
  });

  it("say a second question again, even in the same words", async () => {
    const view = render(<Page session={debating()} />);
    screen.getByRole("tab", { name: "Debate" }).focus();
    const said = listen();
    view.rerender(<Page session={awaiting} />);
    await flush();
    view.rerender(<Page session={resumed()} />);
    await flush();
    view.rerender(<Page session={awaiting} />);
    await flush();
    expect(said.filter((text) => text === "The debate is waiting for your answer")).toHaveLength(2);
  });
});

describe("a debate waiting for its author, seen by a reader", () => {
  it("keeps the step named Debate and says whose answer it waits for, with no banner nor counter", () => {
    render(
      <AccessContext.Provider value={{ ...FULL_ACCESS, mine: false, canEdit: false }}>
        <SessionBody session={awaiting} live={{}} connected />
      </AccessContext.Provider>,
    );
    const step = document.querySelector(".progress li[aria-current=step]") as HTMLElement;
    expect(step.textContent).toBe("Debate");
    expect(step.dataset.state).toBe("current");
    expect((document.querySelector(".debate-progress") as HTMLElement).textContent).toBe("The debate is waiting for its author's answer");
    expect(screen.queryByRole("button", { name: "Answer now" })).toBeNull();
    expect(document.title).toBe("Studio booking app · Quorumind");
  });

  it("says nothing of whose answer it is until the server said who may answer", () => {
    render(
      <AccessContext.Provider value={{ ...FULL_ACCESS, canEdit: false }}>
        <SessionBody session={awaiting} live={{}} connected accessKnown={false} />
      </AccessContext.Provider>,
    );
    expect(document.querySelector(".debate-progress")).toBeNull();
  });
});

describe("a session that stopped", () => {
  it("is said once, by its alert: the focus, fallen with the page's running controls, goes to Retry, not onto the alert", () => {
    const view = render(<Page session={debating()} />);
    view.rerender(<Page session={{ ...debating(), phase: "failed", error: { code: "provider_error", message: "" } }} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("The debate stopped");
    expect(focused()).not.toBe(alert);
    expect(focused().tagName).toBe("BUTTON");
    expect(focused().textContent).toBe("Retry from where it stopped");
    expect(announced()).toBe("");
  });

  it("names the cap reached and what was spent", () => {
    render(
      <Page
        session={{
          ...debating(),
          phase: "failed",
          budgetUsd: 0.5,
          error: { code: "budget_exceeded", message: "", params: { spentUsd: 0.4812, budgetUsd: 0.5 } },
        }}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("The cost cap of $0.50 is reached: $0.481 spent.");
    expect(alert.textContent).toContain("Raise it to resume the debate where it stopped.");
  });

  it("names the role and the step whose model failed", () => {
    render(
      <Page
        session={{
          ...debating(),
          phase: "failed",
          error: {
            code: "provider_unavailable",
            message: "",
            params: { provider: "openai", model: "gpt-5-mini", task: "critique", seat: "B" },
          },
        }}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("Debater B, Round 1 of 1: critiques (openai · gpt-5-mini)");
  });
});

describe("the end of the transcript", () => {
  it("offers a pill to what was written out of sight, and never scrolls by itself", () => {
    let report: ((entries: { isIntersecting: boolean; boundingClientRect: { top: number } }[]) => void) | null = null;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: typeof report) {
          report = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    const view = render(<Page session={debating()} />);
    act(() => report?.([{ isIntersecting: false, boundingClientRect: { top: 2000 } }]));
    expect(screen.queryByRole("button", { name: /New below/ })).toBeNull();
    view.rerender(<Page session={debating()} live={{ "critique:A": { task: "critique", seat: "A", text: "Option B" } }} />);
    expect(scroll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "New below: Debater A writing" }));
    expect(scroll).toHaveBeenCalledOnce();
    expect(focused().classList.contains("message")).toBe(true);
  });
});
