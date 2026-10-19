import { DEMO_SHEET, type ModelOption, type Session, setModelPrice } from "@quorumind/core";
import { afterEach, describe, expect, it } from "vitest";
import { type AppHooks, createApp } from "./app.ts";
import { EventBus } from "./bus.ts";
import { BACKENDS, type TestStorage } from "./testing.ts";

// Web research as the API takes it: offered once a search engine is configured, ticked by default (or by the host's
// tiers), never for a European-only debate unless asked, in which case the report says why. The background interview
// of a live session reaches no model here: OpenRouter points at a closed local port.

const backend = BACKENDS[0] as (typeof BACKENDS)[number];
let storage: TestStorage | null = null;

const CLOSED = { OPENROUTER_BASE_URL: "http://127.0.0.1:9/api/v1" };
const SEARCH = { OPENROUTER_API_KEY: "key", OPENROUTER_MODELS: "anthropic/claude-opus-5.5,mistralai/mistral-large-4-0" };

async function makeApp(env: Record<string, string> = {}, hooks?: AppHooks) {
  storage = await backend.open();
  return createApp({
    store: storage.store,
    brandingStore: storage.brandingStore,
    bus: new EventBus(),
    env: { ...CLOSED, ...env },
    mockDelayMs: 0,
    ...(hooks ? { hooks } : {}),
  });
}

afterEach(async () => {
  await storage?.close();
  storage = null;
});

