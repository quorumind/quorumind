import { createSession, DEMO_SHEET, type ModelOption, type Session } from "@quorumind/core";
import { afterEach, describe, expect, it } from "vitest";
import { type AppHooks, createApp } from "./app.ts";
import { EventBus } from "./bus.ts";
import { BACKENDS, type TestStorage } from "./testing.ts";

// European models only, and the compliance templates, as the API takes them. The background interview of a live
// session reaches no model here: Ollama and OpenRouter point at a closed local port.

const backend = BACKENDS[0] as (typeof BACKENDS)[number];
let storage: TestStorage | null = null;

const CLOSED = { OLLAMA_BASE_URL: "http://127.0.0.1:9", OPENROUTER_BASE_URL: "http://127.0.0.1:9/api/v1" };

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
const LOCAL = { ANTHROPIC_API_KEY: "key", OLLAMA_MODELS: "llama-x,qwen-y" };
const claude = { provider: "anthropic", model: "claude-sonnet-5-5" };
const llama = { provider: "ollama", model: "llama-x" };

async function create(app: Awaited<ReturnType<typeof makeApp>>, body: Record<string, unknown>) {
  const response = await app.request("/api/sessions", json({ locale: "en", idea: "A booking app", ...body }));
  return {
    status: response.status,
    body: (await response.json()) as { session: Session; error?: string; params?: Record<string, unknown> },
  };
}

const option = (model: string, maker: string): ModelOption => ({ provider: "openrouter", model, label: model, maker, local: false });
const HOSTED: ModelOption[] = [
  option("anthropic/claude-opus-5.5", "Anthropic"),
  option("mistralai/mistral-large-4-0", "Mistral"),
  option("mistralai/mistral-medium-3-5", "Mistral"),
];
const hosted = (policy: "default" | "required" | null): AppHooks => ({
  identify: async () => ({ userId: "ada" }),
  catalog: async () => HOSTED,
  providerEnv: () => ({ OPENROUTER_API_KEY: "key", ...CLOSED }),
  europeanPolicy: async () => policy,
});

