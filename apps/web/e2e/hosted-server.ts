// A server for the browser tests of a hosted workspace: the API with the hooks a host sets, on the demo model, serving
// the built interface. The caller is named by the x-user header (the tests set it per browser context), and every
// caller belongs to one workspace, so members read each other's sessions and only an author may change them.
//
//   PORT=8812 node apps/web/e2e/hosted-server.ts
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { createApp } from "../../server/src/app.ts";
import { SqliteBrandingStore } from "../../server/src/branding.ts";
import { EventBus } from "../../server/src/bus.ts";
import { SqliteSessionStore } from "../../server/src/store.ts";

const port = Number(process.env.PORT ?? 8812);
const webDist = resolve(import.meta.dirname, "../dist");
const store = new SqliteSessionStore(join(mkdtempSync(join(tmpdir(), "quorumind-e2e-hosted-")), "quorumind.db"));
const names: Record<string, string> = { ada: "Ada Lovelace", bob: "Bob Martin" };

const api = createApp({
  store,
  brandingStore: new SqliteBrandingStore(store.db),
  bus: new EventBus(),
  env: {},
  mockDelayMs: 1,
  hooks: {
    identify: async (request) => {
      const user = request.headers.get("x-user");
      return user ? { userId: user } : null;
    },
    catalog: async () => [{ provider: "mock", model: "mock", label: "Demo", local: false }],
    scope: async () => ({ workspace: "studio", workspaces: ["studio"] }),
    authors: async (owners) => Object.fromEntries(owners.map((owner) => [owner, { name: names[owner] ?? owner, email: null }])),
    // The host's part of the menu: the one workspace, its pages and the person's, and the way to sign out.
    navigation: async (user) => ({
      workspaces: {
        list: [
          {
            name: "Studio",
            role: user.userId === "ada" ? "owner" : "member",
            current: true,
            switchUrl: "/api/host/workspaces/studio/switch",
          },
        ],
        createUrl: "/account/#/workspaces/new",
      },
      links: (["home", "billing", "members", "profile", "account"] as const).map((kind) => ({ kind, url: `/account/#/${kind}` })),
      user: { name: names[user.userId] ?? null, email: `${user.userId}@example.com` },
      siteUrl: null,
      signOut: { url: "/auth/signout", next: "/#/gallery" },
    }),
  },
});

const root = new Hono();
// Signing out, as the host does it: the browser tests only check that the menu asks for it.
root.post("/auth/signout", (c) => c.json({ ok: true }));
root.route("/", api);
const index = readFileSync(join(webDist, "index.html"), "utf8");
root.use("/*", serveStatic({ root: webDist }));
root.get("*", (c) => c.html(index));

serve({ fetch: root.fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.log(`Hosted test server on http://127.0.0.1:${info.port}`);
});
