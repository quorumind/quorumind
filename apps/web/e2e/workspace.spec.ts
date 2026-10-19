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
