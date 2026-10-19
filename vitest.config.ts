import { defineConfig } from "vitest/config";

// Unit tests run in Node. The interface's component tests (*.test.tsx) ask for a DOM with a
// `@vitest-environment happy-dom` comment. The browser tests of apps/web/e2e run apart: `npm run test:e2e`.
export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "apps/**/*.test.tsx"],
    // The API tests take whole debates through the routes, on SQLite and on PostgreSQL (PGlite, compiled to
    // WebAssembly): a second or two each alone, several times that when every test file runs at once on a busy machine.
    testTimeout: 30_000,
  },
});
