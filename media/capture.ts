// Pictures and clips of Quorumind for the README and the marketing site, filmed on the recorded demo:
// no API key, no token spent. Run with `npm run media` (it builds the interface first).
//
//   docs/media/*.png              screenshots used by the README (committed)
//   docs/media/quorumind-demo.mp4 the whole demo, from the idea to the verdict (not committed; needs ffmpeg)
//   SITE_MEDIA_DIR=<dir>          also writes there the site's stills (app-verdict|matrix|report-light|dark.webp,
//                                 1280 CSS px wide at 2x, each ending on the edge of a card) and their sizes
//                                 (app-stills.json) and, when the clip is made, the clip and its poster
//
// Stills only, with no ffmpeg: `npm run media -- --stills` (or QUORUMIND_MEDIA_STILLS=1). The video is then skipped,
// and the run says so. Without that flag ffmpeg must be on the PATH, which is checked before anything is filmed.
// Chromium for Playwright is needed either way (`npx playwright install chromium` once). QUORUMIND_MEDIA_PORT
// changes the port of the throwaway server (8899 by default).
//
// The demo's content is English, so every picture is taken with the interface in English. The page is driven by
// roles and accessible names, as the end-to-end tests do (apps/web/e2e/demo.spec.ts): if a label changes there, it
// changes here.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Browser, chromium, type Locator, type Page } from "playwright";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, "docs", "media");
const SITE = process.env.SITE_MEDIA_DIR ? resolve(process.env.SITE_MEDIA_DIR) : null;
const PORT = Number(process.env.QUORUMIND_MEDIA_PORT ?? 8899);
const STILLS_ONLY = process.argv.includes("--stills") || process.env.QUORUMIND_MEDIA_STILLS === "1";
const BASE = `http://127.0.0.1:${PORT}`;
const SCHEMES = ["light", "dark"] as const;
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

/**
 * Waits for the page to settle: fonts loaded, transitions finished and two frames painted. The network is never idle
 * here (the live event stream stays open), so it is not waited for.
 */
const settle = (page: Page) =>
  page.evaluate(async () => {
    await document.fonts.ready;
    // Only the animations that run on the clock and have an end are waited for: a spinner or a pulse never ends,
    // and one tied to the scroll position (animation-timeline) never finishes by itself.
    const finite = document
      .getAnimations()
      .filter(
        (animation) =>
          animation.timeline === document.timeline && animation.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY,
      );
    await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)));
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  });

/** In the clip the pauses pace the film for viewers, so they are real. For stills nothing needs time, only to settle. */
const pause = (page: Page, ms: number) => (STILLS_ONLY ? settle(page) : page.waitForTimeout(ms));

