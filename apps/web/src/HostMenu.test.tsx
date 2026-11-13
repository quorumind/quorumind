/** @vitest-environment happy-dom */
import "./test/dom.ts";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import type { HostNavigation } from "./api.ts";
import { failure, json, stubApi, stubEventSource } from "./test/dom.ts";

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
const ACCOUNT = /^Account: Ada Lovelace ada@example\.com$/;
const WORKSPACE = /^Workspace: Atelier Nord/;
const items = (menu: string) =>
  within(sidebar().getByRole("menu", { name: menu }))
    .getAllByRole("menuitem")
    .map((item) => [item.textContent, item.getAttribute("href"), item.getAttribute("aria-current")]);
const accountItems = () => items("Account");
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
    expect(sidebar().getByRole("link", { name: "New debate" })).toBeTruthy();
    expect(links("Main menu")).toEqual([
      ["Debates", "#/sessions"],
      ["Decisions", "#/decisions"],
      ["Gallery", "#/gallery"],
      ["Settings", "#/settings"],
    ]);
    expect(sidebar().getByRole("link", { name: "Decisions" }).getAttribute("aria-current")).toBe("page");
    const list = await sidebar().findByRole("list", { name: "Recent debates" });
    expect(Array.from(list.querySelectorAll("a"), (link) => link.getAttribute("href"))).toEqual(["#/s/s1"]);
    // The state and the day are said with the title.
    expect(
      within(list)
        .getByRole("link", { name: /^A booking app\W+Verdict\W+Oct 1$/ })
        .getAttribute("aria-current"),
    ).toBeNull();
    expect(links("Recent")).toEqual([
      ["A booking app, Verdict, Oct 1", "#/s/s1"],
      ["See all debates", "#/sessions"],
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
    // The hosted menu titles its debates with a heading; the self-hosted one has only the page's link.
    await waitFor(() => expect(sidebar().queryByRole("heading", { name: "Debates" })).toBeNull());
    expect(sidebar().getByRole("link", { name: "Debates" }).getAttribute("href")).toBe("#/sessions");
    // No one signs in to a self-hosted server: no workspace, no card for the person, the foot alone at the bottom.
    expect(sidebar().queryByRole("button", { name: /Workspace|Account/ })).toBeNull();
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
    // The session's page may load before the test ends, on a busy machine: it follows its events too.
    stubEventSource();
    window.location.hash = "#/s/s3";
    render(<App />);
    const list = await sidebar().findByRole("list", { name: "Recent debates" });
    const rows = within(list).getAllByRole("link");
    expect(rows).toHaveLength(15);
    expect(rows[0]?.textContent).toContain("Idea 1");
    expect(rows.at(-1)?.textContent).toContain("Idea 15");
    expect(rows.filter((row) => row.getAttribute("aria-current") === "page").map((row) => row.getAttribute("href"))).toEqual(["#/s/s3"]);
    // The full title on hover, as the line cuts it short.
    expect(rows[2]?.getAttribute("title")).toBe("Idea 3");
    expect(sidebar().getByRole("link", { name: "See all debates" }).getAttribute("href")).toBe("#/sessions");
  });

  it("lists first those waiting for the person, says in a word what each one waits for, and tells two of the same name apart by their time", async () => {
    const at = (day: number, hour: number) => new Date(Date.UTC(2026, 9, day, hour, 5)).toISOString();
    stub(undefined, {
      "GET /api/sessions": () =>
        json({
          sessions: [
            { id: "done", idea: "Studio booking app", phase: "complete", updatedAt: at(20, 10) },
            { id: "running", idea: "A CRM", phase: "debating", updatedAt: at(19, 10) },
            { id: "theirs", idea: "Bob's idea", phase: "review", updatedAt: at(18, 10), mine: false },
            { id: "stopped", idea: "A shop", phase: "failed", updatedAt: at(17, 10) },
            { id: "check", idea: "Studio booking app", phase: "review", updatedAt: at(16, 9) },
            { id: "answer", idea: "A portal", phase: "awaiting_answers", updatedAt: at(15, 10) },
          ],
          shared: true,
        }),
    });
    render(<App />);
    const list = await sidebar().findByRole("list", { name: "Recent debates" });
    const rows = within(list).getAllByRole("link");
    expect(rows.map((row) => row.getAttribute("href"))).toEqual([
      "#/s/check",
      "#/s/answer",
      "#/s/done",
      "#/s/running",
      "#/s/theirs",
      "#/s/stopped",
    ]);
    const status = (row: Element | undefined) => row?.querySelector(".recent-status");
    expect(status(rows[0])?.textContent).toBe(", Requirements to check");
    expect(status(rows[0])?.hasAttribute("data-yours")).toBe(true);
    expect(status(rows[1])?.textContent).toBe(", Waiting for your answers");
    expect(status(rows[2])).toBeNull();
    expect(status(rows[3])?.textContent).toBe(", Debate running");
    expect(status(rows[4])?.textContent).toBe(", Waiting for its author");
    expect(status(rows[4])?.hasAttribute("data-yours")).toBe(false);
    expect(status(rows[5])?.textContent).toBe(", Stopped");
    // The two "Studio booking app" show their time under their name; the others their day only.
    expect(rows[0]?.querySelector(".recent-time")?.textContent).toMatch(/\d:05/);
    expect(rows[2]?.querySelector(".recent-time")?.textContent).toMatch(/\d:05/);
    expect(rows[0]?.querySelector("time")?.textContent).toBe("Oct 16");
    expect(rows[1]?.querySelector(".recent-time")).toBeNull();
  });

  it("rings the dot of the sessions that wait for the person, and those only, whatever their phase", async () => {
    const at = (day: number) => new Date(Date.UTC(2026, 9, day, 10, 5)).toISOString();
    stub(undefined, {
      "GET /api/sessions": () =>
        json({
          sessions: [
            { id: "interview", idea: "An interview", phase: "interview", updatedAt: at(20) },
            { id: "check", idea: "A sheet", phase: "review", updatedAt: at(19) },
            { id: "answer", idea: "A question", phase: "awaiting_answers", updatedAt: at(18) },
            { id: "their-answer", idea: "Bob's question", phase: "awaiting_answers", updatedAt: at(17), mine: false },
            { id: "their-interview", idea: "Bob's interview", phase: "interview", updatedAt: at(16), mine: false },
            { id: "running", idea: "A CRM", phase: "debating", updatedAt: at(15) },
          ],
          shared: true,
        }),
    });
    render(<App />);
    const list = await sidebar().findByRole("list", { name: "Recent debates" });
    const lines = within(list)
      .getAllByRole("link")
      .map((row) => [
        row.getAttribute("href"),
        row.querySelector(".phase-dot")?.hasAttribute("data-yours"),
        row.querySelector(".recent-status")?.hasAttribute("data-yours"),
        row.querySelector(".recent-status")?.textContent,
      ]);
    // The dot and the word say the same: an interview waiting for answers is the person's move, someone else's
    // question is its author's.
    expect(lines).toEqual([
      ["#/s/interview", true, true, ", Waiting for your answers"],
      ["#/s/check", true, true, ", Requirements to check"],
      ["#/s/answer", true, true, ", Waiting for your answers"],
      ["#/s/their-answer", false, false, ", Waiting for its author"],
      ["#/s/their-interview", false, false, ", Waiting for its author"],
      ["#/s/running", false, false, ", Debate running"],
    ]);
  });

  it("says so in a short line when there is none yet", async () => {
    stub(undefined, { "GET /api/sessions": () => json({ sessions: [], shared: false }) });
    render(<App />);
    expect(await sidebar().findByText("No debate yet.")).toBeTruthy();
    expect(sidebar().queryByRole("list", { name: "Recent debates" })).toBeNull();
    expect(sidebar().queryByRole("link", { name: "See all debates" })).toBeNull();
  });

  it("leaves no section when the history cannot be read", async () => {
    const { calls } = stub(undefined, { "GET /api/sessions": () => failure(500, "internal") });
    render(<App />);
    await waitFor(() => expect(calls.some((call) => call.path === "/api/sessions")).toBe(true));
    await waitFor(() => expect(sidebar().queryByRole("heading", { name: "Recent" })).toBeNull());
    expect(sidebar().queryByRole("navigation", { name: "Recent" })).toBeNull();
    expect(sidebar().getByRole("link", { name: "Debates" })).toBeTruthy();
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
    // The host's pages are no longer lines of the menu: the workspace's menu and the person's card open them.
    expect(
      sidebar()
        .getAllByRole("heading")
        .map((heading) => heading.textContent),
    ).toEqual(["Debates", "Recent"]);
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

  it("opens the person's pages above the person's card, the workspace's being in the workspace's menu", async () => {
    stub(HOSTED);
    render(<App />);
    const account = await sidebar().findByRole("button", { name: ACCOUNT });
    expect(sidebar().queryByRole("menu")).toBeNull();
    fireEvent.click(account);
    expect(account.getAttribute("aria-expanded")).toBe("true");
    const menu = sidebar().getByRole("menu", { name: "Account" });
    expect(account.getAttribute("aria-controls")).toBe(menu.id);
    expect(accountItems()).toEqual([["Account", "https://app.example.com/account/#/account", null]]);
    expect(within(menu).queryByRole("menuitem", { name: "Back-office" })).toBeNull();
    // The focus goes to the first page; a click on the card again closes the menu.
    expect(document.activeElement?.textContent).toBe("Account");
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
    expect(document.activeElement?.textContent).toBe("Account");
    key("ArrowUp");
    expect(document.activeElement?.textContent).toBe("Sign out");
    key("ArrowUp");
    expect(document.activeElement?.textContent).toBe("Account");
    key("End");
    expect(document.activeElement?.textContent).toBe("Sign out");
    key("Home");
    expect(document.activeElement?.textContent).toBe("Account");
    key("Escape");
    expect(sidebar().queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(account);
    // The down arrow opens it on its first item; a click anywhere else closes it.
    fireEvent.keyDown(account, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Account"));
    act(() => {
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(sidebar().queryByRole("menu")).toBeNull();
  });

  it("shows the back-office to the staff the host names", async () => {
    stub({ ...HOSTED, links: [...HOSTED.links, { kind: "staff", url: "https://app.example.com/account/#/staff" }] });
    render(<App />);
    fireEvent.click(await sidebar().findByRole("button", { name: ACCOUNT }));
    expect(accountItems()).toEqual([
      ["Account", "https://app.example.com/account/#/account", null],
      ["Back-office", "https://app.example.com/account/#/staff", null],
    ]);
    // Not a page of the workspace.
    fireEvent.click(sidebar().getByRole("button", { name: WORKSPACE }));
    expect(within(sidebar().getByRole("menu", { name: "Workspace" })).queryByRole("menuitem", { name: "Back-office" })).toBeNull();
  });

  it("puts the workspace's settings in the workspace's menu and the API tokens under the person's card, and skips a kind it does not know", async () => {
    stub({
      ...HOSTED,
      links: [
        ...HOSTED.links,
        { kind: "settings", url: "https://app.example.com/account/#/settings" },
        { kind: "tokens", url: "https://app.example.com/account/#/tokens" },
        // A newer host's page this version cannot name: left out, the rest of the menu intact.
        { kind: "future" as "home", url: "https://app.example.com/account/#/future" },
      ],
    });
    render(<App />);
    fireEvent.click(await sidebar().findByRole("button", { name: WORKSPACE }));
    expect(items("Workspace").map(([name]) => name)).toEqual([
      "Home",
      "Billing",
      "Members",
      "Organisation profile",
      "Workspace settings",
      "Create a workspace",
    ]);
    expect(
      within(sidebar().getByRole("menu", { name: "Workspace" }))
        .getByRole("menuitem", { name: "Workspace settings" })
        .getAttribute("href"),
    ).toBe("https://app.example.com/account/#/settings");
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    fireEvent.click(sidebar().getByRole("button", { name: ACCOUNT }));
    expect(accountItems()).toEqual([
      ["Account", "https://app.example.com/account/#/account", null],
      ["API tokens", "https://app.example.com/account/#/tokens", null],
    ]);
    expect(document.querySelector('a[href$="#/future"]')).toBeNull();
  });

  it("opens the workspace's menu over its button: the workspace, the workspaces, its pages, then a way to create one", async () => {
    stub(HOSTED);
    render(<App />);
    const button = await sidebar().findByRole("button", { name: WORKSPACE });
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const menu = sidebar().getByRole("menu", { name: "Workspace" });
    expect(button.getAttribute("aria-controls")).toBe(menu.id);
    // On top, the workspace worked in, which the checked line says to a screen reader.
    const head = menu.querySelector(".workspace-menu-head");
    expect(head?.getAttribute("aria-hidden")).toBe("true");
    expect(head?.textContent).toBe("AAtelier NordOwner");
    expect(menu.firstElementChild).toBe(head);
    // Every item in order, by its role, the separators between the parts.
    expect(
      Array.from(menu.querySelectorAll('[role^="menuitem"], hr'), (item) => [
        item.getAttribute("role") ?? item.tagName,
        item.querySelector(".workspace-name")?.textContent ?? item.textContent,
        item.getAttribute("aria-checked") ?? item.getAttribute("href"),
      ]),
    ).toEqual([
      ["menuitemradio", "Atelier Nord", "true"],
      ["menuitemradio", "Studio Sud", "false"],
      ["HR", "", null],
      ["menuitem", "Home", "https://app.example.com/account/#/"],
      ["menuitem", "Billing", "https://app.example.com/account/#/billing"],
      ["menuitem", "Members", "https://app.example.com/account/#/members"],
      ["menuitem", "Organisation profile", "https://app.example.com/account/#/profile"],
      ["HR", "", null],
      ["menuitem", "Create a workspace", "https://app.example.com/account/#/workspaces/new"],
    ]);
    expect(within(menu).getAllByRole("separator")).toHaveLength(2);
    // None is the page shown: these are the host's pages. The account's is under the person's card.
    expect(menu.querySelector("[aria-current]")).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: "Account" })).toBeNull();
    // The focus goes to the workspace worked in; a click on the workspace on top closes the menu and gives it back.
    expect(document.activeElement?.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(head as Element);
    expect(sidebar().queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("moves through the workspace's menu with the keyboard, and closes it with Escape or a click elsewhere", async () => {
    stub(HOSTED);
    render(<App />);
    const button = await sidebar().findByRole("button", { name: WORKSPACE });
    const label = () => document.activeElement?.querySelector(".workspace-name")?.textContent ?? document.activeElement?.textContent;
    const key = (name: string) => fireEvent.keyDown(document.activeElement as Element, { key: name });
    fireEvent.keyDown(button, { key: "ArrowDown" });
    await waitFor(() => expect(label()).toBe("Atelier Nord"));
    key("ArrowDown");
    expect(label()).toBe("Studio Sud");
    key("ArrowDown");
    expect(label()).toBe("Home");
    key("End");
    expect(label()).toBe("Create a workspace");
    key("ArrowUp");
    expect(label()).toBe("Organisation profile");
    key("ArrowDown");
    key("ArrowDown");
    expect(label()).toBe("Atelier Nord");
    key("Escape");
    expect(sidebar().queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
    // The up arrow opens it on its last item; a click anywhere else closes it.
    fireEvent.keyDown(button, { key: "ArrowUp" });
    await waitFor(() => expect(label()).toBe("Create a workspace"));
    act(() => {
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(sidebar().queryByRole("menu")).toBeNull();
  });

  it("lists the one workspace too, so the menu reads the same", async () => {
    const workspaces = HOSTED.workspaces as NonNullable<HostNavigation["workspaces"]>;
    stub({ ...HOSTED, workspaces: { ...workspaces, list: workspaces.list.slice(0, 1) } });
    render(<App />);
    fireEvent.click(await sidebar().findByRole("button", { name: WORKSPACE }));
    const menu = sidebar().getByRole("menu", { name: "Workspace" });
    expect(
      within(menu)
        .getAllByRole("menuitemradio")
        .map((item) => [item.querySelector(".workspace-text")?.textContent, item.getAttribute("aria-checked")]),
    ).toEqual([["Atelier NordOwner", "true"]]);
    expect(items("Workspace").map(([label]) => label)).toEqual([
      "Home",
      "Billing",
      "Members",
      "Organisation profile",
      "Create a workspace",
    ]);
  });

  it("shows the current workspace, and switches to another one, the page loading again in it", async () => {
    const reload = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, hash: "#/decisions", reload } as Location);
    const { calls } = stub(HOSTED, { "POST /api/host/workspaces/w2/switch": () => json({ switched: true }) });
    render(<App />);
    const button = await sidebar().findByRole("button", { name: WORKSPACE });
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
    const menu = sidebar().getByRole("menu", { name: "Account" });
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
    const menu = sidebar().getByRole("menu", { name: "Account" });
    expect(within(menu).queryByRole("menuitem", { name: "Sign out" })).toBeNull();
    expect(menu.querySelector("hr")).toBeNull();
  });

  it("names the person by the e-mail alone when the host knows no name", async () => {
    stub({ ...HOSTED, user: { name: null, email: "ada@example.com" } });
    render(<App />);
    const account = await sidebar().findByRole("button", { name: "Account: ada@example.com" });
    expect(account.querySelector(".account-avatar")?.textContent).toBe("A");
    expect(account.querySelector(".account-email")).toBeNull();
  });

  it("offers to create a workspace to someone in none", async () => {
    stub({ ...HOSTED, workspaces: { list: [], createUrl: "https://app.example.com/account/#/workspaces/new" } });
    render(<App />);
    const create = await sidebar().findByRole("link", { name: "Create a workspace" });
    expect(create.getAttribute("href")).toBe("https://app.example.com/account/#/workspaces/new");
    // No workspace to show its pages under: the person's menu keeps them.
    fireEvent.click(sidebar().getByRole("button", { name: ACCOUNT }));
    expect(accountItems().map(([label]) => label)).toEqual(["Home", "Billing", "Members", "Organisation profile", "Account"]);
  });

  it("keeps every page in the person's menu for a host without workspaces", async () => {
    stub({ ...HOSTED, workspaces: null });
    render(<App />);
    fireEvent.click(await sidebar().findByRole("button", { name: ACCOUNT }));
    expect(accountItems().map(([label]) => label)).toEqual(["Home", "Billing", "Members", "Organisation profile", "Account"]);
    expect(sidebar().queryByRole("button", { name: /^Workspace/ })).toBeNull();
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
