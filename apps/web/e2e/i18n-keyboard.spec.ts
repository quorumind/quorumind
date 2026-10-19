import { expect, test } from "@playwright/test";
import { demoToVerdict } from "./servers.ts";

test("Arabic lays the app out right to left, and the tab keys follow", async ({ page, request }) => {
  const id = await demoToVerdict(request);
  await page.addInitScript(() => localStorage.setItem("quorumind.locale", "ar"));
  await page.goto(`/#/s/${id}`);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.getByRole("link", { name: "جلسة جديدة" }).first()).toBeVisible();

  const tabs = page.getByRole("tab");
  await tabs.first().focus();
  // In right-to-left, the left arrow goes to the next tab.
  await page.keyboard.press("ArrowLeft");
  await expect(tabs.nth(1)).toBeFocused();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(tabs.first()).toBeFocused();

  // No horizontal scroll on a phone.
  await page.setViewportSize({ width: 375, height: 800 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("the keyboard reaches the content, the dialogs keep and give back the focus", async ({ page, request }) => {
  const id = await demoToVerdict(request);
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("button", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();

  await page.goto(`/#/s/${id}`);
  const opener = page.getByRole("button", { name: "Delete" });
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Delete this session?" });
  await expect(dialog).toBeVisible();
  // Tab goes round the dialog's buttons.
  for (let step = 0; step < 4; step++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("a navigation names the tab and moves the focus to the new page's heading", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Decisions" }).click();
  const heading = page.getByRole("heading", { level: 1, name: "Decision register" });
  await expect(heading).toBeFocused();
  await expect(page).toHaveTitle("Decision register · Quorumind");
});

test("a client's questionnaire in another language leaves the app's language as it was", async ({ page, request }) => {
  const id = await demoToVerdict(request, undefined, {}, "fr");
  const created = await request.post(`/api/sessions/${id}/questionnaires`, {
    data: { questions: [{ text: "Combien de studios ?", why: null, origin: "agency" }], client: null, message: null },
  });
  const { token } = ((await created.json()) as { questionnaire: { token: string } }).questionnaire;
  // The session is in French: its questionnaire is shown in French, then the app comes back in English.
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.evaluate((link) => {
    window.location.hash = link;
  }, `#/q/${token}`);
  await expect(page.getByRole("button", { name: "Envoyer mes réponses" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await page.evaluate(() => {
    window.location.hash = "#/settings";
  });
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(await page.evaluate(() => localStorage.getItem("quorumind.locale"))).toBeNull();
});
