/** @vitest-environment happy-dom */
import "./test/dom.ts";
import type { Lineup } from "@quorumind/core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { NewSession } from "./NewSession.tsx";
import { json, stubApi } from "./test/dom.ts";

const lineup: Lineup = {
  interviewer: { provider: "anthropic", model: "claude-sonnet-5-5" },
  arbiter: { provider: "anthropic", model: "claude-opus-5-5" },
  seats: {
    A: { provider: "anthropic", model: "claude-opus-5-5", persona: null },
    B: { provider: "openrouter", model: "mistralai/mistral-small-3", persona: null },
  },
  devil: null,
};

const config = {
  catalog: [
    { provider: "anthropic", model: "claude-opus-5-5", label: "Claude Opus 5.5", local: false },
    { provider: "anthropic", model: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", local: false },
    { provider: "openrouter", model: "mistralai/mistral-small-3", label: "Mistral Small 3", maker: "Mistral AI", local: false },
  ],
  live: { lineup, estimateUsd: null },
  demo: { lineup, idea: "" },
  templates: ["saas"],
  complianceTemplates: ["personal_data"],
  personas: ["security"],
  localOnly: false,
  notifications: true,
  retentionDays: null,
  maxBudgetUsd: null,
  providerCosts: true,
};

function stub() {
  return stubApi({
    "GET /api/config": () => json(config),
    "GET /api/profile": () => json({ profile: null }),
    "POST /api/estimate": () => json({ estimateUsd: { low: 0.2, high: 0.6 }, price: null }),
    "POST /api/sessions": () => json({ session: { id: "new" } }),
    "GET /api/sessions": () => json({ sessions: [] }),
  });
}

const next = () => screen.getByRole("button", { name: /Next/ });
const created = (calls: { method: string; path: string; body: unknown }[]) =>
  calls.find((call) => call.method === "POST" && call.path === "/api/sessions")?.body as Record<string, unknown> | undefined;

describe("a new session, step by step", () => {
  beforeEach(() => sessionStorage.clear());

  it("goes on once the need is described, says what is missing until then, and moves the focus to each step", async () => {
    stub();
    render(<NewSession />);
    const idea = await screen.findByLabelText("Your project idea");
    // The button stays active: sending it says what is missing under the field and puts the focus there.
    expect(next()).toHaveProperty("disabled", false);
    fireEvent.click(next());
    expect(idea.getAttribute("aria-invalid")).toBe("true");
    expect(idea.getAttribute("aria-describedby")).toContain("idea-error");
    expect(document.getElementById("idea-error")?.textContent).toBe("Describe your project to continue.");
    expect(document.activeElement).toBe(idea);
    fireEvent.change(idea, { target: { value: "A booking app" } });
    expect(idea.getAttribute("aria-invalid")).toBeNull();
    fireEvent.click(next());
    const heading = screen.getByRole("heading", { level: 2, name: "Context" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(
      screen.getByRole("navigation", { name: "Steps of the new debate" }).querySelector("[aria-current='step']")?.textContent,
    ).toContain("Context");
    // Back to the first step: what was typed is still there.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect((screen.getByLabelText("Your project idea") as HTMLTextAreaElement).value).toBe("A booking app");
  });

  it("asks for the solution to challenge before going on", async () => {
    stub();
    render(<NewSession />);
    fireEvent.change(await screen.findByLabelText("Your project idea"), { target: { value: "A booking app" } });
    fireEvent.click(screen.getByRole("radio", { name: /Challenge my idea/ }));
    fireEvent.click(next());
    const solution = screen.getByLabelText("Your solution");
    expect(solution.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById("solution-error")?.textContent).toBe("Describe your solution to continue.");
    expect(document.activeElement).toBe(solution);
    fireEvent.change(solution, { target: { value: "Next.js and Postgres" } });
    fireEvent.click(next());
    expect(screen.getByRole("heading", { level: 2, name: "Context" })).toBeTruthy();
  });

  it("starts at once with the defaults from the first step", async () => {
    const { calls } = stub();
    render(<NewSession />);
    fireEvent.change(await screen.findByLabelText("Your project idea"), { target: { value: "A booking app" } });
    fireEvent.click(screen.getByRole("button", { name: "Start now" }));
    await waitFor(() => expect(created(calls)).toBeDefined());
    expect(created(calls)).toMatchObject({ idea: "A booking app", mode: "standard", lineup, rounds: 1, depth: "standard", redact: false });
  });

  it("changes the panel in its cards, the rounds and the options, and sends them", async () => {
    const { calls } = stub();
    render(<NewSession />);
    fireEvent.change(await screen.findByLabelText("Your project idea"), { target: { value: "A booking app" } });
    fireEvent.click(next());
    fireEvent.click(next());

    // The panel at a glance, then its cards.
    expect(screen.getByRole("heading", { level: 2, name: "The panel" })).toBeTruthy();
    const customise = screen.getByRole("button", { name: "Customise the panel" });
    expect(customise.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(customise);
    fireEvent.click(screen.getByRole("button", { name: "Add a debater" }));
    const third = screen.getByRole("region", { name: "Debater C" });
    fireEvent.change(within(third).getByLabelText("Expert role"), { target: { value: "__custom" } });
    fireEvent.change(within(third).getByLabelText("Describe the expert role"), { target: { value: "a payments specialist" } });
    fireEvent.click(screen.getByRole("switch", { name: "Devil's advocate" }));
    fireEvent.click(screen.getByRole("radio", { name: /Two rounds/ }));
    fireEvent.click(next());

    // The summary: the options as switches, a way back to each step, the estimate by the button.
    expect(screen.getByRole("heading", { level: 2, name: "Summary" })).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Mask personal data" }));
    expect(screen.getByRole("button", { name: "Change: The panel" })).toBeTruthy();
    await screen.findByText(/A debate costs about/);
    fireEvent.click(screen.getByRole("button", { name: /Start the interview/ }));
    await waitFor(() => expect(created(calls)).toBeDefined());
    const body = created(calls) as { lineup: Lineup; rounds: number; redact: boolean };
    expect(body.rounds).toBe(2);
    expect(body.redact).toBe(true);
    expect(body.lineup.seats.C).toMatchObject({ persona: "a payments specialist" });
    expect(body.lineup.devil).toMatchObject({ provider: "anthropic", model: "claude-opus-5-5" });
  });

  it("hides the project kind in the audit mode, and says Express has a single round", async () => {
    stub();
    render(<NewSession />);
    await screen.findByLabelText("Your project idea");
    // Compare solutions asks for a kind of project; the audit starts from the document and does not.
    expect(await screen.findByText("Kind of project")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Audit a document/ }));
    expect(screen.queryByText("Kind of project")).toBeNull();
    expect(document.getElementById("launch-now-hint")?.textContent).toBe("Skips the next steps: the default panel and options.");
    fireEvent.click(screen.getByRole("radio", { name: /Express/ }));
    expect(await screen.findByText("Kind of project")).toBeTruthy();
    expect(document.getElementById("launch-now-hint")?.textContent).toContain("no documents");
    fireEvent.change(screen.getByLabelText("Your project idea"), { target: { value: "A booking app" } });
    fireEvent.click(next());
    fireEvent.click(next());
    // The rounds are not offered, and the page says why.
    expect(screen.queryByRole("radio", { name: /Two rounds/ })).toBeNull();
    expect(screen.getByText("Express: a single round, nothing to choose.")).toBeTruthy();
  });

  it("closes the panel editor with Done, at its top or at its end, the focus going back to the button that opened it", async () => {
    stub();
    render(<NewSession />);
    fireEvent.change(await screen.findByLabelText("Your project idea"), { target: { value: "A booking app" } });
    fireEvent.click(next());
    fireEvent.click(next());
    fireEvent.click(screen.getByRole("button", { name: "Customise the panel" }));
    const done = screen.getAllByRole("button", { name: "Done" });
    expect(done).toHaveLength(2);
    expect(done[0]?.getAttribute("aria-expanded")).toBe("true");
    // Never a second "Back" with another meaning than the step's own.
    expect(screen.getAllByRole("button", { name: /Back/ })).toHaveLength(1);
    fireEvent.click(done[1] as HTMLElement);
    const toggle = screen.getByRole("button", { name: "Customise the panel" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
  });

  it("opens a step already done from the stepper, and keeps the choices for a reload", async () => {
    stub();
    const view = render(<NewSession />);
    fireEvent.change(await screen.findByLabelText("Your project idea"), { target: { value: "A booking app" } });
    fireEvent.click(next());
    fireEvent.click(next());
    fireEvent.click(screen.getByRole("radio", { name: /Deep/ }));
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: /Your need/ }));
    expect(screen.getByRole("heading", { level: 2, name: "Your need" })).toBeTruthy();
    view.unmount();

    stub();
    render(<NewSession />);
    expect(((await screen.findByLabelText("Your project idea")) as HTMLTextAreaElement).value).toBe("A booking app");
    fireEvent.click(next());
    fireEvent.click(next());
    expect(screen.getByRole("radio", { name: /Deep/ })).toHaveProperty("checked", true);
  });
});

describe("the cost cap", () => {
  beforeEach(() => sessionStorage.clear());

  async function toSummary() {
    const view = stub();
    render(<NewSession />);
    fireEvent.change(await screen.findByLabelText("Your project idea"), { target: { value: "A booking app" } });
    fireEvent.click(next());
    fireEvent.click(next());
    fireEvent.click(next());
    return view;
  }

  it.each(["-5", "0", "99999", "0.1"])("refuses %s, says why next to the field and does not start", async (value) => {
    const { calls } = await toSummary();
    const field = (await screen.findByLabelText("Cost cap (USD)")) as HTMLInputElement;
    fireEvent.change(field, { target: { value } });
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Enter an amount between $0.50 and $1,000.")).toBeTruthy();
    expect(field.getAttribute("aria-describedby")).toContain("budget-error");
    const start = screen.getByRole("button", { name: /Start the interview/ });
    expect(start).toHaveProperty("disabled", true);
    fireEvent.click(start);
    expect(created(calls)).toBeUndefined();
  });

  it("sends a valid cap, and no cap when the field is empty", async () => {
    const { calls } = await toSummary();
    const field = (await screen.findByLabelText("Cost cap (USD)")) as HTMLInputElement;
    expect(field.getAttribute("aria-invalid")).toBeNull();
    fireEvent.change(field, { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: /Start the interview/ }));
    await waitFor(() => expect(created(calls)).toMatchObject({ budgetUsd: 12 }));
  });

  it("drops an invalid cap kept by an earlier visit, so that Start now is not disabled without a reason", async () => {
    sessionStorage.setItem("quorumind.newSession", JSON.stringify({ idea: "A booking app", budget: "-5" }));
    stub();
    render(<NewSession />);
    await screen.findByLabelText("Your project idea");
    expect(screen.getByRole("button", { name: "Start now" })).toHaveProperty("disabled", false);
  });

  it("does not read text the browser cannot parse as an empty field", async () => {
    const { calls } = await toSummary();
    const field = (await screen.findByLabelText("Cost cap (USD)")) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "5" } });
    // What a browser's number field holds for "1e": no value, but bad input.
    Object.defineProperty(field, "validity", { value: { badInput: true }, configurable: true });
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.input(field);
    expect(field.getAttribute("aria-invalid")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /Start the interview/ }));
    expect(created(calls)).toBeUndefined();
  });

  it("leads with the recorded demo when no key is configured, and folds the unusable form", async () => {
    const { calls } = stubApi({
      "GET /api/config": () => json({ ...config, live: null }),
      "GET /api/profile": () => json({ profile: null }),
      "POST /api/sessions": () => json({ session: { id: "new" } }),
      "GET /api/sessions": () => json({ sessions: [] }),
    });
    const { container } = render(<NewSession />);
    expect(await screen.findByRole("heading", { level: 2, name: "Watch a complete debate, recorded" })).toBeTruthy();
    // No "Step 1 of 4" without the stepper, the form is folded, and the demo is not repeated at the bottom.
    expect(screen.queryByText(/Step \d of 4/)).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Steps of the new debate" })).toBeNull();
    expect(container.querySelector("details.disclosure")?.hasAttribute("open")).toBe(false);
    expect(screen.getAllByRole("button", { name: "Replay the recorded demo" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Replay the recorded demo" }));
    // Waiting label and aria-busy while the request is on its way.
    expect((await screen.findByRole("button", { name: /Starting/ })).getAttribute("aria-busy")).toBe("true");
    await waitFor(() => expect(created(calls)).toMatchObject({ demo: true }));
  });

  const zeroEstimate = (configOverride: Record<string, unknown>) => {
    stubApi({
      "GET /api/config": () => json({ ...config, ...configOverride }),
      "GET /api/profile": () => json({ profile: null }),
      "POST /api/estimate": () => json({ estimateUsd: { low: 0, high: 0 }, price: null }),
      "GET /api/sessions": () => json({ sessions: [] }),
    });
  };
  const toPrice = async () => {
    render(<NewSession />);
    fireEvent.change(await screen.findByLabelText("Your project idea"), { target: { value: "A booking app" } });
    for (let step = 0; step < 3; step++) fireEvent.click(next());
  };
  const everyone = (provider: string, model: string) => ({
    interviewer: { provider, model },
    arbiter: { provider, model },
    seats: { A: { provider, model, persona: null }, B: { provider, model, persona: null } },
    devil: null,
  });

  it("says the estimate is free when the demo model is the whole panel", async () => {
    const demo = everyone("mock", "mock");
    zeroEstimate({
      catalog: [{ provider: "mock", model: "mock", label: "Demo", local: false }],
      live: { lineup: demo, estimateUsd: null },
    });
    await toPrice();
    expect(await screen.findByText("Free: demo model.")).toBeTruthy();
    expect(screen.queryByText(/costs about/)).toBeNull();
  });

  it("says local models cost no API fees instead of calling them the demo model", async () => {
    const local = everyone("ollama", "llama3");
    zeroEstimate({
      catalog: [{ provider: "ollama", model: "llama3", label: "Llama 3", local: true }],
      live: { lineup: local, estimateUsd: null },
    });
    await toPrice();
    expect(await screen.findByText("No API cost: local models.")).toBeTruthy();
    expect(screen.queryByText(/demo model/)).toBeNull();
  });
});
