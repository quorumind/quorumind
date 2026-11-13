import { expect, test } from "@playwright/test";
import { demoToVerdict, HOSTED, LOCAL, startDemo, watchConsole } from "./servers.ts";

// The addresses of the app: the steps of a new debate are entries of the browser's history, a debate's tab is in its
// address, an address that leads nowhere says so, and a private debate says it is private to a member.

test.describe("on the hosted workspace", () => {
  test.use({ baseURL: HOSTED, extraHTTPHeaders: { "x-user": "ada" } });

  test("the browser's Back and Forward move between the steps of a new debate, never out of the form", async ({ page }) => {
    const problems = watchConsole(page);
    await page.goto("/#/sessions");
    await page.getByRole("link", { name: "New debate" }).first().click();
    await page.evaluate(() => sessionStorage.clear());
    await page.getByLabel("Your project idea").fill("A booking app for our 12 yoga studios");
    const next = page.getByRole("button", { name: "Next" });
    await next.click();
    await expect(page).toHaveURL(/#\/new\/context$/);
    await next.click();
    await expect(page).toHaveURL(/#\/new\/panel$/);
    await expect(page.getByRole("heading", { level: 2, name: "The panel" })).toBeFocused();

    await page.goBack();
    await expect(page).toHaveURL(/#\/new\/context$/);
    await expect(page.getByRole("heading", { level: 2, name: "Context" })).toBeFocused();
    await page.goForward();
    await expect(page.getByRole("heading", { level: 2, name: "The panel" })).toBeFocused();
    await page.goBack();
    await page.goBack();
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.getByRole("heading", { level: 2, name: "Your need" })).toBeFocused();
    await expect(page.getByLabel("Your project idea")).toHaveValue("A booking app for our 12 yoga studios");
    // One more Back leaves the form, for the page before it.
    await page.goBack();
    await expect(page).toHaveURL(/#\/sessions$/);

    // A reload on a step opens that step (a page load, not a change of fragment).
    await page.goto("/#/new/panel");
    await page.reload();
    await expect(page).toHaveURL(/#\/new\/panel$/);
    await expect(page.getByRole("heading", { level: 2, name: "The panel" })).toBeVisible();
    expect(problems).toEqual([]);
  });

  test("an address to watch the recorded demo brings its offer first, focused, and starts nothing", async ({ page }) => {
    await page.goto("/#/?demo=1");
    const play = page.getByRole("button", { name: /Replay the recorded demo/ });
    await expect(play).toBeFocused();
    await expect(play).toHaveCount(1);
    await expect(page).toHaveURL(/#\/\?demo=1$/);
    await expect(page.getByLabel("Your project idea")).toBeVisible();
  });

  test("a member who opens a debate its author made private is told so, and to ask its author", async ({ browser, request }) => {
    const id = await startDemo(request, HOSTED, { "x-user": "ada" });
    const made = await request.put(`${HOSTED}/api/sessions/${id}/visibility`, { headers: { "x-user": "ada" }, data: { private: true } });
    expect(made.ok()).toBe(true);

    const bob = await browser.newContext({ extraHTTPHeaders: { "x-user": "bob" }, locale: "en-US" });
    const page = await bob.newPage();
    await page.goto(`/#/s/${id}`);
    await expect(page.getByRole("heading", { level: 1, name: "This debate is private" })).toBeVisible();
    await expect(page.getByText(/Only the person who started it can open it now/)).toBeVisible();
    await expect(page).toHaveTitle("This debate is private · Quorumind");
    // An address that leads nowhere stays a debate not found.
    await page.goto("/#/s/00000000-0000-0000-0000-000000000000");
    await expect(page.getByRole("heading", { level: 1, name: "Debate not found" })).toBeVisible();
    await bob.close();
  });
});

test.describe("on a self-hosted server", () => {
  test.use({ baseURL: LOCAL });

  test("a debate's tab is in its address: written in place, kept by a reload, without moving the focus", async ({ page, request }) => {
    const id = await demoToVerdict(request);
    await page.goto(`/#/s/${id}`);
    const tabs = page.getByRole("tablist");
    await expect(tabs.getByRole("tab", { name: /Verdict/ })).toHaveAttribute("aria-selected", "true");
    const length = await page.evaluate(() => history.length);
    const debate = tabs.getByRole("tab", { name: "Debate" });
    await debate.click();
    await expect(page).toHaveURL(new RegExp(`#/s/${id}/debate$`));
    await expect(debate).toBeFocused();
    expect(await page.evaluate(() => history.length)).toBe(length);

    await page.reload();
    await expect(page.getByRole("tablist").getByRole("tab", { name: "Debate" })).toHaveAttribute("aria-selected", "true");
    // A step reached opens its tab too.
    await page.locator("ol.progress").getByRole("button", { name: "Interview" }).click();
    await expect(page).toHaveURL(new RegExp(`#/s/${id}/interview$`));
    await expect(page.getByRole("tablist").getByRole("tab", { name: "Interview" })).toHaveAttribute("aria-selected", "true");
    // The old address still opens the tab of the phase.
    await page.goto(`/#/s/${id}`);
    await expect(page.getByRole("tablist").getByRole("tab", { name: /Verdict/ })).toHaveAttribute("aria-selected", "true");
  });

  test("an address that leads nowhere says so, with its heading focused after a link, and a stray slash is dropped", async ({ page }) => {
    await page.goto("/#/sessions/");
    await expect(page.getByRole("heading", { level: 1, name: "Debates" })).toBeVisible();
    await expect(page).toHaveURL(/#\/sessions$/);
    await page.evaluate(() => {
      window.location.hash = "#/nimporte";
    });
    const heading = page.getByRole("heading", { level: 1, name: "This page does not exist" });
    await expect(heading).toBeFocused();
    await expect(page).toHaveTitle("This page does not exist · Quorumind");
    await page.getByRole("link", { name: "Start a new debate" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "New debate" })).toBeFocused();
  });

  test("a share link that no longer works says so, without the shared page's notice or a way into the app", async ({ page }) => {
    await page.goto("/#/shared/zzz");
    await expect(page.getByRole("heading", { level: 1, name: "This link no longer works" })).toBeVisible();
    await expect(page.getByText(/You are reading a shared debate/)).toHaveCount(0);
    await expect(page.getByRole("link")).toHaveCount(0);
  });
});

test("the hosted menu names the workspace's settings and the API tokens, and leaves out a kind it cannot name", async ({ browser }) => {
  const ada = await browser.newContext({ extraHTTPHeaders: { "x-user": "ada" }, locale: "en-US", baseURL: HOSTED });
  const page = await ada.newPage();
  await page.goto("/#/gallery");
  await page.getByRole("button", { name: /^Workspace: Studio/ }).click();
  await expect(page.getByRole("menu", { name: "Workspace" }).getByRole("menuitem", { name: "Workspace settings" })).toHaveAttribute(
    "href",
    "/account/#/settings",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Account: Ada Lovelace/ }).click();
  await expect(page.getByRole("menu", { name: "Account" }).getByRole("menuitem", { name: "API tokens" })).toHaveAttribute(
    "href",
    "/account/#/tokens",
  );
  await expect(page.locator('a[href$="#/future"]')).toHaveCount(0);
  await ada.close();
});
