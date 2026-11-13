import { expect, test } from "@playwright/test";
import { HOSTED, watchConsole } from "./servers.ts";

// The history beyond one page: fifty debates come first, a button brings the others, the focus and the announcement
// follow, and the search reaches the oldest debate though it is not on the first page.

test.describe("a history of more than fifty debates", () => {
  const user = `historian-${Date.now()}`;
  // One worker seeds the history once, for both tests.
  test.describe.configure({ mode: "serial" });
  test.use({ baseURL: HOSTED, extraHTTPHeaders: { "x-user": user } });

  test.beforeAll(async ({ request }) => {
    // The oldest first, so the one the search must reach is far behind the first page.
    for (let index = 0; index < 57; index++) {
      const response = await request.post(`${HOSTED}/api/sessions`, {
        headers: { "x-user": user },
        data: {
          locale: "en",
          idea: index === 0 ? "Zeppelin freight planner" : `Archive debate ${index}`,
          demo: true,
          mode: "standard",
          template: null,
          complianceTemplates: [],
          europeanOnly: false,
        },
      });
      expect(response.ok(), await response.text()).toBe(true);
      // Two debates never share a millisecond, so the order is the one they were made in.
      await new Promise((resolve) => setTimeout(resolve, 3));
    }
  });

  test("shows fifty, adds the rest on request, and moves the focus to the first new debate", async ({ page }) => {
    const problems = watchConsole(page);
    await page.goto("/#/sessions");
    await page.getByRole("button", { name: "Mine" }).click();
    const list = page.getByRole("list", { name: "Debates", exact: true });
    await expect(list.getByRole("listitem")).toHaveCount(50);
    const more = page.getByRole("button", { name: "Show more" });
    await more.focus();
    await more.press("Enter");
    await expect(list.getByRole("listitem")).toHaveCount(57);
    await expect(more).toHaveCount(0);
    // The button is gone: the first debate that came is focused, not the top of the page.
    await expect(list.getByRole("listitem").nth(50).getByRole("link")).toBeFocused();
    await expect(page.locator(".show-more [aria-live]")).toHaveText("Shown: 57 (+7).");
    expect(problems).toEqual([]);
  });

  test("finds the oldest debate by search, though the first page does not hold it", async ({ page }) => {
    await page.goto("/#/sessions");
    await page.getByRole("button", { name: "Mine" }).click();
    const list = page.getByRole("list", { name: "Debates", exact: true });
    await expect(list.getByRole("listitem")).toHaveCount(50);
    await expect(list.getByRole("link", { name: /Zeppelin/ })).toHaveCount(0);
    await page.getByRole("searchbox", { name: "Search by title" }).fill("zeppelin");
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await expect(list.getByRole("link", { name: /Zeppelin freight planner/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Show more" })).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "Results: 1" })).toHaveCount(1);
  });
});
