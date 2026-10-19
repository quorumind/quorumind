/** @vitest-environment happy-dom */
import "./test/dom.ts";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import type { HostNavigation } from "./api.ts";
import { json, stubApi } from "./test/dom.ts";

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
  it("has the app's pages, the sessions among them, and lists no session itself", async () => {
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
    expect(sidebar().queryByText("A booking app")).toBeNull();
    expect(sidebar().queryByRole("heading")).toBeNull();
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
      ["Home", "https://app.example.com/account/#/"],
      ["Billing", "https://app.example.com/account/#/billing"],
      ["Members", "https://app.example.com/account/#/members"],
      ["Organisation profile", "https://app.example.com/account/#/profile"],
      ["Account", "https://app.example.com/account/#/account"],
    ]);
    expect(sidebar().getByRole("link", { name: "Gallery" }).getAttribute("aria-current")).toBe("page");
    expect(sidebar().queryByRole("link", { name: "Back-office" })).toBeNull();
    expect(sidebar().queryByText("A booking app")).toBeNull();
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
