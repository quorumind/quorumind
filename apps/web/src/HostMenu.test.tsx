/** @vitest-environment happy-dom */
import "./test/dom.ts";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react";
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
const ACCOUNT = /^Workspace and account: Ada Lovelace ada@example\.com$/;
const accountItems = () =>
  within(sidebar().getByRole("menu", { name: "Workspace and account" }))
    .getAllByRole("menuitem")
    .map((item) => [item.textContent, item.getAttribute("href"), item.getAttribute("aria-current")]);
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
    // No one signs in to a self-hosted server: no card for the person, the foot alone at the bottom.
    expect(sidebar().queryByRole("button", { name: /Workspace and account/ })).toBeNull();
    expect(document.querySelector(".account-switch")).toBeNull();
    expect(sidebar().getByRole("combobox", { name: "Language" })).toBeTruthy();
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
  it("has the debates and the app's pages, then the person's card, as the host's screens do", async () => {
    stub(HOSTED);
    window.location.hash = "#/gallery";
    render(<App />);
    const account = await sidebar().findByRole("button", { name: ACCOUNT });
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
    // The host's pages are no longer lines of the menu: the person's card at the bottom opens them.
    expect(
      sidebar()
        .getAllByRole("heading")
        .map((heading) => heading.textContent),
    ).toEqual(["Debates", "Recent"]);
    expect(sidebar().queryByRole("navigation", { name: "Workspace and account" })).toBeNull();
    expect(sidebar().queryByRole("link", { name: "Billing" })).toBeNull();
    expect(sidebar().getByRole("link", { name: "Gallery" }).getAttribute("aria-current")).toBe("page");
    // Who is signed in: the initial, the name and the e-mail, on a button that opens a menu.
    expect(account.querySelector(".account-avatar")?.textContent).toBe("A");
    expect(account.querySelector(".account-name")?.textContent).toBe("Ada Lovelace");
    expect(account.querySelector(".account-email")?.textContent).toBe("ada@example.com");
    expect(account.getAttribute("aria-haspopup")).toBe("menu");
    expect(account.getAttribute("aria-expanded")).toBe("false");
    expect(account.closest(".sidebar-bottom")).toBeTruthy();
    // The way back to the website, the language and the theme.
    const site = sidebar().getByRole("link", { name: "Back to the website, example.com" });
    expect(site.getAttribute("href")).toBe("https://www.example.com");
    expect(sidebar().getByRole("combobox", { name: "Language" })).toBeTruthy();
    // The next page load lays the menu out for the host from the start.
    expect(localStorage.getItem("quorumind.hostMenu")).toBe("1");
  });

  it("opens the host's pages above the person's card, none of them the page shown", async () => {
    stub(HOSTED);
    render(<App />);
    const account = await sidebar().findByRole("button", { name: ACCOUNT });
    expect(sidebar().queryByRole("menu")).toBeNull();
    fireEvent.click(account);
    expect(account.getAttribute("aria-expanded")).toBe("true");
    const menu = sidebar().getByRole("menu", { name: "Workspace and account" });
    expect(account.getAttribute("aria-controls")).toBe(menu.id);
    expect(accountItems()).toEqual([
      ["Home", "https://app.example.com/account/#/", null],
      ["Billing", "https://app.example.com/account/#/billing", null],
      ["Members", "https://app.example.com/account/#/members", null],
      ["Organisation profile", "https://app.example.com/account/#/profile", null],
      ["Account", "https://app.example.com/account/#/account", null],
    ]);
    expect(within(menu).queryByRole("menuitem", { name: "Back-office" })).toBeNull();
    // The focus goes to the first page; a click on the card again closes the menu.
    expect(document.activeElement?.textContent).toBe("Home");
    fireEvent.click(account);
    expect(sidebar().queryByRole("menu")).toBeNull();
  });

  it("moves through the menu with the keyboard, and closes it with Escape or a click elsewhere", async () => {
    stub({ ...HOSTED, signOut: { url: "/auth/signout", next: "https://app.example.com/account/#/signin?signedOut=1" } });
    render(<App />);
    const account = await sidebar().findByRole("button", { name: ACCOUNT });
    // The up arrow opens it on its last item, the way to sign out, right above the card.
    fireEvent.keyDown(account, { key: "ArrowUp" });
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Sign out"));
    const key = (name: string) => fireEvent.keyDown(document.activeElement as Element, { key: name });
    key("ArrowDown");
    expect(document.activeElement?.textContent).toBe("Home");
    key("ArrowUp");
    expect(document.activeElement?.textContent).toBe("Sign out");
    key("ArrowUp");
    expect(document.activeElement?.textContent).toBe("Account");
    key("Home");
    expect(document.activeElement?.textContent).toBe("Home");
    key("End");
    expect(document.activeElement?.textContent).toBe("Sign out");
    key("Escape");
    expect(sidebar().queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(account);
    // The down arrow opens it on its first item; a click anywhere else closes it.
    fireEvent.keyDown(account, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Home"));
    act(() => {
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(sidebar().queryByRole("menu")).toBeNull();
  });

  it("shows the back-office to the staff the host names", async () => {
    stub({ ...HOSTED, links: [...HOSTED.links, { kind: "staff", url: "https://app.example.com/account/#/staff" }] });
    render(<App />);
    fireEvent.click(await sidebar().findByRole("button", { name: ACCOUNT }));
    expect(accountItems().at(-1)).toEqual(["Back-office", "https://app.example.com/account/#/staff", null]);
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

  it("signs out from the person's menu when the host gives the way, then goes where the host says", async () => {
    const assign = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, hash: "#/decisions", assign } as Location);
    const signOut = { url: "/auth/signout", next: "https://app.example.com/account/#/signin?signedOut=1" };
    const { calls } = stub({ ...HOSTED, signOut }, { "POST /auth/signout": () => json({ ok: true }) });
    render(<App />);
    // No button of its own: the last item of the menu, after a separator.
    expect(sidebar().queryByRole("button", { name: "Sign out" })).toBeNull();
    fireEvent.click(await sidebar().findByRole("button", { name: ACCOUNT }));
    const menu = sidebar().getByRole("menu", { name: "Workspace and account" });
    expect(menu.querySelector("hr + .account-sign-out")).toBeTruthy();
    expect(within(menu).getAllByRole("menuitem").at(-1)?.textContent).toBe("Sign out");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Sign out" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(signOut.next));
    expect(calls.filter((call) => call.method === "POST").map((call) => call.path)).toEqual(["/auth/signout"]);
  });

  it("offers no sign-out when the host gives no way to", async () => {
    stub(HOSTED);
    render(<App />);
    fireEvent.click(await sidebar().findByRole("button", { name: ACCOUNT }));
    const menu = sidebar().getByRole("menu", { name: "Workspace and account" });
    expect(within(menu).queryByRole("menuitem", { name: "Sign out" })).toBeNull();
    expect(menu.querySelector("hr")).toBeNull();
  });

  it("names the person by the e-mail alone when the host knows no name", async () => {
    stub({ ...HOSTED, user: { name: null, email: "ada@example.com" } });
    render(<App />);
    const account = await sidebar().findByRole("button", { name: "Workspace and account: ada@example.com" });
    expect(account.querySelector(".account-avatar")?.textContent).toBe("A");
    expect(account.querySelector(".account-email")).toBeNull();
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
    // The places of the workspace and of the person are kept until the host's part comes.
    expect(document.querySelector(".workspace-pending")).toBeTruthy();
    expect(document.querySelector(".account-pending")).toBeTruthy();
    expect(sidebar().queryByRole("button", { name: ACCOUNT })).toBeNull();
    await sidebar().findByRole("button", { name: ACCOUNT });
    expect(document.querySelector(".account-pending")).toBeNull();
  });
});
