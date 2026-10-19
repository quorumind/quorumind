import type { ModelOption, Session } from "@quorumind/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AppHooks, createApp } from "./app.ts";
import { EventBus } from "./bus.ts";
import { BACKENDS, type TestStorage } from "./testing.ts";

// A provider that refuses a hosted service's calls (no credit left, a key refused): the customers learn which model
// failed, never what the provider said about the operator's account, and the operator reads it in the server's log.

const backend = BACKENDS[0] as (typeof BACKENDS)[number];
let storage: TestStorage | null = null;

afterEach(async () => {
  await storage?.close();
  storage = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** What OpenRouter answers an account over its limit: its dashboard's address, with the key's hash. */
const RAW =
  "Key limit exceeded (monthly limit). To increase, visit https://openrouter.ai/workspaces/default/keys/5f3a9c and adjust the key's monthly limit";

const option = (model: string, maker: string): ModelOption => ({ provider: "openrouter", model, label: model, maker, local: false });
const CATALOG = [option("anthropic/claude-opus-5.5", "Anthropic"), option("mistralai/mistral-large-4-0", "Mistral")];

async function makeApp(hooks: AppHooks) {
  storage = await backend.open();
  const bus = new EventBus();
  const app = createApp({ store: storage.store, brandingStore: storage.brandingStore, bus, env: {}, mockDelayMs: 0, hooks });
  return { app, bus };
}

const hosted = (extra: AppHooks = {}): AppHooks => ({
  identify: async () => ({ userId: "ada" }),
  catalog: async () => CATALOG,
  providerEnv: () => ({ OPENROUTER_API_KEY: "key", OPENROUTER_MODELS: CATALOG.map((entry) => entry.model).join(",") }),
  ...extra,
});

const json = (body: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** OpenRouter refuses every call with this status. */
function refuseCalls(status: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ error: { code: status, message: RAW } }), { status })),
  );
}

type App = Awaited<ReturnType<typeof makeApp>>["app"];

/** A new live session, once its interview failed. */
async function failedSession(app: App): Promise<Session> {
  const created = await app.request("/api/sessions", json({ locale: "en", idea: "A booking app" }));
  const { session } = (await created.json()) as { session: Session };
  for (let i = 0; i < 400; i++) {
    const body = (await (await app.request(`/api/sessions/${session.id}`)).json()) as { session: Session; busy: boolean };
    if (!body.busy && body.session.phase === "failed") return body.session;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out");
}

/** The first `count` messages of the session's event stream; `after` runs once the first one came. */
async function firstEvents(app: App, id: string, count: number, after: () => void = () => {}): Promise<string> {
  const controller = new AbortController();
  const response = await app.request(`/api/sessions/${id}/events`, { signal: controller.signal });
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  let text = "";
  for (let i = 0; i < count; i++) {
    text += new TextDecoder().decode((await reader.read()).value);
    if (i === 0) after();
  }
  controller.abort();
  await reader.cancel();
  return text;
}

describe("a provider's refusal", () => {
  it("reaches the customers of a hosted service as its code and model only, in every view of the session", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    refuseCalls(402);
    const { app, bus } = await makeApp(hosted({ hideProviderCosts: true }));
    const session = await failedSession(app);
    expect(session.error).toEqual({ code: "provider_quota", message: "", params: { provider: "openrouter", model: expect.any(String) } });
    // Stored as it was said, for the operator.
    expect((await storage?.store.find(session.id))?.session.error?.message).toContain("openrouter.ai/workspaces");

    const stored = (await storage?.store.find(session.id))?.session as Session;
    const events = await firstEvents(app, session.id, 2, () => bus.publish(session.id, { type: "session", session: stored }));
    expect(events).toContain('"provider_quota"');
    expect(events).not.toContain("openrouter.ai");

    // A revision that failed the same way, and the web research.
    const research = { status: "failed", error: stored.error } as unknown as Session["research"];
    const revising = { ...stored, research, revising: { id: "r", number: 2, error: stored.error } } as unknown as Session;
    await storage?.store.save(revising, "ada");
    const detail = await (await app.request(`/api/sessions/${session.id}`)).text();
    expect(detail).toContain('"provider_quota"');
    expect(detail).not.toContain("openrouter.ai");

    const made = await app.request(`/api/sessions/${session.id}/share`, json({ mode: "full" }));
    const { token } = ((await made.json()) as { share: { token: string } }).share;
    const shared = await (await app.request(`/api/shared/${token}`)).text();
    expect(shared).toContain('"provider_quota"');
    expect(shared).not.toContain("openrouter.ai");
    expect(await (await app.request("/api/export")).text()).not.toContain("openrouter.ai");
  });

  it("keeps the provider's words on a server that shows provider costs", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    refuseCalls(402);
    const { app } = await makeApp(hosted());
    expect((await failedSession(app)).error?.message).toContain("openrouter.ai/workspaces");
  });

  it("tells the operator once in a while, without the provider's message, however many sessions it stops", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    refuseCalls(402);
    const { app } = await makeApp(hosted({ hideProviderCosts: true }));
    const first = await failedSession(app);
    await failedSession(app);
    const lines = errors.mock.calls.map((call) => call.map(String).join(" ")).filter((line) => line.includes("provider_quota"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(
      `Session ${first.id} failed with provider_quota (provider openrouter, model ${first.error?.params?.model}): ` +
        "the provider account has no credit left or reached its spending limit.",
    );

    // Another code is another line.
    refuseCalls(401);
    await failedSession(app);
    expect(errors.mock.calls.filter((call) => String(call[0]).includes("provider_auth"))).toHaveLength(1);
  });
});
