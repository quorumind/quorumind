import { afterEach, describe, expect, it } from "vitest";
import { type AppHooks, createApp, type HostNavigation } from "./app.ts";
import { EventBus } from "./bus.ts";
import { BACKENDS, type TestStorage } from "./testing.ts";

// The host's part of the menu, as /api/config sends it: none self-hosted, the host's for the caller otherwise.

const backend = BACKENDS[0] as (typeof BACKENDS)[number];
let storage: TestStorage | null = null;

async function makeApp(hooks?: AppHooks) {
  storage = await backend.open();
  return createApp({
    store: storage.store,
    brandingStore: storage.brandingStore,
    bus: new EventBus(),
    env: {},
    mockDelayMs: 0,
    ...(hooks ? { hooks } : {}),
  });
}

afterEach(async () => {
  await storage?.close();
  storage = null;
});

const as = (user: string) => ({ "x-user": user });

async function navigation(app: Awaited<ReturnType<typeof makeApp>>, user?: string) {
  const response = await app.request("/api/config", user ? { headers: as(user) } : undefined);
  expect(response.status).toBe(200);
  return ((await response.json()) as { navigation: HostNavigation | null }).navigation;
}

const identify: AppHooks["identify"] = async (request) => {
  const user = request.headers.get("x-user");
  return user ? { userId: user } : null;
};

const menuOf = (userId: string): HostNavigation => ({
  workspaces: {
    list: [{ name: "Team", role: userId === "ada" ? "owner" : "member", current: true, switchUrl: "/host/workspaces/team/switch" }],
    createUrl: "/host/#/workspaces/new",
  },
  links: [{ kind: "billing", url: "/host/#/billing" }, ...(userId === "ada" ? [{ kind: "staff" as const, url: "/host/#/staff" }] : [])],
  user: { name: userId === "ada" ? "Ada" : null, email: `${userId}@example.com` },
  siteUrl: "https://example.com",
});

describe("the host's part of the menu", () => {
  it("is none self-hosted", async () => {
    expect(await navigation(await makeApp())).toBeNull();
  });

  it("is none when the host identifies people but has no menu of its own", async () => {
    expect(await navigation(await makeApp({ identify }), "ada")).toBeNull();
  });

  it("is the host's, for the person who asks", async () => {
    const asked: string[] = [];
    const app = await makeApp({
      identify,
      navigation: async (user) => {
        asked.push(user.userId);
        return menuOf(user.userId);
      },
    });
    expect(await navigation(app, "ada")).toEqual(menuOf("ada"));
    expect(await navigation(app, "bob")).toEqual(menuOf("bob"));
    expect(asked).toEqual(["ada", "bob"]);
  });

  it("is none for nobody signed in, and when the host has none for the caller", async () => {
    const app = await makeApp({ identify, navigation: async (user) => (user.userId === "ada" ? menuOf("ada") : null) });
    expect(await navigation(app)).toBeNull();
    expect(await navigation(app, "bob")).toBeNull();
    expect(await navigation(app, "ada")).not.toBeNull();
  });
});
