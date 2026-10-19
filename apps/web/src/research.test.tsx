/** @vitest-environment happy-dom */
import "./test/dom.ts";
import { DEMO_LINEUP, type ResearchSection } from "@quorumind/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ResearchFacts } from "./components/Sources.tsx";
import { NewSession } from "./NewSession.tsx";
import { json, stubApi } from "./test/dom.ts";

const section = (url: string): ResearchSection =>
  ({
    date: "1 October 2026",
    engine: "Brave",
    facts: [{ fact: "Stripe charges 1.5% in the EU.", refs: [1] }],
    sources: [{ id: "S1", number: 1, url, title: "Stripe pricing", retrievedAt: "2026-10-01T00:00:00.000Z" }],
  }) as unknown as ResearchSection;

describe("the sources of the web research", () => {
  it("links a web page, and shows anything else as text", () => {
    render(<ResearchFacts section={section("https://stripe.com/pricing")} />);
    expect(screen.getByRole("link", { name: /Stripe pricing/ }).getAttribute("href")).toBe("https://stripe.com/pricing");
    expect(screen.getByText(/stripe\.com ·/)).toBeTruthy();
  });

  it("never turns a script address into a link, and does not break on an address it cannot read", () => {
    render(
      <>
        <ResearchFacts section={section("javascript:alert(1)")} />
        <ResearchFacts section={section("not a url")} />
      </>,
    );
    expect(screen.queryByRole("link", { name: /Stripe pricing/ })).toBeNull();
    expect(screen.getAllByText("Stripe pricing")).toHaveLength(2);
  });

  it("gives each panel's heading an id of its own", () => {
    render(
      <>
        <ResearchFacts section={section("https://a.example")} />
        <ResearchFacts section={section("https://b.example")} />
      </>,
    );
    const headings = screen.getAllByRole("heading", { name: "Web research" });
    expect(new Set(headings.map((heading) => heading.id)).size).toBe(2);
    expect(screen.getAllByRole("region", { name: "Web research" })).toHaveLength(2);
  });
});

describe("the web research option of a new session", () => {
  const config = {
    catalog: [{ provider: "mock", model: "mock", label: "Demo", local: false }],
    live: { lineup: DEMO_LINEUP, estimateUsd: null },
    demo: { lineup: DEMO_LINEUP, idea: "" },
    templates: [],
    personas: [],
    localOnly: false,
    notifications: false,
    retentionDays: null,
    maxBudgetUsd: null,
    providerCosts: true,
    research: { kind: "brave", default: true },
  };

  it("is left to the server's default until the person changes it", async () => {
    const { calls } = stubApi({
      "GET /api/config": () => json(config),
      "POST /api/estimate": () => json({ estimateUsd: null, price: null, research: { default: true } }),
      "POST /api/sessions": () => json({ session: { id: "new" } }),
      "GET /api/sessions": () => json({ sessions: [] }),
    });
    render(<NewSession />);
    fireEvent.change(await screen.findByLabelText("Your project idea"), { target: { value: "A booking app" } });
    await waitFor(() => expect(calls.some((call) => call.path === "/api/estimate")).toBe(true));
    expect(calls.find((call) => call.path === "/api/estimate")?.body).not.toHaveProperty("webResearch");
    fireEvent.click(screen.getByRole("button", { name: /Start the interview/ }));
    await waitFor(() => expect(calls.some((call) => call.method === "POST" && call.path === "/api/sessions")).toBe(true));
    expect(calls.find((call) => call.method === "POST" && call.path === "/api/sessions")?.body).not.toHaveProperty("webResearch");
  });
});
