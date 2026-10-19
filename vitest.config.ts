import { defineConfig } from "vitest/config";

// Unit tests run in Node. The interface's component tests (*.test.tsx) ask for a DOM with a
// `@vitest-environment happy-dom` comment. The browser tests of apps/web/e2e run apart: `npm run test:e2e`.
export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "apps/**/*.test.tsx"],
  },
});
