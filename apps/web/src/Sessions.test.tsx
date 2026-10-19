/** @vitest-environment happy-dom */
import "./test/dom.ts";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App.tsx";
import type { HostNavigation, SessionSummary } from "./api.ts";
import { json, PAGE_TIMEOUT, stubApi } from "./test/dom.ts";

const config = (navigation: HostNavigation | null = null) =>
  json({
    catalog: [],
    live: null,
    demo: { lineup: null, idea: "" },
    templates: [],
    personas: [],
    localOnly: false,
    providerCosts: true,
    navigation,
  });

const HOSTED: HostNavigation = {
  workspaces: null,
  links: [{ kind: "home", url: "/account/#/" }],
  user: { name: null, email: "ada@example.com" },
  siteUrl: null,
};

const session = (id: string, idea: string, extra: Partial<SessionSummary> = {}): SessionSummary => ({
  id,
  idea,
  phase: "complete",
  updatedAt: "2026-10-01T10:00:00.000Z",
  ...extra,
});

const HISTORY = [
  session("s1", "Équipe de réservation pour 12 studios", { phase: "awaiting_answers", mine: true, private: true }),
  session("s2", "A client portal for architects", { mine: false, author: { name: "Max", email: "max@example.com" } }),
  session("s3", "Move the invoicing to a European platform", { mine: false, author: null }),
];

function open(sessions: SessionSummary[], options: { shared?: boolean; navigation?: HostNavigation | null } = {}) {
  const api = stubApi({
    "GET /api/sessions": ({ url }) =>
      json({ sessions: url.searchParams.get("mine") ? sessions.filter((item) => item.mine) : sessions, shared: options.shared ?? false }),
    "GET /api/config": () => config(options.navigation ?? null),
  });
  window.location.hash = "#/sessions";
  render(<App />);
  return api;
}

const rows = () =>
  within(screen.getByRole("main"))
    .queryAllByRole("listitem")
    .map((item) => [
      item.querySelector(".sessions-row-title")?.textContent,
      item.querySelector(".sessions-phase")?.textContent,
      item.querySelector("time")?.textContent,
      item.querySelector(".sessions-row-author")?.textContent ?? null,
      item.querySelector("a")?.getAttribute("href"),
    ]);

afterEach(() => {
  localStorage.clear();
});

describe("the sessions page", () => {
  it("lists every session with its status and date, and who started the others' in a shared history", async () => {
    open(HISTORY, { shared: true });
    await screen.findByRole("heading", { level: 1, name: "Sessions" }, { timeout: PAGE_TIMEOUT });
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(rows()).toEqual([
      ["PrivateÉquipe de réservation pour 12 studios", "Your input", "Oct 1, 2026", null, "#/s/s1"],
      ["A client portal for architects", "Verdict", "Oct 1, 2026", "Max", "#/s/s2"],
      ["Move the invoicing to a European platform", "Verdict", "Oct 1, 2026", "Former member", "#/s/s3"],
    ]);
    expect(screen.getByRole("main").querySelector(".history-filter")).not.toBeNull();
    expect(within(screen.getByRole("main")).getByRole("link", { name: "New session" }).getAttribute("href")).toBe("#/");
  });

  it("finds sessions by their title, whatever the accents and the case, and says when none matches", async () => {
    open(HISTORY);
    const search = await screen.findByRole("searchbox", { name: "Search by title" }, { timeout: PAGE_TIMEOUT });
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(screen.getByRole("main").querySelector(".history-filter")).toBeNull();
    fireEvent.change(search, { target: { value: "equipe" } });
    expect(rows().map((row) => row[4])).toEqual(["#/s/s1"]);
    expect(screen.getByRole("status").textContent).toBe("Results: 1");
    fireEvent.change(search, { target: { value: "nothing like it" } });
    expect(rows()).toEqual([]);
    expect(screen.getByText("Nothing matches this search.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear the search" }));
    expect(rows()).toHaveLength(3);
  });

  it("shows only the person's own sessions when asked, in a shared history", async () => {
    const { calls } = open(HISTORY, { shared: true });
    const mine = await screen.findByRole("button", { name: "Mine" }, { timeout: PAGE_TIMEOUT });
    fireEvent.click(mine);
    await waitFor(() => expect(rows().map((row) => row[4])).toEqual(["#/s/s1"]));
    expect(calls.some((call) => call.path === "/api/sessions" && call.method === "GET")).toBe(true);
  });

  it("invites to start one when the history is empty", async () => {
    open([]);
    await screen.findByText("No session yet. Start one to see it here.", undefined, { timeout: PAGE_TIMEOUT });
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(within(screen.getByRole("main")).getAllByRole("link", { name: "New session" })).toHaveLength(2);
  });

  it("is named the debates on a hosted service, as in its menu", async () => {
    open(HISTORY, { navigation: HOSTED });
    await screen.findByRole("heading", { level: 1, name: "Debates" }, { timeout: PAGE_TIMEOUT });
    expect(within(screen.getByRole("main")).getByRole("link", { name: "New debate" })).toBeTruthy();
    expect(
      within(document.getElementById("sidebar") as HTMLElement)
        .getByRole("link", { name: "All debates" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });
});
