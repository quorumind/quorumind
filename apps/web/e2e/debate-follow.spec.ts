import { expect, type Page, test } from "@playwright/test";
import { LOCAL, startDemo, waitForPhase, watchConsole } from "./servers.ts";

// Following a live debate: where the keyboard goes at each change of phase, the banner of a debate that waits for the
// person, the verdict arriving at its top, and what a screen reader hears (each step once, never each voice).

/** Records where the focus goes and what the page's polite region says, from the first paint. */
async function record(page: Page) {
  await page.addInitScript(() => {
    const log = window as unknown as { focusLog: string[]; said: string[] };
    log.focusLog = [];
    log.said = [];
    document.addEventListener("focusin", (event) => {
      const target = event.target as HTMLElement;
      const name = target.id ? `#${target.id}` : target.hasAttribute("data-answers") ? "[data-answers]" : "";
      log.focusLog.push(`${target.tagName}${name} ${(target.textContent ?? "").trim().slice(0, 40)}`);
    });
    new MutationObserver(() => {
      const region = document.querySelector(".session > p[role=status]");
      const text = region?.textContent ?? "";
      if (text && log.said.at(-1) !== text) log.said.push(text);
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
}

/** The steps of the demo's debate, in the order it goes through them. */
const STEPS = ["Web research", "Blind proposals", "Round 1 of 1: critiques", "Round 1 of 1: revisions", "The arbiter steps in", "Verdict"];

/** Steps heard only once each and never backwards, however the events of the debate were batched. */
function expectForward(heard: string[]) {
  const ranks = heard.map((text) => STEPS.indexOf(text.trim())).filter((rank) => rank >= 0);
  for (let index = 1; index < ranks.length; index++) {
    expect(ranks[index], `heard ${JSON.stringify(heard)}`).toBeGreaterThan(ranks[index - 1] as number);
  }
}

const focusLog = (page: Page) => page.evaluate(() => (window as unknown as { focusLog: string[] }).focusLog);
const said = (page: Page) => page.evaluate(() => (window as unknown as { said: string[] }).said);

test("the keyboard follows the debate from the interview to the verdict", async ({ page }) => {
  const problems = watchConsole(page);
  await record(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Replay the recorded demo" }).click();

  // Interview, sent from the keyboard: its form goes away, the requirements' title takes the focus.
  const send = page.getByRole("button", { name: "Send answers" });
  await send.waitFor({ timeout: 60_000 });
  const questions = page.locator(".question");
  for (let index = 0; index < (await questions.count()); index++) await questions.nth(index).locator("button.chip").first().click();
  await send.focus();
  await page.keyboard.press("Enter");
  const requirements = page.getByRole("heading", { name: "Check your requirements" });
  await expect(requirements).toBeFocused({ timeout: 60_000 });

  // Start the debate: the page's title, then the banner of the question, with the focus and no jump: the banner is in
  // view and the page still shows its top (the session's heading). How far the page is scrolled otherwise depends on
  // how much of the replay the first render of the debate holds, which no assertion should rely on.
  await page.getByRole("button", { name: "Start the debate" }).focus();
  await page.keyboard.press("Enter");
  const banner = page.getByRole("heading", { name: "The debate is waiting for your answer" });
  await expect(banner).toBeFocused({ timeout: 90_000 });
  await expect(page).toHaveTitle(/^\(1\) .* · Quorumind$/);
  await expect(page.locator(".progress li[aria-current='step']")).toHaveText("Your input");
  const view = await page.evaluate(() => {
    const banner = document.activeElement?.getBoundingClientRect();
    const head = document.querySelector(".session-head")?.getBoundingClientRect();
    return { banner: banner && { top: banner.top, bottom: banner.bottom }, headBottom: head?.bottom ?? -1, height: window.innerHeight };
  });
  expect(view.banner?.top).toBeGreaterThanOrEqual(0);
  expect(view.banner?.bottom).toBeLessThanOrEqual(view.height);
  expect(view.headBottom).toBeGreaterThan(0);
  expect((await focusLog(page)).some((entry) => entry.startsWith("H1"))).toBe(true);

  // The banner's button takes the keyboard to the question, which comes into view.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Answer now" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "The debate needs your input" })).toBeFocused();
  await expect(page.locator("#dq-0")).toBeInViewport();
  await page.locator("#dq-0").fill("Yes, if a vendor fits the cap with EU hosting.");
  await page.getByRole("button", { name: "Send and resume" }).focus();
  await page.keyboard.press("Enter");

  // The verdict: its tab, at its top, its recommendation focused.
  await expect(page.getByRole("tab", { name: "Verdict" })).toHaveAttribute("aria-selected", "true", { timeout: 90_000 });
  await expect(page.locator(".verdict-panel h2")).toBeFocused();
  const top = await page.locator("#tab-panel").evaluate((panel) => panel.getBoundingClientRect().top);
  expect(top).toBeGreaterThanOrEqual(0);
  expect(top).toBeLessThan(page.viewportSize()?.height ?? 720);
  await expect(page).not.toHaveTitle(/^\(1\)/);

  // In order: the requirements, the page's title, the banner, the question, the person's answers, the verdict.
  const log = await focusLog(page);
  const order = ["H2 Check your requirements", "H1", "H2#awaiting-title", "H3#debate-questions-title", "DIV[data-answers]", "H2"];
  let at = -1;
  for (const expected of order) {
    const next = log.findIndex((entry, index) => index > at && entry.startsWith(expected));
    expect(next, `${expected} after ${log[at] ?? "the start"} in ${JSON.stringify(log)}`).toBeGreaterThan(at);
    at = next;
  }
  // Each step announced once and only forward, whatever the timing of the events; never each voice.
  const heard = await said(page);
  expect(heard.some((text) => text.startsWith("Writing now"))).toBe(false);
  expectForward(heard);
  expect(problems).toEqual([]);
});

test("a person reading elsewhere keeps their focus and hears the question and the verdict once", async ({ page, request }) => {
  const id = await startDemo(request);
  await waitForPhase(request, id, "interview");
  await expect
    .poll(
      async () =>
        ((await (await request.get(`${LOCAL}/api/sessions/${id}`)).json()) as { session: { interview: unknown[] } }).session.interview
          .length,
    )
    .toBeGreaterThan(0);
  await request.post(`${LOCAL}/api/sessions/${id}/interview`, { data: { answers: [{ question: "Budget?", answer: "€15,000" }] } });
  await waitForPhase(request, id, "review");

  await record(page);
  await page.goto(`/#/s/${id}`);
  await expect(page.getByRole("heading", { name: "Check your requirements" })).toBeVisible();
  // The person reads the interview tab, from the keyboard, while the debate runs.
  const interview = page.getByRole("tab", { name: "Interview" });
  await interview.focus();
  const { session } = (await (await request.get(`${LOCAL}/api/sessions/${id}`)).json()) as { session: { sheet: unknown } };
  await request.put(`${LOCAL}/api/sessions/${id}/sheet`, { data: { sheet: session.sheet } });

  await expect(page.getByRole("heading", { name: "The debate is waiting for your answer" })).toBeVisible({ timeout: 90_000 });
  await expect(interview).toBeFocused();
  await expect.poll(() => said(page)).toContain("The debate is waiting for your answer");

  await request.post(`${LOCAL}/api/sessions/${id}/answers`, { data: { answers: [{ question: "Hosted?", answer: "Yes" }] } });
  await expect(page.locator(".verdict-panel")).toBeVisible({ timeout: 90_000 });
  await expect(interview).toBeFocused();
  await expect.poll(() => said(page)).toContain("The verdict is ready");
  const heard = await said(page);
  expect(heard.filter((text) => text === "The verdict is ready")).toHaveLength(1);
  expect(heard.some((text) => text.startsWith("Round 1 of 1"))).toBe(true);
  expect(heard.some((text) => text.startsWith("Writing now"))).toBe(false);
  // Each phase of the debate (before the question, after it) says its steps forward only.
  const question = heard.indexOf("The debate is waiting for your answer");
  expectForward(heard.slice(0, question));
  expectForward(heard.slice(question + 1));
});
