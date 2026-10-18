// Pictures and clips of Quorumind for the README and the marketing site, filmed on the recorded demo:
// no API key, no token spent. Run with `npm run media` (it builds the interface first).
//
//   docs/media/*.png             screenshots used by the README (committed)
//   docs/media/quorumind-demo.mp4 the whole demo, from the idea to the verdict (not committed)
//   SITE_MEDIA_DIR=<dir>         also copies the clip and its poster there, for the website
//
// Needs ffmpeg on the PATH, and Chromium for Playwright (`npx playwright install chromium` once).
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Browser, chromium, type Page } from "playwright";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, "docs", "media");
const SITE = process.env.SITE_MEDIA_DIR ? resolve(process.env.SITE_MEDIA_DIR) : null;
const PORT = 8899;
const BASE = `http://127.0.0.1:${PORT}`;
// 16:9, the frame of the website's video player. Stills are taken at twice that density.
const VIEWPORT = { width: 1280, height: 720 };

async function startServer(dataDir: string): Promise<ChildProcess> {
  const server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", join(ROOT, "apps/server/src/main.ts")], {
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: "127.0.0.1",
      QUORUMIND_DATA_DIR: dataDir,
      // A typing pace that reads well on video.
      QUORUMIND_DEMO_DELAY_MS: "14",
      ANTHROPIC_API_KEY: "",
      OPENAI_API_KEY: "",
    },
    stdio: "inherit",
  });
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return server;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  server.kill();
  throw new Error("The server did not start.");
}

const pause = (page: Page, ms: number) => page.waitForTimeout(ms);

/** Plays the demo like a person would, and returns the session's URL. */
async function playDemo(page: Page, shots: boolean): Promise<string> {
  await page.goto(`${BASE}/`);
  await page.getByRole("heading", { name: "New session" }).waitFor();
  await pause(page, 1200);
  if (shots) await page.screenshot({ path: join(OUT, "new-session.png") });
  await page.getByRole("button", { name: "Replay the recorded demo" }).click();

  await page.getByRole("button", { name: "Send answers" }).waitFor({ timeout: 60_000 });
  await pause(page, 1500);
  const questions = page.locator(".question");
  const count = await questions.count();
  for (let i = 0; i < count; i++) {
    await questions.nth(i).locator("button.chip").first().click();
    await pause(page, 500);
  }
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await pause(page, 600);
  if (shots) await page.screenshot({ path: join(OUT, "interview.png") });
  await page.getByRole("button", { name: "Send answers" }).click();

  await page.getByRole("heading", { name: "Check your requirements" }).waitFor({ timeout: 60_000 });
  await pause(page, 1500);
  if (shots) await page.screenshot({ path: join(OUT, "requirements.png") });
  await page.mouse.wheel(0, 500);
  await pause(page, 1200);
  await page.getByRole("button", { name: "Start the debate" }).click();

  await page.getByRole("heading", { name: "The debate needs your input" }).waitFor({ timeout: 90_000 });
  await page.getByRole("heading", { name: "The debate needs your input" }).scrollIntoViewIfNeeded();
  await pause(page, 1500);
  if (shots) await page.screenshot({ path: join(OUT, "debate.png") });
  await page.locator("#dq-0").pressSequentially("Yes, if a vendor fits the cap with EU hosting.", { delay: 35 });
  await pause(page, 600);
  await page.getByRole("button", { name: "Send and resume" }).click();

  await page.getByRole("heading", { name: "Decision matrix" }).waitFor({ timeout: 90_000 });
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await pause(page, 2000);
  if (shots) await page.screenshot({ path: join(OUT, "verdict.png") });
  await page.mouse.wheel(0, 650);
  await pause(page, 2500);
  await page.mouse.wheel(0, 650);
  await pause(page, 2500);
  return page.url();
}

async function stills(browser: Browser, sessionUrl: string) {
  const dark = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2, colorScheme: "dark", locale: "en-US" });
  await dark.goto(sessionUrl);
  await dark.getByRole("heading", { name: "Decision matrix" }).waitFor();
  await pause(dark, 800);
  await dark.screenshot({ path: join(OUT, "verdict-dark.png") });
  await dark.close();

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "en-US" });
  await phone.goto(sessionUrl);
  await phone.getByRole("heading", { name: "Decision matrix" }).waitFor();
  await pause(phone, 800);
  await phone.screenshot({ path: join(OUT, "mobile.png") });
  await phone.close();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), "quorumind-media-"));
  const server = await startServer(join(work, "data"));
  const browser = await chromium.launch();
  try {
    // Pass 1: stills, without video.
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2, locale: "en-US" });
    const sessionUrl = await playDemo(page, true);
    await page.close();
    await stills(browser, sessionUrl);

    // Pass 2: the clip, recorded at the viewport size.
    const videoDir = join(work, "video");
    const context = await browser.newContext({ viewport: VIEWPORT, locale: "en-US", recordVideo: { dir: videoDir, size: VIEWPORT } });
    const filmed = await context.newPage();
    await playDemo(filmed, false);
    await context.close();
    const recording = readdirSync(videoDir).find((file) => file.endsWith(".webm"));
    if (!recording) throw new Error("No recording was produced.");
    const clip = join(OUT, "quorumind-demo.mp4");
    execFileSync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-i",
      join(videoDir, recording),
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-crf",
      "22",
      "-preset",
      "slow",
      "-movflags",
      "+faststart",
      "-an",
      clip,
    ]);

    if (SITE) {
      mkdirSync(SITE, { recursive: true });
      copyFileSync(clip, join(SITE, "quorumind-promo.mp4"));
      copyFileSync(join(OUT, "verdict.png"), join(SITE, "poster.png"));
      for (const name of ["interview.png", "debate.png", "verdict.png", "verdict-dark.png", "mobile.png"]) {
        copyFileSync(join(OUT, name), join(SITE, name));
      }
    }
    console.log(`Media written to ${OUT}${SITE ? ` and ${SITE}` : ""}.`);
  } finally {
    await browser.close();
    // The server must have exited before its database can be removed (Windows keeps open files locked).
    const exited = once(server, "exit");
    server.kill();
    await exited;
    rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

await main();