const json = (body: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function create(app: Awaited<ReturnType<typeof makeApp>>, body: Record<string, unknown>) {
  const response = await app.request("/api/sessions", json({ locale: "en", idea: "A booking app", ...body }));
  return { status: response.status, session: ((await response.json()) as { session: Session }).session };
}

const option = (model: string, maker: string): ModelOption => ({ provider: "openrouter", model, label: model, maker, local: false });
const CATALOG = [option("anthropic/claude-opus-5.5", "Anthropic"), option("mistralai/mistral-large-4-0", "Mistral")];

describe("web research", () => {
  it("is off without a search engine, and ticked by default once one is configured", async () => {
    let app = await makeApp(SEARCH);
    expect(((await (await app.request("/api/config")).json()) as { research: unknown }).research).toEqual({ kind: null, default: false });
    expect((await create(app, {})).session.webResearch).toBeNull();
    await storage?.close();

    app = await makeApp({ ...SEARCH, QUORUMIND_SEARCH: "openrouter", QUORUMIND_RESEARCH_MAX_QUERIES: "3" });
    expect(((await (await app.request("/api/config")).json()) as { research: unknown }).research).toEqual({
      kind: "openrouter",
      default: true,
    });
    expect((await create(app, {})).session.webResearch).toEqual({ maxQueries: 3, budgetUsd: 0.3 });
    expect((await create(app, { webResearch: false })).session.webResearch).toBeNull();
  });

  it("is not ticked for a European-only debate; asked for anyway, it is recorded so the report can say why it did not run", async () => {
    const app = await makeApp({ ...SEARCH, QUORUMIND_SEARCH: "openrouter" });
    const european = await create(app, { europeanOnly: true });
    expect(european.session.european).not.toBeNull();
    expect(european.session.webResearch).toBeNull();
    expect((await create(app, { europeanOnly: true, webResearch: true })).session.webResearch).not.toBeNull();
  });

  it("follows the host's default for each tier, which a session can change", async () => {
    const hooks: AppHooks = {
      identify: async () => ({ userId: "ada" }),
      catalog: async () => CATALOG,
      providerEnv: () => ({ ...SEARCH, ...CLOSED, QUORUMIND_SEARCH: "openrouter" }),
      research: (settings) => ({ default: settings.mode !== "express", limits: { maxQueries: 4, budgetUsd: 0.2 } }),
    };
    const app = await makeApp({}, hooks);
    expect((await create(app, { mode: "express" })).session.webResearch).toBeNull();
    expect((await create(app, { mode: "standard" })).session.webResearch).toEqual({ maxQueries: 4, budgetUsd: 0.2 });
    expect((await create(app, { mode: "express", webResearch: true })).session.webResearch).toEqual({ maxQueries: 4, budgetUsd: 0.2 });
    const estimate = async (mode: string) =>
      (await (
        await app.request(
          "/api/estimate",
          json({
            lineup: { interviewer: CATALOG[0], arbiter: CATALOG[0], seats: { A: CATALOG[0], B: CATALOG[1] } },
            rounds: 1,
            mode,
            depth: "standard",
          }),
        )
      ).json()) as { research: { default: boolean } };
    expect((await estimate("express")).research.default).toBe(false);
    expect((await estimate("standard")).research.default).toBe(true);
  });

  it("adds what the research may cost to the estimate shown before a debate", async () => {
    setModelPrice("anthropic/claude-opus-5.5", { input: 4, output: 20 });
    setModelPrice("mistralai/mistral-large-4-0", { input: 2, output: 6 });
    const app = await makeApp({ ...SEARCH, QUORUMIND_SEARCH: "openrouter" });
    const lineup = { interviewer: CATALOG[0], arbiter: CATALOG[0], seats: { A: CATALOG[0], B: CATALOG[1] } };
    const estimate = async (webResearch: boolean) =>
      (
        (await (
          await app.request("/api/estimate", json({ lineup, rounds: 1, mode: "standard", depth: "standard", webResearch }))
        ).json()) as {
          estimateUsd: { high: number };
        }
      ).estimateUsd.high;
    const without = await estimate(false);
    const withResearch = await estimate(true);
    expect(withResearch).toBeGreaterThan(without);
    // Never more than the research's own budget.
    expect(withResearch - without).toBeLessThanOrEqual(0.3 + 1e-9);
  });

  it("costs nothing in the estimate of a European-only debate, which searches nothing", async () => {
    setModelPrice("anthropic/claude-opus-5.5", { input: 4, output: 20 });
    setModelPrice("mistralai/mistral-large-4-0", { input: 2, output: 6 });
    const app = await makeApp({ ...SEARCH, QUORUMIND_SEARCH: "openrouter" });
    const lineup = { interviewer: CATALOG[0], arbiter: CATALOG[0], seats: { A: CATALOG[0], B: CATALOG[1] } };
    const estimate = async (body: Record<string, unknown>) =>
      (await (await app.request("/api/estimate", json({ lineup, rounds: 1, mode: "standard", depth: "standard", ...body }))).json()) as {
        estimateUsd: { high: number };
        research: { default: boolean };
      };
    const plain = await estimate({ webResearch: false });
    const european = await estimate({ europeanOnly: true });
    expect(european.research.default).toBe(false);
    expect((await estimate({ europeanOnly: true, webResearch: true })).estimateUsd.high).toBe(plain.estimateUsd.high);
  });

  it("keeps its cost cap from those who must not see provider costs, and from share links", async () => {
    const hooks: AppHooks = {
      identify: async () => ({ userId: "ada" }),
      catalog: async () => CATALOG,
      providerEnv: () => ({ ...SEARCH, ...CLOSED, QUORUMIND_SEARCH: "openrouter" }),
      hideProviderCosts: true,
    };
    const app = await makeApp({}, hooks);
    const { session } = await create(app, {});
    expect(session.webResearch).toEqual({ maxQueries: 6, budgetUsd: null });
    expect((await storage?.store.find(session.id))?.session.webResearch?.budgetUsd).toBe(0.3);
  });

  it("is kept when a session is forked, and the demo has it ticked", async () => {
    const app = await makeApp({ ...SEARCH, QUORUMIND_SEARCH: "openrouter" });
    expect((await create(app, { demo: true })).session.webResearch).toEqual({ maxQueries: 6, budgetUsd: 0.3 });

    const { session } = await create(app, { webResearch: true });
    const stored = (await storage?.store.find(session.id))?.session as Session;
    await storage?.store.save({ ...stored, sheet: DEMO_SHEET, phase: "review", webResearch: { maxQueries: 2, budgetUsd: 0.1 } });
    const fork = await app.request(`/api/sessions/${session.id}/fork`, json({}));
    expect(((await fork.json()) as { session: Session }).session.webResearch).toEqual({ maxQueries: 2, budgetUsd: 0.1 });
  });
});
