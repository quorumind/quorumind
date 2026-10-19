import { expect, test } from "@playwright/test";
import { watchConsole } from "./servers.ts";

test("the recorded demo, from the idea to the verdict", async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto("/");
  await expect(page).toHaveTitle("New session · Quorumind");
  await page.getByRole("button", { name: "Replay the recorded demo" }).click();

  // Interview: one suggested answer per question.
  const send = page.getByRole("button", { name: "Send answers" });
  await send.waitFor({ timeout: 60_000 });
  const questions = page.locator(".question");
  for (let index = 0; index < (await questions.count()); index++) await questions.nth(index).locator("button.chip").first().click();
  await send.click();

  // Requirements, then the debate.
  await expect(page.getByRole("heading", { name: "Check your requirements" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Start the debate" }).click();
  await expect(page.getByRole("heading", { name: "The debate needs your input" })).toBeVisible({ timeout: 90_000 });
  await page.locator("#dq-0").fill("Yes, if a vendor fits the cap with EU hosting.");
  await page.getByRole("button", { name: "Send and resume" }).click();

  // The verdict: its tab, the steps all done, the matrix.
  await expect(page.getByRole("heading", { name: "Decision matrix" })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("tab", { name: "Verdict" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".progress li[aria-current='step']")).toHaveText("Verdict");
  await expect(page.locator(".session-meta-row .cost")).toBeVisible();
  for (const tab of ["Debate", "Requirements", "Interview", "Costs"]) await expect(page.getByRole("tab", { name: tab })).toBeVisible();
  // Every task of the Costs tab has its name, not a translation key.
  await page.getByRole("tab", { name: "Costs" }).click();
  await expect(page.getByRole("tabpanel")).not.toContainText("task.");
  await expect(page).toHaveTitle(/· Quorumind$/);
  expect(problems).toEqual([]);
});

test("the page comes back after the live events fail with an HTTP error", async ({ page }) => {
  let refused = 0;
  await page.route("**/api/sessions/*/events", async (route) => {
    // A proxy answering 502 while the server restarts: the browser gives the stream up for good.
    if (refused < 2) {
      refused++;
      await route.fulfill({ status: 502, body: "Bad gateway" });
      return;
    }
    await route.fallback();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Replay the recorded demo" }).click();
  await expect(page.getByRole("button", { name: "Send answers" })).toBeVisible({ timeout: 30_000 });
  expect(refused).toBe(2);
});
