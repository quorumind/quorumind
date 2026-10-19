/** @vitest-environment happy-dom */
import "./test/dom.ts";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import type { HostNavigation } from "./api.ts";
import { failure, json, stubApi } from "./test/dom.ts";

const config = (navigation?: HostNavigation | null) =>
  json({
    catalog: [],
    live: null,
    demo: { lineup: null, idea: "" },
    templates: [],
    personas: [],
    localOnly: false,
    providerCosts: true,
    ...(navigation === undefined ? {} : { navigation }),
  });

const sessions = {
  sessions: [{ id: "s1", idea: "A booking app", phase: "complete", updatedAt: "2026-10-01T10:00:00.000Z", mine: true, private: false }],
  shared: true,
};

const HOSTED: HostNavigation = {
  workspaces: {
    list: [
      { name: "Atelier Nord", role: "owner", current: true, switchUrl: "/api/host/workspaces/w1/switch" },
      { name: "Studio Sud", role: "member", current: false, switchUrl: "/api/host/workspaces/w2/switch" },
    ],
    createUrl: "https://app.example.com/account/#/workspaces/new",
  },
  links: [
    { kind: "home", url: "https://app.example.com/account/#/" },
    { kind: "billing", url: "https://app.example.com/account/#/billing" },
    { kind: "members", url: "https://app.example.com/account/#/members" },
    { kind: "profile", url: "https://app.example.com/account/#/profile" },
    { kind: "account", url: "https://app.example.com/account/#/account" },
  ],
  user: { name: "Ada Lovelace", email: "ada@example.com" },
  siteUrl: "https://www.example.com",
};

function stub(navigation?: HostNavigation | null, extra: Parameters<typeof stubApi>[0] = {}) {
  return stubApi({
    "GET /api/sessions": () => json(sessions),
    "GET /api/config": () => config(navigation),
    "GET /api/decisions": () => json({ decisions: [], authors: [], shared: false }),
    ...extra,
  });
}

const sidebar = () => within(document.getElementById("sidebar") as HTMLElement);
const links = (name: string) =>
  Array.from(sidebar().getByRole("navigation", { name }).querySelectorAll<HTMLAnchorElement>("a"), (link) => [
    link.textContent,
    link.getAttribute("href"),
  ]);

afterEach(() => {
  localStorage.clear();
});

describe("the menu, self-hosted", () => {
  it("has the app's pages on top, the latest sessions under them, and its foot at the bottom", async () => {
    stub();
    window.location.hash = "#/decisions";
    render(<App />);
    await waitFor(() => expect(localStorage.getItem("quorumind.hostMenu")).toBeNull());
    expect(sidebar().getByRole("link", { name: "New session" })).toBeTruthy();
    expect(links("Main menu")).toEqual([
      ["Sessions", "#/sessions"],
      ["Decisions", "#/decisions"],
      ["Gallery", "#/gallery"],
      ["Settings", "#/settings"],
    ]);
    expect(sidebar().getByRole("link", { name: "Decisions" }).getAttribute("aria-current")).toBe("page");
    const list = await sidebar().findByRole("list", { name: "Recent sessions" });
    expect(Array.from(list.querySelectorAll("a"), (link) => link.getAttribute("href"))).toEqual(["#/s/s1"]);
    // The state and the day are said with the title.
    expect(
      within(list)
        .getByRole("link", { name: /^A booking app\W+Verdict\W+Oct 1$/ })
        .getAttribute("aria-current"),
    ).toBeNull();
    expect(links("Recent")).toEqual([
      ["A booking app, Verdict, Oct 1", "#/s/s1"],
      ["See all sessions", "#/sessions"],
    ]);
    expect(
      sidebar()
        .getAllByRole("heading")
        .map((heading) => heading.textContent),
    ).toEqual(["Recent"]);
    expect(sidebar().queryByRole("button", { name: /Workspace/ })).toBeNull();
  });

  it("stays so when the server sends no host menu", async () => {
    const { calls } = stub(null);
    render(<App />);
    await waitFor(() => expect(calls.some((call) => call.path === "/api/config")).toBe(true));
    await waitFor(() => expect(sidebar().queryByRole("link", { name: "New debate" })).toBeNull());
    expect(sidebar().getByRole("link", { name: "Sessions" }).getAttribute("href")).toBe("#/sessions");
    expect(sidebar().queryByRole("heading", { name: "Workspace and account" })).toBeNull();
  });
});

