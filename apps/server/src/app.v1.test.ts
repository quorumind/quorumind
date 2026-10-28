import { createSession, DEMO_IDEA, DEMO_LINEUP, DEMO_SHEET, type Session, setModelPrice, type UsageRecord } from "@quorumind/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AppHooks, createApp } from "./app.ts";
import { EventBus } from "./bus.ts";
import type { SessionStore } from "./store.ts";
import { BACKENDS, type Backend, type TestStorage } from "./testing.ts";

let backend: Backend;
let storage: TestStorage | null = null;
let store: SessionStore;

async function makeApp(env: Record<string, string> = {}, hooks?: AppHooks) {
  storage = await backend.open();
  store = storage.store;
  return createApp({ store, brandingStore: storage.brandingStore, bus: new EventBus(), env, mockDelayMs: 0, ...(hooks ? { hooks } : {}) });
}

afterEach(async () => {
  await storage?.close();
  storage = null;
});

type App = Awaited<ReturnType<typeof makeApp>>;

const json = (body: unknown, method = "POST", headers: Record<string, string> = {}) => ({
  method,
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});

async function waitFor(app: App, id: string, done: (session: Session, busy: boolean) => boolean, headers: Record<string, string> = {}) {
  for (let i = 0; i < 300; i++) {
    const response = await app.request(`/api/sessions/${id}`, { headers });
    const { session, busy } = (await response.json()) as { session: Session; busy: boolean };
    if (done(session, busy)) return session;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out");
}

/** Plays the demo through the API to the verdict. */
async function completeDemo(app: App, headers: Record<string, string> = {}, body: Record<string, unknown> = {}) {
  const created = await app.request("/api/sessions", json({ locale: "en", demo: true, ...body }, "POST", headers));
  expect(created.status).toBe(201);
  const { session } = (await created.json()) as { session: Session };
  await waitFor(app, session.id, (s, busy) => s.interview.length === 1 && !busy, headers);
  await app.request(`/api/sessions/${session.id}/interview`, json({ answers: [{ question: "Budget?", answer: "15k" }] }, "POST", headers));
  const review = await waitFor(app, session.id, (s, busy) => s.phase === "review" && !busy, headers);
  await app.request(`/api/sessions/${session.id}/sheet`, json({ sheet: review.sheet }, "PUT", headers));
  await waitFor(app, session.id, (s, busy) => s.phase === "awaiting_answers" && !busy, headers);
  await app.request(`/api/sessions/${session.id}/answers`, json({ answers: [{ question: "Hosted?", answer: "Yes" }] }, "POST", headers));
  return waitFor(app, session.id, (s, busy) => s.phase === "complete" && !busy, headers);
}

describe.each(BACKENDS)("on $name", (each) => {
  beforeEach(() => {
    backend = each;
  });

  describe("V1 API", () => {
    it("plays the demo with its experts and devil's advocate", async () => {
      const app = await makeApp();
      const session = await completeDemo(app);
      expect(session.seats.A?.persona).toBe("cloud_architect");
      expect(session.debate.some((entry) => entry.kind === "critiques" && entry.seat === "devil")).toBe(true);
      expect(session.verdict?.topics.length).toBeGreaterThan(0);
    });

    it("shares a whole session read-only, without attached documents or costs, and lists public ones in the gallery", async () => {
      const app = await makeApp();
      const session = await completeDemo(app, {}, { context: [{ id: "1", kind: "text", name: "brief.txt", text: "Confidential" }] });
      const shared = await app.request(`/api/sessions/${session.id}/share`, json({ public: false, mode: "full" }));
      const { share } = (await shared.json()) as { share: { token: string; public: boolean } };
      const view = (await (await app.request(`/api/shared/${share.token}`)).json()) as { session: Session };
      expect(view.session.verdict).toBeTruthy();
      expect(JSON.stringify(view.session)).not.toContain("Confidential");
      expect(view.session.usage).toEqual([]);
      expect(((await (await app.request("/api/gallery")).json()) as { sessions: unknown[] }).sessions).toHaveLength(0);

      await app.request(`/api/sessions/${session.id}/share`, json({ public: true }));
      const gallery = (await (await app.request("/api/gallery")).json()) as { sessions: { token: string }[] };
      expect(gallery.sessions.map((item) => item.token)).toEqual([share.token]);

      expect((await app.request(`/api/sessions/${session.id}/share`, { method: "DELETE" })).status).toBe(204);
      expect((await app.request(`/api/shared/${share.token}`)).status).toBe(404);
    });

    it("records feedback on the report", async () => {
      const app = await makeApp();
      const session = await completeDemo(app);
      const response = await app.request(`/api/sessions/${session.id}/feedback`, json({ helpful: true, comment: "Clear." }));
      expect(response.status).toBe(201);
      await app.request(`/api/sessions/${session.id}/feedback`, json({ kind: "error", comment: "The SMS price is wrong." }));
      const { feedback } = (await (await app.request(`/api/sessions/${session.id}`)).json()) as { feedback: { kind: string }[] };
      expect(feedback.map((item) => item.kind)).toEqual(["rating", "error"]);
    });

    it("rewrites the verdict for an executive and keeps it", async () => {
      const app = await makeApp();
      const session = await completeDemo(app);
      const response = await app.request(`/api/sessions/${session.id}/brief`, json({ audience: "executive" }));
      const { brief } = (await response.json()) as { brief: { headline: string } };
      expect(brief.headline).toBeTruthy();
      const { session: stored } = (await (await app.request(`/api/sessions/${session.id}`)).json()) as { session: Session };
      expect(stored.briefs.executive?.headline).toBe(brief.headline);
    });

    it("starts a new session from an earlier one, at the requirements review", async () => {
      const app = await makeApp();
      const source = await completeDemo(app);
      const response = await app.request(`/api/sessions/${source.id}/fork`, json({}));
      expect(response.status).toBe(201);
      const { session } = (await response.json()) as { session: Session };
      expect(session.phase).toBe("review");
      expect(session.parentId).toBe(source.id);
      expect(session.sheet).toEqual(source.sheet);
      expect(session.debate).toEqual([]);
    });

    it("exports every session, then deletes one for good", async () => {
      const app = await makeApp();
      const session = await completeDemo(app);
      const exported = (await (await app.request("/api/export")).json()) as { sessions: { id: string }[] };
      expect(exported.sessions.map((item) => item.id)).toEqual([session.id]);
      expect((await app.request(`/api/sessions/${session.id}`, { method: "DELETE" })).status).toBe(204);
      expect((await app.request(`/api/sessions/${session.id}`)).status).toBe(404);
      expect(((await (await app.request("/api/sessions")).json()) as { sessions: unknown[] }).sessions).toEqual([]);
    });

    it("accepts a lineup built from the catalog and refuses unknown models", async () => {
      const app = await makeApp({ ANTHROPIC_API_KEY: "key", OPENAI_API_KEY: "key", OPENAI_MODEL: "gpt-test" });
      const config = (await (await app.request("/api/config")).json()) as { catalog: { provider: string; model: string }[] };
      expect(config.catalog.map((option) => option.provider)).toContain("openai");
      const claude = { provider: "anthropic", model: "claude-sonnet-5-5" };
      const lineup = {
        interviewer: claude,
        arbiter: claude,
        seats: { A: { ...claude, persona: "security" }, B: { provider: "openai", model: "gpt-test", persona: null }, C: claude },
        devil: { ...claude, persona: null },
      };
      const estimate = await app.request("/api/estimate", json({ lineup, rounds: 2, mode: "standard" }));
      expect(((await estimate.json()) as { estimateUsd: unknown }).estimateUsd).toBeNull(); // gpt-test has no price

      const bad = await app.request(
        "/api/sessions",
        json({ locale: "en", idea: "A CRM", lineup: { ...lineup, arbiter: { provider: "anthropic", model: "unknown" } } }),
      );
      expect(bad.status).toBe(400);
      expect(((await bad.json()) as { error: string }).error).toBe("invalid_lineup");

      const gap = await app.request(
        "/api/sessions",
        json({ locale: "en", idea: "A CRM", lineup: { ...lineup, seats: { A: claude, C: claude } } }),
      );
      expect(gap.status).toBe(400);
    });

    it("requires the solution to challenge", async () => {
      const app = await makeApp({ ANTHROPIC_API_KEY: "key" });
      const response = await app.request("/api/sessions", json({ locale: "en", idea: "A CRM", mode: "challenge" }));
      expect(response.status).toBe(400);
    });
  });

  describe("hosted hooks", () => {
    const as = (user: string) => ({ "x-user": user });
    const identify: AppHooks["identify"] = async (request) => {
      const user = request.headers.get("x-user");
      return user ? { userId: user } : null;
    };

    it("scopes sessions to their owner and requires a user", async () => {
      const app = await makeApp({}, { identify });
      expect((await app.request("/api/sessions")).status).toBe(401);
      expect((await app.request("/api/config")).status).toBe(200);
      const created = await app.request("/api/sessions", json({ locale: "en", demo: true }, "POST", as("ada")));
      const { session } = (await created.json()) as { session: Session };
      expect((await app.request(`/api/sessions/${session.id}`, { headers: as("ada") })).status).toBe(200);
      expect((await app.request(`/api/sessions/${session.id}`, { headers: as("bob") })).status).toBe(404);
      const list = (await (await app.request("/api/sessions", { headers: as("bob") })).json()) as { sessions: unknown[] };
      expect(list.sessions).toEqual([]);
    });

    it("asks before spending, reports every call and caps the budget", async () => {
      const records: UsageRecord[] = [];
      let allow = true;
      const app = await makeApp(
        { ANTHROPIC_API_KEY: "key" },
        {
          identify,
          maxBudgetUsd: 5,
          authorizeSpend: async () => (allow ? { ok: true } : { ok: false, code: "insufficient_credits", reason: "Buy credits." }),
          onUsage: (_user, _session, record) => {
            records.push(record);
          },
          // The hosted catalog offers the demo model so this test spends nothing.
          catalog: async () => [{ provider: "mock", model: "mock", label: "Demo", local: false }],
        },
      );
      const created = await app.request("/api/sessions", json({ locale: "en", idea: "A CRM", budgetUsd: 50 }, "POST", as("ada")));
      expect(created.status).toBe(201);
      const { session } = (await created.json()) as { session: Session };
      expect(session.budgetUsd).toBe(5);
      await waitFor(app, session.id, (s, busy) => s.interview.length === 1 && !busy, as("ada"));
      expect(records.map((record) => record.task)).toEqual(["interview"]);

      allow = false;
      const refused = await app.request(`/api/sessions/${session.id}/interview`, json({ answers: [] }, "POST", as("ada")));
      expect(refused.status).toBe(402);
      expect(((await refused.json()) as { error: string }).error).toBe("insufficient_credits");
    });

    it("caps each session by its settings, quotes a price and hides the provider costs", async () => {
      const quoted: { settings: unknown; sessionId: string | null }[] = [];
      const app = await makeApp(
        {},
        {
          identify,
          maxBudgetUsd: 5,
          sessionBudgetUsd: ({ mode, depth }) => (mode === "express" ? 1 : depth === "deep" ? 5 : 2.5),
          quote: async (_user, settings, sessionId) => {
            quoted.push({ settings, sessionId });
            return { amount: settings.depth === "deep" ? 15 : 7, currency: "EUR", label: `Debate (${settings.locale})` };
          },
          hideProviderCosts: true,
          catalog: async () => [{ provider: "mock", model: "mock", label: "Demo", local: false }],
        },
      );
      const config = (await (await app.request("/api/config", { headers: as("ada") })).json()) as {
        providerCosts: boolean;
        maxBudgetUsd: number | null;
        live: { lineup: unknown; estimateUsd: unknown };
      };
      expect(config).toMatchObject({ providerCosts: false, maxBudgetUsd: null, live: { estimateUsd: null } });

      const estimate = await app.request(
        "/api/estimate",
        json({ lineup: config.live.lineup, rounds: 1, mode: "standard", depth: "deep", locale: "fr" }, "POST", as("ada")),
      );
      expect(await estimate.json()).toEqual({
        estimateUsd: null,
        price: { amount: 15, currency: "EUR", label: "Debate (fr)" },
        overCap: false,
        research: { kind: null, default: false },
      });
      // The lineup is priced with the settings: a host may sell dearer models at a higher price.
      expect(quoted[0]).toEqual({
        settings: { mode: "standard", depth: "deep", locale: "fr", ...(config.live.lineup as object) },
        sessionId: null,
      });

      const express = await app.request("/api/sessions", json({ locale: "en", idea: "A CRM", mode: "express" }, "POST", as("ada")));
      const created = (await express.json()) as { session: Session };
      // The cap is kept on the server, never sent.
      expect(created.session.budgetUsd).toBeNull();
      expect((await store.get(created.session.id, "ada"))?.budgetUsd).toBe(1);
      const own = await app.request("/api/sessions", json({ locale: "en", idea: "A CRM", budgetUsd: 0.5 }, "POST", as("ada")));
      expect((await store.get(((await own.json()) as { session: Session }).session.id, "ada"))?.budgetUsd).toBe(0.5);

      await waitFor(app, created.session.id, (s, busy) => s.interview.length === 1 && !busy, as("ada"));
      const detail = (await (await app.request(`/api/sessions/${created.session.id}`, { headers: as("ada") })).json()) as {
        session: Session;
        price: unknown;
        providerCosts: boolean;
      };
      expect(detail.providerCosts).toBe(false);
      expect(detail.price).toEqual({ amount: 7, currency: "EUR", label: "Debate (en)" });
      expect(quoted.at(-1)?.sessionId).toBe(created.session.id);
      expect(detail.session.usage.length).toBeGreaterThan(0);
      expect(detail.session.usage.every((record) => record.costUsd === null)).toBe(true);
    });

    it("refuses, at a fixed price, a lineup whose usual cost is over the debate's cap, and says so before", async () => {
      setModelPrice("dear-model", { input: 100, output: 500 });
      const capped: unknown[] = [];
      const app = await makeApp(
        {},
        {
          identify,
          sessionBudgetUsd: (settings) => {
            capped.push(settings);
            return 1;
          },
          hideProviderCosts: true,
          catalog: async () => [
            { provider: "mock", model: "mock", label: "Demo", local: false },
            { provider: "anthropic", model: "dear-model", label: "Dear", local: false, premium: true },
          ],
        },
      );
      const dear = { provider: "anthropic", model: "dear-model" };
      const lineup = { interviewer: dear, arbiter: dear, seats: { A: dear, B: dear }, devil: null };
      const estimate = await app.request(
        "/api/estimate",
        json({ lineup, rounds: 1, mode: "standard", depth: "standard", locale: "en" }, "POST", as("ada")),
      );
      expect(await estimate.json()).toMatchObject({ estimateUsd: null, overCap: true });
      // The cap is asked with the lineup's models.
      expect(capped[0]).toMatchObject({ mode: "standard", depth: "standard", arbiter: dear });

      const refused = await app.request("/api/sessions", json({ locale: "en", idea: "A CRM", lineup }, "POST", as("ada")));
      expect(refused.status).toBe(402);
      expect(((await refused.json()) as { error: string }).error).toBe("lineup_cost");
      expect(await store.list(10, "ada")).toHaveLength(0);
    });

    it("weighs against the cap a model of unknown price, and the interviewer that states the option alone", async () => {
      setModelPrice("dear-model", { input: 100, output: 500 });
      const app = await makeApp(
        {},
        {
          identify,
          sessionBudgetUsd: () => 1,
          hideProviderCosts: true,
          catalog: async () => [
            { provider: "mock", model: "mock", label: "Demo", local: false },
            { provider: "anthropic", model: "dear-model", label: "Dear", local: false },
            { provider: "anthropic", model: "unpriced-model", label: "Unpriced", local: false },
          ],
        },
      );
      const mock = { provider: "mock", model: "mock" };
      const overCap = async (lineup: object, mode: string) => {
        const body = { lineup, rounds: 1, mode, depth: "standard", locale: "en" };
        return ((await (await app.request("/api/estimate", json(body, "POST", as("ada")))).json()) as { overCap: boolean }).overCap;
      };
      // Unpriced models count at the cap's fallback price ($1.47 here), rather than making the estimate unknown and passing.
      const unpriced = { provider: "anthropic", model: "unpriced-model" };
      expect(await overCap({ interviewer: mock, arbiter: unpriced, seats: { A: unpriced, B: unpriced }, devil: null }, "standard")).toBe(
        true,
      );
      // In challenge mode the interviewer restates the solution: a dear interviewer alone is over the cap.
      const dear = { provider: "anthropic", model: "dear-model" };
      const dearInterviewer = { interviewer: dear, arbiter: mock, seats: { A: mock, B: mock }, devil: null };
      expect(await overCap(dearInterviewer, "challenge")).toBe(true);
      expect(await overCap({ ...dearInterviewer, interviewer: mock }, "challenge")).toBe(false);
    });

    it("weighs the debate against what the interview has left of the cap when the requirements are confirmed", async () => {
      // A lineup whose debate usually costs $0.64: under the $1 cap at first, over it once the interview has spent $0.50.
      setModelPrice("mock", { input: 5, output: 20 });
      try {
        const app = await makeApp(
          {},
          {
            identify,
            sessionBudgetUsd: () => 1,
            hideProviderCosts: true,
            catalog: async () => [{ provider: "mock", model: "mock", label: "Demo", local: false }],
          },
        );
        const created = await app.request("/api/sessions", json({ locale: "en", idea: "A CRM" }, "POST", as("ada")));
        expect(created.status).toBe(201);
        const { session } = (await created.json()) as { session: Session };
        await waitFor(app, session.id, (s, busy) => s.interview.length === 1 && !busy, as("ada"));

        const stored = (await store.get(session.id, "ada")) as Session;
        const [first] = stored.usage;
        if (!first) throw new Error("The interview recorded no call.");
        await store.save({ ...stored, sheet: DEMO_SHEET, phase: "review", usage: [...stored.usage, { ...first, costUsd: 0.5 }] }, "ada");
        const refused = await app.request(`/api/sessions/${session.id}/sheet`, json({ sheet: DEMO_SHEET }, "PUT", as("ada")));
        expect(refused.status).toBe(402);
        expect(((await refused.json()) as { error: string }).error).toBe("lineup_cost");
      } finally {
        setModelPrice("mock", { input: 0, output: 0 });
      }
    });

    it("keeps the provider costs and the user's cap without the pricing hooks", async () => {
      const app = await makeApp({}, { identify, catalog: async () => [{ provider: "mock", model: "mock", label: "Demo", local: false }] });
      const created = await app.request("/api/sessions", json({ locale: "en", idea: "A CRM", budgetUsd: 3 }, "POST", as("ada")));
      const { session } = (await created.json()) as { session: Session };
      expect(session.budgetUsd).toBe(3);
      await waitFor(app, session.id, (s, busy) => s.interview.length === 1 && !busy, as("ada"));
      const detail = (await (await app.request(`/api/sessions/${session.id}`, { headers: as("ada") })).json()) as {
        session: Session;
        price: unknown;
        providerCosts: boolean;
      };
      expect(detail).toMatchObject({ price: null, providerCosts: true });
      expect(detail.session.usage[0]?.costUsd).toBe(0);
    });
  });

  describe("stopping", () => {
    it("stops a running session at once, reports no further call, and resumes it", async () => {
      const records: UsageRecord[] = [];
      storage = await backend.open();
      store = storage.store;
      const app = createApp({
        store,
        brandingStore: storage.brandingStore,
        bus: new EventBus(),
        env: {},
        // Slow enough to be caught in the middle of a call.
        mockDelayMs: 5,
        hooks: {
          identify: async () => ({ userId: "ada" }),
          onUsage: (_user, _session, record) => {
            records.push(record);
          },
          catalog: async () => [{ provider: "mock", model: "mock", label: "Demo", local: false }],
        },
      });
      const created = await app.request("/api/sessions", json({ locale: "en", idea: "A CRM" }));
      const { session } = (await created.json()) as { session: Session };
      expect((await (await app.request(`/api/sessions/${session.id}`)).json()) as { busy: boolean }).toMatchObject({ busy: true });

      const stopped = await app.request(`/api/sessions/${session.id}/stop`, json({}));
      expect(stopped.status).toBe(200);
      const body = (await stopped.json()) as { session: Session };
      expect(body.session).toMatchObject({ phase: "failed", error: { code: "stopped" }, interview: [] });
      // A call cut short is reported as failed, with an estimate of what the provider may bill for it.
      expect(records.every((record) => record.failed)).toBe(true);
      expect((await (await app.request(`/api/sessions/${session.id}`)).json()) as { busy: boolean }).toMatchObject({ busy: false });
      expect((await store.get(session.id, "ada"))?.error?.code).toBe("stopped");

      const again = await app.request(`/api/sessions/${session.id}/stop`, json({}));
      expect(again.status).toBe(409);
      expect(await again.json()).toMatchObject({ error: "not_running" });

      expect((await app.request(`/api/sessions/${session.id}/resume`, json({}))).status).toBe(202);
      const resumed = await waitFor(app, session.id, (s, busy) => s.interview.length === 1 && !busy);
      expect(resumed.phase).toBe("interview");
      expect(records.filter((record) => !record.failed).map((record) => record.task)).toEqual(["interview"]);
    });

    it("interrupts the sessions working here when the server shuts down, without spending more", async () => {
      storage = await backend.open();
      store = storage.store;
      const records: UsageRecord[] = [];
      const app = createApp({
        store,
        brandingStore: storage.brandingStore,
        bus: new EventBus(),
        env: {},
        mockDelayMs: 5,
        hooks: {
          identify: async () => ({ userId: "ada" }),
          onUsage: (_user, _session, record) => {
            records.push(record);
          },
          catalog: async () => [{ provider: "mock", model: "mock", label: "Demo", local: false }],
        },
      });
      const created = await app.request("/api/sessions", json({ locale: "en", idea: "A CRM" }));
      const { session } = (await created.json()) as { session: Session };
      expect(app.isRunning(session.id)).toBe(true);

      expect(await app.interruptAll()).toBe(1);
      expect(app.isRunning(session.id)).toBe(false);
      expect(records.every((record) => record.failed)).toBe(true);
      expect(await store.get(session.id, "ada")).toMatchObject({ phase: "failed", error: { code: "interrupted" } });
    });

    it("lets the person resume a session a restarted server left working", async () => {
      storage = await backend.open();
      // The server stopped in the middle of the first interview turn, and starts again.
      const session = createSession({ locale: "en", idea: DEMO_IDEA, demo: true, ...DEMO_LINEUP });
      await storage.store.save(session);
      const restarted = storage.reopen();
      expect(await restarted.markInterrupted()).toBe(1);
      store = restarted;
      const app = createApp({ store: restarted, brandingStore: storage.brandingStore, bus: new EventBus(), env: {}, mockDelayMs: 0 });
      const detail = (await (await app.request(`/api/sessions/${session.id}`)).json()) as { session: Session; busy: boolean };
      expect(detail).toMatchObject({ busy: false, session: { phase: "failed", error: { code: "interrupted" } } });

      expect((await app.request(`/api/sessions/${session.id}/resume`, json({}))).status).toBe(202);
      const resumed = await waitFor(app, session.id, (s, busy) => s.interview.length === 1 && !busy);
      expect(resumed).toMatchObject({ phase: "interview", error: null });
    });

    it("refuses to delete or act on a session while it works", async () => {
      storage = await backend.open();
      store = storage.store;
      const app = createApp({ store, brandingStore: storage.brandingStore, bus: new EventBus(), env: {}, mockDelayMs: 5 });
      const created = await app.request("/api/sessions", json({ locale: "en", demo: true }));
      const { session } = (await created.json()) as { session: Session };
      const refused = await app.request(`/api/sessions/${session.id}`, { method: "DELETE" });
      expect(refused.status).toBe(409);
      expect(await refused.json()).toMatchObject({ error: "session_busy" });
      await app.request(`/api/sessions/${session.id}/stop`, json({}));
    });
  });

  describe("cost cap", () => {
    afterEach(() => setModelPrice("mock", { input: 0, output: 0 }));

    it("raises the cap when resuming, within the host's cap", async () => {
      // The demo model costs something here, so its cap is reached after the first interview turn.
      setModelPrice("mock", { input: 1_000, output: 1_000 });
      const app = await makeApp({}, { maxBudgetUsd: 5 });
      const created = await app.request("/api/sessions", json({ locale: "en", demo: true, budgetUsd: 0.01 }));
      const { session } = (await created.json()) as { session: Session };
      await waitFor(app, session.id, (s, busy) => s.interview.length === 1 && !busy);
      await app.request(`/api/sessions/${session.id}/interview`, json({ answers: [{ question: "Budget?", answer: "15k" }] }));
      const failed = await waitFor(app, session.id, (s, busy) => s.phase === "failed" && !busy);
      expect(failed.error?.code).toBe("budget_exceeded");

      const invalid = await app.request(`/api/sessions/${session.id}/resume`, json({ budgetUsd: -1 }));
      expect(await invalid.json()).toMatchObject({ error: "invalid_request", params: { field: "budgetUsd" } });
      const resumed = await app.request(`/api/sessions/${session.id}/resume`, json({ budgetUsd: 50 }));
      expect(resumed.status).toBe(202);
      expect(await resumed.json()).toEqual({ accepted: true, budgetUsd: 5 });
      const review = await waitFor(app, session.id, (s, busy) => s.phase === "review" && !busy);
      expect(review.budgetUsd).toBe(5);
      expect((await store.get(session.id))?.budgetUsd).toBe(5);
    });

    it("keeps each debate's cap fixed on a host that sells debates at a price", async () => {
      const identify: AppHooks["identify"] = async () => ({ userId: "ada" });
      const app = await makeApp({}, { identify, hideProviderCosts: true });
      const session = createSession({ locale: "en", idea: DEMO_IDEA, demo: true, ...DEMO_LINEUP });
      session.phase = "failed";
      session.error = { code: "budget_exceeded", message: "" };
      await store.save(session, "ada");
      const refused = await app.request(`/api/sessions/${session.id}/resume`, json({ budgetUsd: 50 }));
      expect(refused.status).toBe(409);
      expect(await refused.json()).toMatchObject({ error: "budget_fixed" });
      expect((await app.request(`/api/sessions/${session.id}/resume`, json({}))).status).toBe(202);
    });
  });

  describe("retention", () => {
    it("purges sessions untouched for longer than the retention period", async () => {
      const app = await makeApp();
      const created = await app.request("/api/sessions", json({ locale: "en", demo: true }));
      const { session } = (await created.json()) as { session: Session };
      await waitFor(app, session.id, (_s, busy) => !busy);
      expect(await store.purgeOlderThan(30, Date.now() + 31 * 86_400_000)).toBe(1);
      expect(await store.get(session.id)).toBeNull();
    });
  });
});
