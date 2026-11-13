/** @vitest-environment happy-dom */
import "./test/dom.ts";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

const folded = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();

/** The server's paging, as far as the page needs it: a cursor is the position of the next entry. */
function open(sessions: SessionSummary[], options: { shared?: boolean; navigation?: HostNavigation | null; pageSize?: number } = {}) {
  const api = stubApi({
    "GET /api/sessions": ({ url }) => {
      const wanted = folded(url.searchParams.get("q") ?? "");
      const all = (url.searchParams.get("mine") ? sessions.filter((item) => item.mine) : sessions).filter((item) =>
        folded(item.idea).includes(wanted),
      );
      const size = options.pageSize ?? 50;
      const from = Number(url.searchParams.get("before") ?? 0);
      const page = all.slice(from, from + size);
      return json({ sessions: page, shared: options.shared ?? false, next: from + size < all.length ? String(from + size) : null });
    },
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
    await screen.findByRole("heading", { level: 1, name: "Debates" }, { timeout: PAGE_TIMEOUT });
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(rows()).toEqual([
      ["PrivateÉquipe de réservation pour 12 studios", "Your input", "Oct 1, 2026", null, "#/s/s1"],
      ["A client portal for architects", "Verdict", "Oct 1, 2026", "Max", "#/s/s2"],
      ["Move the invoicing to a European platform", "Verdict", "Oct 1, 2026", "Former member", "#/s/s3"],
    ]);
    expect(screen.getByRole("main").querySelector(".history-filter")).not.toBeNull();
    expect(within(screen.getByRole("main")).getByRole("link", { name: "New debate" }).getAttribute("href")).toBe("#/");
  });

  it("rings the dot of the person's own sessions that wait for them, not of someone else's", async () => {
    open(
      [
        session("s1", "An interview", { phase: "interview", mine: true }),
        session("s2", "Bob's question", { phase: "awaiting_answers", mine: false, author: { name: "Bob", email: null } }),
        session("s3", "A verdict"),
      ],
      { shared: true },
    );
    await screen.findByRole("heading", { level: 1, name: "Debates" }, { timeout: PAGE_TIMEOUT });
    await waitFor(() => expect(rows()).toHaveLength(3));
    const dots = within(screen.getByRole("main"))
      .queryAllByRole("listitem")
      .map((item) => item.querySelector(".phase-dot")?.hasAttribute("data-yours"));
    expect(dots).toEqual([true, false, false]);
  });

  it("finds sessions by their title, whatever the accents and the case, and says when none matches", async () => {
    open(HISTORY);
    const search = await screen.findByRole("searchbox", { name: "Search by title" }, { timeout: PAGE_TIMEOUT });
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(screen.getByRole("main").querySelector(".history-filter")).toBeNull();
    fireEvent.change(search, { target: { value: "equipe" } });
    await waitFor(() => expect(rows().map((row) => row[4])).toEqual(["#/s/s1"]));
    expect(screen.getByRole("status").textContent).toBe("Results: 1");
    fireEvent.change(search, { target: { value: "nothing like it" } });
    await screen.findByText("Nothing matches this search.");
    expect(rows()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Clear the search" }));
    expect(rows()).toHaveLength(3);
  });

  describe("beyond the first page", () => {
    const MANY = Array.from({ length: 7 }, (_, index) => session(`s${index}`, `Debate number ${index}`));
    const liveStatus = () => screen.getByRole("main").querySelector<HTMLElement>(".show-more [aria-live]");

    it("shows more when asked, keeps the focus on the button while more remain, and says what came", async () => {
      open(MANY, { pageSize: 3 });
      await waitFor(() => expect(rows()).toHaveLength(3), { timeout: PAGE_TIMEOUT });
      const more = screen.getByRole("button", { name: "Show more" });
      more.focus();
      fireEvent.click(more);
      await waitFor(() => expect(rows()).toHaveLength(6));
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Show more" }));
      await waitFor(() => expect(liveStatus()?.textContent).toBe("Shown: 6 (+3)."));
      expect(rows().map((row) => row[4])).toEqual(MANY.slice(0, 6).map((item) => `#/s/${item.id}`));
    });

    it("moves the focus to the first new entry when the last page comes, as the button is gone", async () => {
      open(MANY, { pageSize: 5 });
      await waitFor(() => expect(rows()).toHaveLength(5), { timeout: PAGE_TIMEOUT });
      const more = screen.getByRole("button", { name: "Show more" });
      more.focus();
      fireEvent.click(more);
      await waitFor(() => expect(rows()).toHaveLength(7));
      expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
      await waitFor(() =>
        expect(document.activeElement).toBe(within(screen.getByRole("main")).getByRole("link", { name: /Debate number 5/ })),
      );
      expect(liveStatus()?.textContent).toBe("Shown: 7 (+2).");
    });

    it("does not ask twice while a page is on its way, and does not pull the focus from someone who moved on", async () => {
      const api = open(MANY, { pageSize: 5 });
      await waitFor(() => expect(rows()).toHaveLength(5), { timeout: PAGE_TIMEOUT });
      const search = screen.getByRole("searchbox", { name: "Search by title" });
      const more = screen.getByRole("button", { name: "Show more" });
      fireEvent.click(more);
      fireEvent.click(more);
      search.focus();
      await waitFor(() => expect(rows()).toHaveLength(7));
      expect(api.fetch.mock.calls.filter(([input]) => String(input).includes("before=5"))).toHaveLength(1);
      expect(document.activeElement).toBe(search);
    });

    it("keeps the button and says so when a page fails, and loads it on a new try", async () => {
      let failing = false;
      open(MANY, { pageSize: 5 });
      const original = globalThis.fetch;
      vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
        failing && String(input).includes("before=") ? Promise.reject(new Error("offline")) : original(input, init),
      );
      await waitFor(() => expect(rows()).toHaveLength(5), { timeout: PAGE_TIMEOUT });
      failing = true;
      fireEvent.click(screen.getByRole("button", { name: "Show more" }));
      await screen.findByText("More could not be loaded.");
      expect(rows()).toHaveLength(5);
      failing = false;
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      await waitFor(() => expect(rows()).toHaveLength(7));
      expect(screen.queryByText("More could not be loaded.")).toBeNull();
    });

    it("reads right when exactly one entry comes", async () => {
      open(MANY.slice(0, 6), { pageSize: 5 });
      await waitFor(() => expect(rows()).toHaveLength(5), { timeout: PAGE_TIMEOUT });
      const more = screen.getByRole("button", { name: "Show more" });
      more.focus();
      fireEvent.click(more);
      await waitFor(() => expect(rows()).toHaveLength(6));
      await waitFor(() => expect(liveStatus()?.textContent).toBe("Shown: 6 (+1)."));
    });

    it("announces one load once: in a search the status line says it, not the button's own line", async () => {
      const twelve = Array.from({ length: 12 }, (_, index) => session(`m${index}`, `Match ${index}`));
      open(twelve, { pageSize: 5 });
      const search = await screen.findByRole("searchbox", { name: "Search by title" }, { timeout: PAGE_TIMEOUT });
      fireEvent.change(search, { target: { value: "match" } });
      await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Results so far: 5. The search can go on."));
      fireEvent.click(screen.getByRole("button", { name: "Show more" }));
      await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Results so far: 10. The search can go on."));
      // The other live line stays silent: a screen reader hears the one message.
      expect(liveStatus()?.textContent).toBe("");
      const spoken = [...document.querySelectorAll("[role=status], [aria-live]")].filter((line) => line.textContent !== "");
      expect(spoken).toHaveLength(1);
    });

    it("does not replay a load of the history when a search is cleared", async () => {
      open(MANY, { pageSize: 3 });
      await waitFor(() => expect(rows()).toHaveLength(3), { timeout: PAGE_TIMEOUT });
      const more = screen.getByRole("button", { name: "Show more" });
      more.focus();
      fireEvent.click(more);
      await waitFor(() => expect(liveStatus()?.textContent).toBe("Shown: 6 (+3)."));
      const search = screen.getByRole("searchbox", { name: "Search by title" });
      fireEvent.change(search, { target: { value: "number 1" } });
      await waitFor(() => expect(rows()).toHaveLength(1));
      fireEvent.change(search, { target: { value: "" } });
      await waitFor(() => expect(rows()).toHaveLength(6));
      expect(liveStatus()?.textContent).toBe("");
    });

    it("goes on when a search of a long history stopped before finding anything", async () => {
      open(MANY, { pageSize: 5 });
      await waitFor(() => expect(rows()).toHaveLength(5), { timeout: PAGE_TIMEOUT });
      vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        const found = url.searchParams.get("before") === "scanned";
        return json(
          found
            ? { sessions: [session("deep", "A zeppelin route")], shared: false, next: null }
            : { sessions: [], shared: false, next: "scanned" },
        );
      });
      fireEvent.change(screen.getByRole("searchbox", { name: "Search by title" }), { target: { value: "zeppelin" } });
      // Nothing found yet is not "nothing matches": the search goes on from where it stopped.
      expect(screen.queryByText("Nothing matches this search.")).toBeNull();
      await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Results so far: 0. The search can go on."));
      expect(rows()).toEqual([]);
      const more = screen.getByRole("button", { name: "Show more" });
      more.focus();
      fireEvent.click(more);
      await waitFor(() => expect(rows().map((row) => row[4])).toEqual(["#/s/deep"]));
      // The button the person pressed is the one that stays: the focus goes on to the first match.
      await waitFor(() => expect(document.activeElement).toBe(within(screen.getByRole("main")).getByRole("link", { name: /zeppelin/ })));
    });

    it("does not leave the list busy for good when the first answer of a search fails", async () => {
      open(MANY, { pageSize: 5 });
      await waitFor(() => expect(rows()).toHaveLength(5), { timeout: PAGE_TIMEOUT });
      vi.stubGlobal("fetch", async () => new Response("{}", { status: 500, headers: { "content-type": "application/json" } }));
      fireEvent.change(screen.getByRole("searchbox", { name: "Search by title" }), { target: { value: "zeppelin" } });
      await screen.findByRole("alert", undefined, { timeout: PAGE_TIMEOUT });
      expect(screen.getByRole("list", { name: "Debates" }).hasAttribute("aria-busy")).toBe(false);
    });

    it("moves the focus to the way out when a search that went on ends with nothing", async () => {
      open(MANY, { pageSize: 5 });
      await waitFor(() => expect(rows()).toHaveLength(5), { timeout: PAGE_TIMEOUT });
      vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
        const found = new URL(String(input), "http://localhost").searchParams.get("before") === "scanned";
        return json({ sessions: [], shared: false, next: found ? null : "scanned" });
      });
      fireEvent.change(screen.getByRole("searchbox", { name: "Search by title" }), { target: { value: "zeppelin" } });
      await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Results so far: 0. The search can go on."));
      const more = screen.getByRole("button", { name: "Show more" });
      more.focus();
      fireEvent.click(more);
      await screen.findByText("Nothing matches this search.");
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Clear the search" })));
    });

    it("marks the button busy while a new search loads, so the old one does nothing", async () => {
      open(MANY, { pageSize: 5 });
      await waitFor(() => expect(rows()).toHaveLength(5), { timeout: PAGE_TIMEOUT });
      let release: () => void = () => undefined;
      vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        if (url.searchParams.get("q") === "debate")
          return Promise.resolve(json({ sessions: MANY.slice(0, 5), shared: false, next: "more" }));
        return new Promise<Response>((resolve) => {
          release = () => resolve(json({ sessions: MANY.slice(0, 5), shared: false, next: "more" }));
        });
      });
      const search = screen.getByRole("searchbox", { name: "Search by title" });
      fireEvent.change(search, { target: { value: "debate" } });
      // The first answer: the page showed the history meanwhile.
      await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Results so far: 5. The search can go on."));
      // A new query: the previous results stay, and their button waits for the new first page.
      fireEvent.change(search, { target: { value: "debate n" } });
      await waitFor(() => expect(screen.getByRole("button", { name: "Show more" }).getAttribute("aria-busy")).toBe("true"));
      expect(screen.getByRole("button", { name: "Show more" }).getAttribute("aria-disabled")).toBe("true");
      release();
      await waitFor(() => expect(screen.getByRole("button", { name: "Show more" }).getAttribute("aria-busy")).toBe("false"));
    });

    it("searches the whole history on the server, and pages the matches", async () => {
      const old = [...MANY, session("old", "A zeppelin route"), session("old2", "Zeppelin cargo")];
      const api = open(old, { pageSize: 5 });
      const search = await screen.findByRole("searchbox", { name: "Search by title" }, { timeout: PAGE_TIMEOUT });
      await waitFor(() => expect(rows()).toHaveLength(5));
      fireEvent.change(search, { target: { value: "ZEPPELIN" } });
      await waitFor(() => expect(rows().map((row) => row[4])).toEqual(["#/s/old", "#/s/old2"]));
      expect(api.fetch.mock.calls.some(([input]) => String(input).includes("q=ZEPPELIN"))).toBe(true);
      expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
      expect(screen.getByRole("status").textContent).toBe("Results: 2");
      // With more to load, the line says it.
      fireEvent.change(search, { target: { value: "e" } });
      await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Results so far: 5. The search can go on."));
      expect(screen.getByRole("button", { name: "Show more" })).toBeTruthy();
    });
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
    await screen.findByText("No debate yet. Start one to see it here.", undefined, { timeout: PAGE_TIMEOUT });
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(within(screen.getByRole("main")).getAllByRole("link", { name: "New debate" })).toHaveLength(2);
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
