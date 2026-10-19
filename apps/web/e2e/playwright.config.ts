import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defineConfig } from "@playwright/test";
import { HOSTED, LOCAL } from "./servers.ts";

// The browser tests of the interface, on the built app and the recorded demo: no API key, no token spent.
// `npm run test:e2e` builds the interface, starts two servers and runs every spec of this folder:
//   - a self-hosted server (apps/server/src/main.ts) on a temporary data directory, port 8811;
//   - a hosted workspace (hosted-server.ts), whose callers are named by the x-user header, port 8812.
// On CI they run on Playwright's own Chromium (`npx playwright install chromium` once). Elsewhere they use the
// installed Microsoft Edge, or the browser channel named by QUORUMIND_E2E_CHANNEL ("chromium" for Playwright's).

const ROOT = resolve(import.meta.dirname, "../../..");
const channel = process.env.QUORUMIND_E2E_CHANNEL ?? (process.env.CI ? "chromium" : "msedge");
const node = `"${process.execPath}" --disable-warning=ExperimentalWarning`;

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  outputDir: join(ROOT, "test-results"),
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: join(ROOT, "playwright-report") }]] : "list",
  use: {
    baseURL: LOCAL,
    locale: "en-US",
    trace: "retain-on-failure",
    ...(channel === "chromium" ? {} : { channel }),
  },
  webServer: [
    {
      command: `${node} apps/server/src/main.ts`,
      cwd: ROOT,
      url: `${LOCAL}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PORT: "8811",
        HOST: "127.0.0.1",
        QUORUMIND_DATA_DIR: mkdtempSync(join(tmpdir(), "quorumind-e2e-")),
        // The demo streams fast, but still streams: the tests see roles writing.
        QUORUMIND_DEMO_DELAY_MS: "2",
        ANTHROPIC_API_KEY: "",
        OPENAI_API_KEY: "",
        GEMINI_API_KEY: "",
        OPENROUTER_API_KEY: "",
      },
    },
    {
      command: `${node} apps/web/e2e/hosted-server.ts`,
      cwd: ROOT,
      url: `${HOSTED}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { PORT: "8812" },
    },
  ],
});
