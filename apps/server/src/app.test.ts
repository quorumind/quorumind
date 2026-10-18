import type { Session } from "@quorumind/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { EventBus } from "./bus.ts";
import { BACKENDS, type Backend, type TestStorage } from "./testing.ts";

let backend: Backend;
let storage: TestStorage | null = null;

async function makeApp(env: Record<string, string> = {}) {
  storage = await backend.open();
  return createApp({ store: storage.store, brandingStore: storage.brandingStore, bus: new EventBus(), env, mockDelayMs: 0 });
}

afterEach(async () => {
  await storage?.close();
  storage = null;
});

type App = Awaited<ReturnType<typeof makeApp>>;

const json = (body: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function waitFor(app: App, id: string, done: (session: Session, busy: boolean) => boolean) {
  for (let i = 0; i < 200; i++) {
    const response = await app.request(`/api/sessions/${id}`);
    const { session, busy } = (await response.json()) as { session: Session; busy: boolean };
    if (done(session, busy)) return session;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out");
}

describe.each(BACKENDS)("on $name", (each) => {
  beforeEach(() => {
    backend = each;
  });

  describe("API", () => {
    it("runs the demo from the interview to the report", async () => {
      const app = await makeApp();
      const created = await app.request("/api/sessions", json({ locale: "fr", demo: true }));
      expect(created.status).toBe(201);
      const { session } = (await created.json()) as { session: Session };

      await waitFor(app, session.id, (s, busy) => s.interview.length === 1 && !busy);
      const answered = await app.request(
        `/api/sessions/${session.id}/interview`,
        json({ answers: [{ question: "Budget?", answer: "15 000 €" }] }),
      );
      expect(answered.status).toBe(202);

      const review = await waitFor(app, session.id, (s, busy) => s.phase === "review" && !busy);
      const confirmed = await app.request(`/api/sessions/${session.id}/sheet`, { ...json({ sheet: review.sheet }), method: "PUT" });
      expect(confirmed.status).toBe(202);

      await waitFor(app, session.id, (s, busy) => s.phase === "awaiting_answers" && !busy);
      const replied = await app.request(`/api/sessions/${session.id}/answers`, json({ answers: [{ question: "Hosted?", answer: "Oui" }] }));
      expect(replied.status).toBe(202);

      const done = await waitFor(app, session.id, (s, busy) => s.phase === "complete" && !busy);
      expect(done.verdict?.recommendation.seat).toBe("A");

      const report = await app.request(`/api/sessions/${session.id}/report.md`);
      expect(report.headers.get("content-type")).toContain("text/markdown");
      expect(await report.text()).toContain("_Rapport de décision");
    });

    it("refuses a live session when no API key is configured", async () => {
      const app = await makeApp();
      const response = await app.request("/api/sessions", json({ locale: "en", demo: false, idea: "A CRM" }));
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toBe("live_unavailable");
    });

    it("validates the language", async () => {
      const app = await makeApp();
      const response = await app.request("/api/sessions", json({ locale: "xx", demo: true }));
      expect(response.status).toBe(400);
    });

    it("returns 404 for an unknown session", async () => {
      const app = await makeApp();
      expect((await app.request("/api/sessions/nope")).status).toBe(404);
    });

    it("rejects an action that does not match the phase", async () => {
      const app = await makeApp();
      const created = await app.request("/api/sessions", json({ locale: "en", demo: true }));
      const { session } = (await created.json()) as { session: Session };
      await waitFor(app, session.id, (s, busy) => s.interview.length === 1 && !busy);
      const response = await app.request(`/api/sessions/${session.id}/answers`, json({ answers: [] }));
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: "wrong_phase", message: "No question is waiting for an answer." });
    });

    it("answers a stable code, with its parameters, for every refused request", async () => {
      const app = await makeApp({ ANTHROPIC_API_KEY: "key" });
      const refusal = async (body: unknown) => {
        const response = await app.request("/api/sessions", json(body));
        expect(response.status).toBe(400);
        return (await response.json()) as { error: string; message: string; params?: Record<string, unknown> };
      };
      expect(await refusal({ locale: "en", idea: "" })).toMatchObject({ error: "idea_missing" });
      expect(await refusal({ locale: "en", idea: "A CRM", mode: "challenge" })).toMatchObject({ error: "challenge_missing" });
      expect(await refusal({ locale: "en", idea: "A CRM", rounds: 9 })).toMatchObject({
        error: "invalid_request",
        params: { field: "rounds" },
      });
      const claude = { provider: "anthropic", model: "claude-sonnet-5-5" };
      const lineup = { interviewer: claude, arbiter: { provider: "anthropic", model: "unknown" }, seats: { A: claude, B: claude } };
      expect(await refusal({ locale: "en", idea: "A CRM", lineup })).toMatchObject({
        error: "invalid_lineup",
        params: { model: "anthropic:unknown" },
      });
      const notJson = await app.request("/api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
      expect(await notJson.json()).toMatchObject({ error: "invalid_request" });
    });

    it("describes the configuration without exposing keys", async () => {
      const app = await makeApp({ ANTHROPIC_API_KEY: "secret-key" });
      const body = await (await app.request("/api/config")).text();
      expect(body).not.toContain("secret-key");
      const config = JSON.parse(body) as { live: { estimateUsd: { low: number } } | null; locales: unknown[] };
      expect(config.live?.estimateUsd.low).toBeGreaterThan(0);
      expect(config.locales).toHaveLength(10);
    });

    it("streams the session snapshot first on the event stream", async () => {
      const app = await makeApp();
      const created = await app.request("/api/sessions", json({ locale: "en", demo: true }));
      const { session } = (await created.json()) as { session: Session };
      const controller = new AbortController();
      const response = await app.request(`/api/sessions/${session.id}/events`, { signal: controller.signal });
      const reader = response.body!.getReader();
      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);
      expect(text).toContain('"type":"session"');
      controller.abort();
      await reader.cancel();
    });
  });
});