describe("the latest sessions in the menu", () => {
  const many = Array.from({ length: 20 }, (_, index) => ({
    id: `s${index + 1}`,
    idea: `Idea ${index + 1}`,
    phase: index === 0 ? "debating" : "complete",
    updatedAt: new Date(Date.UTC(2026, 9, 20 - index, 10)).toISOString(),
  }));

  it("lists the fifteen latest, the one shown marked, then leads to all of them", async () => {
    stub(undefined, {
      "GET /api/sessions": () => json({ sessions: many, shared: false }),
      "GET /api/sessions/s3": () => failure(404, "not_found"),
    });
    window.location.hash = "#/s/s3";
    render(<App />);
    const list = await sidebar().findByRole("list", { name: "Recent sessions" });
    const rows = within(list).getAllByRole("link");
    expect(rows).toHaveLength(15);
    expect(rows[0]?.textContent).toContain("Idea 1");
    expect(rows.at(-1)?.textContent).toContain("Idea 15");
    expect(rows.filter((row) => row.getAttribute("aria-current") === "page").map((row) => row.getAttribute("href"))).toEqual(["#/s/s3"]);
    // The full title on hover, as the line cuts it short.
    expect(rows[2]?.getAttribute("title")).toBe("Idea 3");
    expect(sidebar().getByRole("link", { name: "See all sessions" }).getAttribute("href")).toBe("#/sessions");
  });

  it("says so in a short line when there is none yet", async () => {
    stub(undefined, { "GET /api/sessions": () => json({ sessions: [], shared: false }) });
    render(<App />);
    expect(await sidebar().findByText("No session yet.")).toBeTruthy();
    expect(sidebar().queryByRole("list", { name: "Recent sessions" })).toBeNull();
    expect(sidebar().queryByRole("link", { name: "See all sessions" })).toBeNull();
  });

  it("leaves no section when the history cannot be read", async () => {
    const { calls } = stub(undefined, { "GET /api/sessions": () => failure(500, "internal") });
    render(<App />);
    await waitFor(() => expect(calls.some((call) => call.path === "/api/sessions")).toBe(true));
    await waitFor(() => expect(sidebar().queryByRole("heading", { name: "Recent" })).toBeNull());
    expect(sidebar().queryByRole("navigation", { name: "Recent" })).toBeNull();
    expect(sidebar().getByRole("link", { name: "Sessions" })).toBeTruthy();
  });

  it("names them debates on a hosted service", async () => {
    stub(HOSTED, { "GET /api/sessions": () => json({ sessions: [], shared: true }) });
    render(<App />);
    expect(await sidebar().findByText("No debate yet.")).toBeTruthy();
  });
});

