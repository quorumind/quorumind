import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { createApp, retentionDays } from "./app.ts";
import { EventBus } from "./bus.ts";
import { notifierFromEnv } from "./notifier.ts";
import { openStorage } from "./storage.ts";

const env = process.env;
const here = fileURLToPath(new URL(".", import.meta.url));
const dataDir = resolve(env.QUORUMIND_DATA_DIR ?? join(here, "../../../data"));
const webDist = resolve(env.QUORUMIND_WEB_DIST ?? join(here, "../../web/dist"));
const port = Number(env.PORT ?? 8787);
const hostname = env.HOST ?? "127.0.0.1";

// SQLite in the data directory, or PostgreSQL when DATABASE_URL (or DATABASE_URL_FILE) is set.
const storage = await openStorage(env, dataDir);
const { store, brandingStore } = storage;
const demoDelay = env.QUORUMIND_DEMO_DELAY_MS ? Number(env.QUORUMIND_DEMO_DELAY_MS) : undefined;
const api = createApp({
  store,
  brandingStore,
  bus: new EventBus(),
  env,
  notifier: notifierFromEnv(env),
  ...(demoDelay === undefined ? {} : { mockDelayMs: demoDelay }),
});

// QUORUMIND_RETENTION_DAYS: sessions untouched for that long are deleted, at start and then daily.
const retention = retentionDays(env);
if (retention !== null) {
  const purge = async () => {
    try {
      const count = await store.purgeOlderThan(retention);
      if (count > 0) console.log(`Deleted ${count} session(s) older than ${retention} days.`);
    } catch (error) {
      console.error("The retention purge failed:", error);
    }
  };
  void purge();
  setInterval(purge, 86_400_000).unref();
}

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
  console.log(
    `Quorumind is running on http://${info.address === "::" ? "localhost" : info.address}:${info.port} (data: ${storage.description})`,
  );
});

const shutdown = () => {
  storage.close().finally(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
