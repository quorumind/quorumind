import { expect, test } from "@playwright/test";
import { demoToVerdict, LOCAL, startDemo, waitForPhase } from "./servers.ts";

test("a full share link made mid-interview is read-only, outside the app", async ({ page, request }) => {
  const id = await startDemo(request);
  await waitForPhase(request, id, "interview");
  const share = await request.post(`${LOCAL}/api/sessions/${id}/share`, { data: { mode: "full", expiresIn: "7d" } });
  const { token } = ((await share.json()) as { share: { token: string } }).share;

  await page.goto(`/#/shared/${token}`);
  await expect(page.getByText("You are reading a shared session. It cannot be changed.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send answers" })).toHaveCount(0);
  await expect(page.locator("textarea")).toHaveCount(0);
  // No sidebar: neither the app's actions nor the history of the server's sessions.
  await expect(page.getByRole("link", { name: "New session" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Main menu" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Sessions" })).toHaveCount(0);
});

test("Enter in the share password sets it, and the link then asks for it", async ({ page, request, browser }) => {
  const id = await demoToVerdict(request);
  await page.goto(`/#/s/${id}`);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Share this session" });
  await dialog.getByRole("button", { name: "Create a read-only link" }).click();
  const field = dialog.getByLabel("Password");
  await field.fill("s3cret-pass");
  await field.press("Enter");
  await expect(dialog.getByText("This link asks for a password.")).toBeVisible();
  await expect(dialog).toBeVisible();
  const link = await dialog.getByRole("textbox", { name: "Link" }).inputValue();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  // The focus is back on the button that opened the dialog.
  await expect(page.getByRole("button", { name: "Shared", exact: true })).toBeFocused();

  const visitor = await browser.newPage();
  await visitor.goto(link);
  await expect(visitor.getByRole("heading", { name: "This report is protected" })).toBeVisible();
  await visitor.getByLabel("Password").fill("s3cret-pass");
  await visitor.getByRole("button", { name: "Open the report" }).click();
  await expect(visitor.getByText("You are reading a decision report someone shared with you.")).toBeVisible();
  // A reload keeps the access for the tab.
  await visitor.reload();
  await expect(visitor.getByText("You are reading a decision report someone shared with you.")).toBeVisible();
  await visitor.close();
});
