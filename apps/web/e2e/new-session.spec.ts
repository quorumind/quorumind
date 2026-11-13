import { expect, test } from "@playwright/test";
import { HOSTED, watchConsole } from "./servers.ts";

// A new session, step by step, on the hosted workspace: its catalog is the demo model, so a live session spends nothing.

test.use({ baseURL: HOSTED, extraHTTPHeaders: { "x-user": "ada" } });

test("the four steps of a new session, from the need to the interview", async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto("/");
  const steps = page.getByRole("navigation", { name: "Steps of the new debate" });
  const next = page.getByRole("button", { name: "Next" });

  // The need: nothing goes on until it is described. The button stays active; sending it says what is missing, under the
  // field, and puts the focus there.
  await expect(next).toBeEnabled();
  await next.click();
  const idea = page.getByLabel("Your project idea");
  await expect(idea).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Describe your project to continue.")).toBeVisible();
  await expect(idea).toBeFocused();
  await idea.fill("A booking app for our 12 yoga studios");
  await expect(idea).not.toHaveAttribute("aria-invalid", "true");
  await next.click();
  await expect(page.getByRole("heading", { level: 2, name: "Context" })).toBeFocused();

  // The context is optional, the panel shows its summary first.
  await next.click();
  await expect(page.getByRole("heading", { level: 2, name: "The panel" })).toBeFocused();
  await page.getByRole("button", { name: "Customise the panel" }).click();
  await page.getByRole("switch", { name: "Devil's advocate" }).check();
  await page.getByRole("radio", { name: /Two rounds/ }).check();

  // A step done opens again from the stepper, with what was typed.
  await steps.getByRole("button", { name: /Your need/ }).click();
  await expect(page.getByLabel("Your project idea")).toHaveValue("A booking app for our 12 yoga studios");
  await steps.getByRole("button", { name: /The panel/ }).click();
  await expect(page.getByRole("radio", { name: /Two rounds/ })).toBeChecked();
  await next.click();

  // The summary, then the launch.
  await expect(page.getByRole("heading", { level: 2, name: "Summary" })).toBeFocused();
  await expect(page.getByText(/Devil's advocate · Two rounds/)).toBeVisible();
  // The demo model costs nothing: the summary says so instead of a range from $0.00 to $0.00.
  await expect(page.getByText("Free: demo model.")).toBeVisible();
  await page.getByRole("button", { name: /Start the interview/ }).click();
  await expect(page.getByRole("button", { name: "Send answers" })).toBeVisible({ timeout: 60_000 });
  expect(problems).toEqual([]);
});
