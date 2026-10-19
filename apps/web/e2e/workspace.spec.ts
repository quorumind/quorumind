import { expect, test } from "@playwright/test";
import { demoToVerdict, HOSTED } from "./servers.ts";

// The hosted workspace: Ada and Bob are members of the same one. Bob reads Ada's sessions and may start again from
// them, but only Ada may change them.

test.use({ baseURL: HOSTED });

test("a member who may only read sees no control that changes the session", async ({ browser, request }) => {
  const id = await demoToVerdict(request, HOSTED, { "x-user": "ada" });

  const bob = await browser.newContext({ extraHTTPHeaders: { "x-user": "bob" }, locale: "en-US" });
  const page = await bob.newPage();
  await page.goto(`/#/s/${id}`);
  await expect(page.getByText("You can read this session and start again from it.", { exact: false })).toBeVisible();
  await expect(page.getByText("Started by Ada Lovelace")).toBeVisible();
  for (const name of ["Share", "Delete", "Stop"]) await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Your client" })).toHaveCount(0);
  await expect(page.getByText("What if…")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ask for approval" })).toBeVisible();
  // Starting again from it is his to do.
  await page.getByRole("button", { name: "Start again from here" }).click();
  await expect.poll(() => page.url().includes("#/s/") && !page.url().endsWith(id)).toBe(true);
  await bob.close();
});

test("the author keeps every control of the session", async ({ browser, request }) => {
  const id = await demoToVerdict(request, HOSTED, { "x-user": "ada" });
  const ada = await browser.newContext({ extraHTTPHeaders: { "x-user": "ada" }, locale: "en-US" });
  const page = await ada.newPage();
  await page.goto(`/#/s/${id}`);
  await expect(page.getByRole("button", { name: "Share", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your client" })).toBeVisible();
  await ada.close();
});

test("the workspace's menu opens over its button, with the workspaces and the workspace's pages", async ({ browser }) => {
  const ada = await browser.newContext({ extraHTTPHeaders: { "x-user": "ada" }, locale: "en-US", viewport: { width: 1366, height: 768 } });
  const page = await ada.newPage();
  await page.goto("/#/decisions");
  const button = page.getByRole("button", { name: /^Workspace: Studio/ });
  await expect(button).toHaveAttribute("aria-haspopup", "menu");
  await button.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "Workspace" });
  // The one workspace is listed too, checked, so the menu reads the same with more.
  await expect(menu.getByRole("menuitemradio")).toHaveCount(1);
  await expect(menu.getByRole("menuitemradio", { name: /Studio/ })).toHaveAttribute("aria-checked", "true");
  await expect(menu.getByRole("menuitemradio", { name: /Studio/ })).toBeFocused();
  await expect(menu.getByRole("menuitem")).toHaveText(["Dashboard", "Billing", "Members", "Organisation profile", "Create a workspace"]);
  await expect(menu.getByRole("separator")).toHaveCount(2);
  // Over its button once it rose, the workspace on top where the button was, and whole on a laptop.
  const buttonBox = await button.boundingBox();
  await expect.poll(async () => Math.abs(((await menu.boundingBox())?.y ?? 0) - (buttonBox?.y ?? 0))).toBeLessThanOrEqual(1);
  const menuBox = await menu.boundingBox();
  expect((menuBox?.y ?? 0) + (menuBox?.height ?? 0)).toBeLessThanOrEqual(768);
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Dashboard" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(button).toBeFocused();
  // A page picked leaves for the host's.
  await button.click();
  await menu.getByRole("menuitem", { name: "Billing" }).click();
  await expect(page).toHaveURL(/\/account\/#\/billing$/);
  await ada.close();
});

test("the person's card opens the person's pages above it, and signs out from its menu", async ({ browser }) => {
  const ada = await browser.newContext({ extraHTTPHeaders: { "x-user": "ada" }, locale: "en-US", viewport: { width: 1366, height: 768 } });
  const page = await ada.newPage();
  await page.goto("/#/decisions");
  const card = page.getByRole("button", { name: "Account: Ada Lovelace ada@example.com" });
  await expect(card).toHaveAttribute("aria-haspopup", "menu");
  await expect(card).toHaveAttribute("aria-expanded", "false");
  // The host's pages are no longer lines of the menu, whose bottom stays in sight on a laptop.
  await expect(page.getByRole("link", { name: "Billing" })).toHaveCount(0);
  const foot = await page.getByRole("combobox", { name: "Language" }).boundingBox();
  expect((foot?.y ?? 0) + (foot?.height ?? 0)).toBeLessThanOrEqual(768);

  await card.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "Account" });
  await expect(menu.getByRole("menuitem")).toHaveText(["Account", "Sign out"]);
  await expect(menu.getByRole("separator")).toHaveCount(1);
  await expect(menu.getByRole("menuitem", { name: "Account" })).toBeFocused();
  // Above the card, once it rose.
  const cardBox = await card.boundingBox();
  await expect
    .poll(async () => {
      const box = await menu.boundingBox();
      return (box?.y ?? 0) + (box?.height ?? 0);
    })
    .toBeLessThanOrEqual(cardBox?.y ?? 0);
  await page.keyboard.press("End");
  await expect(menu.getByRole("menuitem", { name: "Sign out" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(card).toBeFocused();

  await card.click();
  const signOut = page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith("/auth/signout"));
  await menu.getByRole("menuitem", { name: "Sign out" }).click();
  await signOut;
  await expect(page).toHaveURL(/#\/gallery$/);
  await ada.close();
});
