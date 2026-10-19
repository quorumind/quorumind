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
    expect(next()).toHaveProperty("disabled", true);
    expect(screen.getByText("Describe your project to continue.")).toBeTruthy();
    fireEvent.change(idea, { target: { value: "A booking app" } });
    expect(next()).toHaveProperty("disabled", false);
    fireEvent.click(next());
    const heading = screen.getByRole("heading", { level: 2, name: "Context" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(
      screen.getByRole("navigation", { name: "Steps of the new session" }).querySelector("[aria-current='step']")?.textContent,
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
    expect(next()).toHaveProperty("disabled", true);
    expect(screen.getByText("Describe your solution to continue.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Your solution"), { target: { value: "Next.js and Postgres" } });
    expect(next()).toHaveProperty("disabled", false);
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
    const third = screen.getByRole("region", { name: "Proposer C" });
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
