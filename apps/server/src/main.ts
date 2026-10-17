import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { createApp } from "./app.ts";
import { EventBus } from "./bus.ts";
import { SessionStore } from "./store.ts";

const env = process.env;
const here = fileURLToPath(new URL(".", import.meta.url));
const dataDir = resolve(env.QUORUMIND_DATA_DIR ?? join(here, "../../../data"));
const webDist = resolve(env.QUORUMIND_WEB_DIST ?? join(here, "../../web/dist"));
const port = Number(env.PORT ?? 8787);
const hostname = env.HOST ?? "127.0.0.1";

const store = new SessionStore(join(dataDir, "quorumind.db"));
const demoDelay = env.QUORUMIND_DEMO_DELAY_MS ? Number(env.QUORUMIND_DEMO_DELAY_MS) : undefined;
const api = createApp({ store, bus: new EventBus(), env, ...(demoDelay === undefined ? {} : { mockDelayMs: demoDelay }) });

const root = new Hono();
root.route("/", api);

if (existsSync(webDist)) {
  const index = readFileSync(join(webDist, "index.html"), "utf8");
  root.use("/*", serveStatic({ root: webDist }));
  // Single-page app: any other path returns the interface.
  root.get("*", (c) => c.html(index));
} else {
  console.warn(`No web build at ${webDist}. Run "npm run build" or use "npm run dev" for the interface.`);
}

serve({ fetch: root.fetch, port, hostname }, (info) => {
  console.log(`Quorumind is running on http://${info.address === "::" ? "localhost" : info.address}:${info.port}`);
});

const shutdown = () => {
  store.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