/** Plays the demo like a person would, and returns the session's URL. */
async function playDemo(page: Page, shots: boolean): Promise<string> {
  await page.goto(`${BASE}/`);
  await page.getByRole("heading", { name: "New debate", exact: true }).waitFor();
  await pause(page, 1200);
  if (shots) await page.screenshot({ path: join(OUT, "new-debate.png") });
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

/** Scrolls an element to the top of the window, a little below the edge so its heading is not cut. */
async function bringToTop(page: Page, target: Locator) {
  await target.evaluate((element) => element.scrollIntoView({ block: "start" }));
  await page.evaluate(() => window.scrollBy(0, -24));
  await pause(page, 500);
}

/** Waits until a card stops changing height (text still arriving, fonts swapping): its size is then final. */
async function settleHeight(target: Locator) {
  await target.evaluate(async (element) => {
    let last = -1;
    let steady = 0;
    while (steady < 10) {
      await new Promise((done) => requestAnimationFrame(done));
      const height = element.getBoundingClientRect().height;
      steady = height === last ? steady + 1 : 0;
      last = height;
    }
  });
}

/**
 * Makes the window end on the boundary of a card: half way down the gap that follows `last`, so that no line of the
 * next card shows at the bottom edge. The width stays that of every still; the height is the picture's.
 */
async function endAfter(page: Page, last: Locator, place: () => Promise<void>) {
  await settle(page);
  await settleHeight(last);
  await place();
  const bottom = await last.evaluate((element) => {
    const gap = Number.parseFloat(getComputedStyle(element.parentElement ?? element).rowGap) || 0;
    return element.getBoundingClientRect().bottom + gap / 2;
  });
  await page.setViewportSize({ width: VIEWPORT.width, height: Math.ceil(bottom) });
  await place();
  await settle(page);
}

/** Encodes a PNG as WebP with Chromium's own encoder, so the site's images need no new dependency. */
async function toWebp(browser: Browser, png: Buffer, quality: number): Promise<Buffer> {
  const page = await browser.newPage();
  try {
    const encoded = await page.evaluate(
      async ({ data, quality }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${data}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext("2d")?.drawImage(image, 0, 0);
        return canvas.toDataURL("image/webp", quality);
      },
      { data: png.toString("base64"), quality },
    );
    if (!encoded.startsWith("data:image/webp")) throw new Error("This Chromium cannot encode WebP.");
    return Buffer.from(encoded.slice(encoded.indexOf(",") + 1), "base64");
  } finally {
    await page.close();
  }
}

const SITE_STILL_LIMIT = 250 * 1024;

/** The stills of the website, in both colour schemes: the verdict, the decision matrix and the CTO's version of it. */
async function siteStills(browser: Browser, sessionUrl: string, dir: string) {
  mkdirSync(dir, { recursive: true });
  const sizes: Record<string, { width: number; height: number }> = {};
  for (const scheme of SCHEMES) {
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2, colorScheme: scheme, locale: "en-US" });
    await page.goto(sessionUrl);
    const matrix = page.getByRole("heading", { name: "Decision matrix" });
    await matrix.waitFor();
    await pause(page, 800);
    const shots: Array<[string, Buffer]> = [];
    const card = (heading: Locator) => heading.locator("xpath=ancestor::section[1]");
    const top = () => page.evaluate(() => window.scrollTo({ top: 0 }));

    // The verdict: the header, the tabs and the ink banner, ending between the banner and the decision panel.
    await endAfter(page, page.locator(".verdict-panel"), top);
    shots.push(["app-verdict", await page.screenshot()]);

    // The CTO's version, written by the demo model on first use: the reader's switch and the brief, whole.
    await page.getByRole("button", { name: "CTO", exact: true }).click();
    const write = page.getByRole("button", { name: "Write this version" });
    if (await write.isVisible()) await write.click();
    await write.waitFor({ state: "hidden", timeout: 30_000 });
    const reader = page.getByRole("heading", { name: "Read it as" });
    await endAfter(page, card(reader), () => bringToTop(page, reader));
    shots.push(["app-report", await page.screenshot()]);

    // The decision matrix with its sliders and its note, back on the full verdict.
    await page.getByRole("button", { name: "Full verdict" }).click();
    await endAfter(page, card(matrix), () => bringToTop(page, matrix));
    shots.push(["app-matrix", await page.screenshot()]);
    await page.close();

    for (const [name, png] of shots) {
      let quality = 0.86;
      let webp = await toWebp(browser, png, quality);
      while (webp.length > SITE_STILL_LIMIT && quality > 0.5) {
        quality -= 0.06;
        webp = await toWebp(browser, png, quality);
      }
      const file = join(dir, `${name}-${scheme}.webp`);
      writeFileSync(file, webp);
      // A PNG's header holds its size: width and height are the 17th to 24th bytes.
      const size = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
      sizes[`${name}-${scheme}`] = size;
      console.log(`${file}  ${Math.round(webp.length / 1024)} KB  ${size.width}x${size.height}  (quality ${quality.toFixed(2)})`);
    }
  }
  // The site reads the sizes to give each picture its width and height (no layout shift).
  writeFileSync(join(dir, "app-stills.json"), `${JSON.stringify(sizes, null, 2)}\n`);
}

/** The README's second verdict (dark) and the phone one. */
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

function hasFfmpeg(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!STILLS_ONLY && !hasFfmpeg()) {
    throw new Error("ffmpeg is not on the PATH, and the demo clip needs it. For the pictures alone, run `npm run media -- --stills`.");
  }
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
    if (SITE) await siteStills(browser, sessionUrl, SITE);

    if (STILLS_ONLY) {
      console.log(`Stills written to ${OUT}${SITE ? ` and ${SITE}` : ""}. The demo video is skipped (--stills).`);
      return;
    }

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
      copyFileSync(clip, join(SITE, "quorumind-promo.mp4"));
      copyFileSync(join(OUT, "verdict.png"), join(SITE, "poster.png"));
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