describe("European models only", () => {
  it("describes the option in the configuration", async () => {
    const app = await makeApp(LOCAL);
    const config = (await (await app.request("/api/config")).json()) as {
      complianceTemplates: string[];
      european: { policy: string | null; lineup: { seats: Record<string, { model: string }> } | null; gateway: string | null };
    };
    expect(config.complianceTemplates).toEqual(["personal_data", "health_data", "public_sector", "finance", "consumer"]);
    expect(config.european.policy).toBeNull();
    expect(config.european.lineup?.seats.A?.model).toBe("llama-x");
    expect(config.european.lineup?.seats.B?.model).toBe("qwen-y");
    expect(config.european.gateway).toBeNull();
  });

  it("builds a European lineup when asked, and records it on the session", async () => {
    const app = await makeApp(LOCAL);
    const { status, body } = await create(app, { europeanOnly: true });
    expect(status).toBe(201);
    expect(body.session.european).toEqual({ gateway: null });
    expect(body.session.interviewer).toEqual(llama);
    expect(Object.values(body.session.seats).map((seat) => seat.provider)).toEqual(["ollama", "ollama"]);

    const plain = await create(app, {});
    expect(plain.body.session.european).toBeNull();
    expect(plain.body.session.interviewer.provider).toBe("anthropic");
  });

  it("refuses a model that is not European, with a stable code", async () => {
    const app = await makeApp(LOCAL);
    const lineup = { interviewer: llama, arbiter: llama, seats: { A: llama, B: llama }, devil: { ...claude, persona: null } };
    const { status, body } = await create(app, { europeanOnly: true, lineup });
    expect(status).toBe(400);
    expect(body).toMatchObject({ error: "non_european_model", params: { model: "anthropic:claude-sonnet-5-5" } });
    expect((await create(app, { europeanOnly: false, lineup })).status).toBe(201);
  });

  it("answers european_unavailable when the server has no European model", async () => {
    const app = await makeApp({ ANTHROPIC_API_KEY: "key" });
    const { status, body } = await create(app, { europeanOnly: true });
    expect(status).toBe(400);
    expect(body.error).toBe("european_unavailable");
  });

  it("applies the server's default, which a session can turn off", async () => {
    const app = await makeApp({ ...LOCAL, QUORUMIND_EUROPEAN_ONLY: "1" });
    expect((await create(app, {})).body.session.european).toEqual({ gateway: null });
    expect((await create(app, { europeanOnly: false })).body.session.european).toBeNull();
  });

  it("imposes a required policy, through OpenRouter's EU endpoint of Mistral", async () => {
    const app = await makeApp({}, hosted("required"));
    const { status, body } = await create(app, { europeanOnly: false });
    expect(status).toBe(201);
    expect(body.session.european).toEqual({ gateway: "global" });
    expect(body.session.arbiter).toEqual({ provider: "openrouter", model: "mistralai/mistral-large-4-0" });
    expect(body.session.seats.B?.model).toBe("mistralai/mistral-medium-3-5");

    const opus = { provider: "openrouter", model: "anthropic/claude-opus-5.5" };
    const lineup = { interviewer: opus, arbiter: opus, seats: { A: opus, B: opus } };
    expect((await create(app, { lineup })).body).toMatchObject({
      error: "non_european_model",
      params: { model: "openrouter:anthropic/claude-opus-5.5" },
    });

    const config = (await (await app.request("/api/config")).json()) as { european: { policy: string; gateway: string } };
    expect(config.european).toMatchObject({ policy: "required", gateway: "global" });
  });

  it("keeps a revisited decision European, and refuses to fork a non-European one where it is required", async () => {
    const app = await makeApp({}, hosted("required"));
    const european = createSession({
      locale: "en",
      idea: "A booking app",
      demo: false,
      interviewer: { provider: "openrouter", model: "mistralai/mistral-large-4-0" },
      arbiter: { provider: "openrouter", model: "mistralai/mistral-large-4-0" },
      seats: { A: { provider: "openrouter", model: "mistralai/mistral-large-4-0" }, B: { provider: "ollama", model: "llama-x" } },
      complianceTemplates: ["health_data"],
      european: { gateway: "global" },
    });
    european.sheet = DEMO_SHEET;
    european.phase = "complete";
    await storage?.store.save(european, "ada");
    const forked = await app.request(`/api/sessions/${european.id}/fork`, { method: "POST" });
    expect(forked.status).toBe(201);
    const { session } = (await forked.json()) as { session: Session };
    expect(session.european).toEqual({ gateway: "global" });
    expect(session.complianceTemplates).toEqual(["health_data"]);

    const opus = { provider: "openrouter" as const, model: "anthropic/claude-opus-5.5" };
    const other = createSession({
      locale: "en",
      idea: "A CRM",
      demo: false,
      interviewer: opus,
      arbiter: opus,
      seats: { A: opus, B: opus },
    });
    other.sheet = DEMO_SHEET;
    await storage?.store.save(other, "ada");
    const refused = await app.request(`/api/sessions/${other.id}/fork`, { method: "POST" });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: "non_european_model" });
  });
});

describe("compliance templates", () => {
  it("stores the chosen templates, and refuses unknown ones", async () => {
    const app = await makeApp(LOCAL);
    const { status, body } = await create(app, { template: "saas", complianceTemplates: ["health_data", "personal_data"] });
    expect(status).toBe(201);
    expect(body.session.template).toBe("saas");
    expect(body.session.complianceTemplates).toEqual(["health_data", "personal_data"]);
    const refused = await create(app, { complianceTemplates: ["tax_law"] });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ error: "invalid_request", params: { field: "complianceTemplates.0" } });
    // The demo follows its own script.
    expect((await create(app, { demo: true, complianceTemplates: ["finance"] })).body.session.complianceTemplates).toEqual([]);
  });
});
