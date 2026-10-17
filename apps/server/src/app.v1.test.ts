import type { Session, UsageRecord } from "@quorumind/core";
import { afterEach, describe, expect, it } from "vitest";
import { type AppHooks, createApp } from "./app.ts";
import { EventBus } from "./bus.ts";
import { SessionStore } from "./store.ts";

let store: SessionStore;

function makeApp(env: Record<string, string> = {}, hooks?: AppHooks) {
  store = new SessionStore(":memory:");
  return createApp({ store, bus: new EventBus(), env, mockDelayMs: 0, ...(hooks ? { hooks } : {}) });
}

afterEach(() => store?.close());

type App = ReturnType<typeof makeApp>;

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

describe("V1 API", () => {
  it("plays the demo with its experts and devil's advocate", async () => {
    const app = makeApp();
    const session = await completeDemo(app);
    expect(session.seats.A?.persona).toBe("cloud_architect");
    expect(session.debate.some((entry) => entry.kind === "critiques" && entry.seat === "devil")).toBe(true);
    expect(session.verdict?.topics.length).toBeGreaterThan(0);
  });

  it("shares a session read-only, without attached documents or costs, and lists public ones in the gallery", async () => {
    const app = makeApp();
    const session = await completeDemo(app, {}, { context: [{ id: "1", kind: "text", name: "brief.txt", text: "Confidential" }] });
    const shared = await app.request(`/api/sessions/${session.id}/share`, json({ public: false }));
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
    const app = makeApp();
    const session = await completeDemo(app);
    const response = await app.request(`/api/sessions/${session.id}/feedback`, json({ helpful: true, comment: "Clear." }));
    expect(response.status).toBe(201);
    await app.request(`/api/sessions/${session.id}/feedback`, json({ kind: "error", comment: "The SMS price is wrong." }));
    const { feedback } = (await (await app.request(`/api/sessions/${session.id}`)).json()) as { feedback: { kind: string }[] };
    expect(feedback.map((item) => item.kind)).toEqual(["rating", "error"]);
  });

  it("rewrites the verdict for an executive and keeps it", async () => {
    const app = makeApp();
    const session = await completeDemo(app);
    const response = await app.request(`/api/sessions/${session.id}/brief`, json({ audience: "executive" }));
    const { brief } = (await response.json()) as { brief: { headline: string } };
    expect(brief.headline).toBeTruthy();
    const { session: stored } = (await (await app.request(`/api/sessions/${session.id}`)).json()) as { session: Session };
    expect(stored.briefs.executive?.headline).toBe(brief.headline);
  });

  it("starts a new session from an earlier one, at the requirements review", async () => {
    const app = makeApp();
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
    const app = makeApp();
    const session = await completeDemo(app);
    const exported = (await (await app.request("/api/export")).json()) as { sessions: { id: string }[] };
    expect(exported.sessions.map((item) => item.id)).toEqual([session.id]);
    expect((await app.request(`/api/sessions/${session.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await app.request(`/api/sessions/${session.id}`)).status).toBe(404);
    expect(((await (await app.request("/api/sessions")).json()) as { sessions: unknown[] }).sessions).toEqual([]);
  });

  it("accepts a lineup built from the catalog and refuses unknown models", async () => {
    const app = makeApp({ ANTHROPIC_API_KEY: "key", OPENAI_API_KEY: "key", OPENAI_MODEL: "gpt-test" });
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
    const app = makeApp({ ANTHROPIC_API_KEY: "key" });
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
    const app = makeApp({}, { identify });
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
    const app = makeApp(
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
});

describe("retention", () => {
  it("purges sessions untouched for longer than the retention period", async () => {
    const app = makeApp();
    const created = await app.request("/api/sessions", json({ locale: "en", demo: true }));
    const { session } = (await created.json()) as { session: Session };
    await waitFor(app, session.id, (_s, busy) => !busy);
    expect(store.purgeOlderThan(30, Date.now() + 31 * 86_400_000)).toBe(1);
    expect(store.get(session.id)).toBeNull();
  });
});