describe("the menu, hosted", () => {
  it("has the debates and the app's pages, then the host's pages, as the host's screens do", async () => {
    stub(HOSTED);
    window.location.hash = "#/gallery";
    render(<App />);
    await sidebar().findByRole("heading", { name: "Workspace and account" });
    expect(sidebar().getByRole("link", { name: "New debate" }).getAttribute("href")).toBe("#/");
    expect(sidebar().getByRole("heading", { name: "Debates" })).toBeTruthy();
    expect(links("Main menu")).toEqual([
      ["All debates", "#/sessions"],
      ["Decisions", "#/decisions"],
      ["Gallery", "#/gallery"],
      ["Settings", "#/settings"],
    ]);
    expect(links("Recent")).toEqual([
      ["A booking app, Verdict, Oct 1", "#/s/s1"],
      ["See all debates", "#/sessions"],
    ]);
    expect(sidebar().getByRole("list", { name: "Recent debates" })).toBeTruthy();
    expect(links("Workspace and account")).toEqual([
      ["Home", "https://app.example.com/account/#/"],
      ["Billing", "https://app.example.com/account/#/billing"],
      ["Members", "https://app.example.com/account/#/members"],
      ["Organisation profile", "https://app.example.com/account/#/profile"],
      ["Account", "https://app.example.com/account/#/account"],
    ]);
    // The menu's three parts in this order: the debates, the latest of them, the workspace and the account.
    expect(
      sidebar()
        .getAllByRole("heading")
        .map((heading) => heading.textContent),
    ).toEqual(["Debates", "Recent", "Workspace and account"]);
    expect(sidebar().getByRole("link", { name: "Gallery" }).getAttribute("aria-current")).toBe("page");
    expect(sidebar().queryByRole("link", { name: "Back-office" })).toBeNull();
    // Who is signed in, the way back to the website, the language and the theme.
    expect(sidebar().getByText("Ada Lovelace")).toBeTruthy();
    expect(sidebar().getByText("ada@example.com")).toBeTruthy();
    const site = sidebar().getByRole("link", { name: "Back to the website, example.com" });
    expect(site.getAttribute("href")).toBe("https://www.example.com");
    expect(sidebar().getByRole("combobox", { name: "Language" })).toBeTruthy();
    // The next page load lays the menu out for the host from the start.
    expect(localStorage.getItem("quorumind.hostMenu")).toBe("1");
  });

  it("shows the back-office to the staff the host names", async () => {
    stub({ ...HOSTED, links: [...HOSTED.links, { kind: "staff", url: "https://app.example.com/account/#/staff" }] });
    render(<App />);
    const staff = await sidebar().findByRole("link", { name: "Back-office" });
    expect(staff.getAttribute("href")).toBe("https://app.example.com/account/#/staff");
  });

  it("shows the current workspace, and switches to another one, the page loading again in it", async () => {
    const reload = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, hash: "#/decisions", reload } as Location);
    const { calls } = stub(HOSTED, { "POST /api/host/workspaces/w2/switch": () => json({ switched: true }) });
    render(<App />);
    const button = await sidebar().findByRole("button", { name: /Workspace: Atelier Nord/ });
    expect(button.textContent).toContain("Owner");
    fireEvent.click(button);
    const menu = sidebar().getByRole("menu", { name: "Workspace" });
    expect(
      within(menu)
        .getAllByRole("menuitemradio")
        .map((item) => [item.querySelector(".workspace-text")?.textContent, item.getAttribute("aria-checked")]),
    ).toEqual([
      ["Atelier NordOwner", "true"],
      ["Studio SudMember", "false"],
    ]);
    expect(within(menu).getByRole("menuitem", { name: "Create a workspace" }).getAttribute("href")).toBe(
      "https://app.example.com/account/#/workspaces/new",
    );
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: /Studio Sud/ }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(calls.filter((call) => call.method === "POST").map((call) => call.path)).toEqual(["/api/host/workspaces/w2/switch"]);
  });

  it("signs out from under the person's name when the host gives the way, then goes where the host says", async () => {
    const assign = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, hash: "#/decisions", assign } as Location);
    const signOut = { url: "/auth/signout", next: "https://app.example.com/account/#/signin?signedOut=1" };
    const { calls } = stub({ ...HOSTED, signOut }, { "POST /auth/signout": () => json({ ok: true }) });
    render(<App />);
    fireEvent.click(await sidebar().findByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(signOut.next));
    expect(calls.filter((call) => call.method === "POST").map((call) => call.path)).toEqual(["/auth/signout"]);
  });

  it("offers no sign-out when the host gives no way to", async () => {
    stub(HOSTED);
    render(<App />);
    await sidebar().findByText("ada@example.com");
    expect(sidebar().queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  it("offers to create a workspace to someone in none", async () => {
    stub({ ...HOSTED, workspaces: { list: [], createUrl: "https://app.example.com/account/#/workspaces/new" } });
    render(<App />);
    const create = await sidebar().findByRole("link", { name: "Create a workspace" });
    expect(create.getAttribute("href")).toBe("https://app.example.com/account/#/workspaces/new");
  });

  it("is laid out for the host from the first paint once it came before, and filled when it comes", async () => {
    localStorage.setItem("quorumind.hostMenu", "1");
    stub(HOSTED);
    render(<App />);
    expect(sidebar().getByRole("link", { name: "New debate" })).toBeTruthy();
    expect(sidebar().queryByRole("heading", { name: "Workspace and account" })).toBeNull();
    await sidebar().findByRole("heading", { name: "Workspace and account" });
  });
});
