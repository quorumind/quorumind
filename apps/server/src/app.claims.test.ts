import type { Session, UsageRecord } from "@quorumind/core";
import { afterEach, describe, expect, it } from "vitest";
import { type AppHooks, createApp } from "./app.ts";
import { EventBus } from "./bus.ts";
import type { Notifier } from "./notifier.ts";
import { BACKENDS, type TestStorage } from "./testing.ts";
import { as, hostedHooks, send } from "./testing-app.ts";

// Two requests that act on the same session at the same moment: one works, the other is refused (session_busy), and
// the work that runs can still be stopped. The spending check waits, as a hosted one does over the network, so both
// requests are in flight together.

let storage: TestStorage | null = null;

afterEach(async () => {
  await storage?.close();
  storage = null;
});

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.each(BACKENDS)("on $name", (backend) => {
  async function open(extra: AppHooks = {}, mockDelayMs = 0, notifier: Notifier | null = null) {
    storage = await backend.open();
    const records: UsageRecord[] = [];
    const app = createApp({
      store: storage.store,
      brandingStore: storage.brandingStore,
      bus: new EventBus(),
      env: {},
      mockDelayMs,
      notifier,
      hooks: hostedHooks({
        authorizeSpend: async () => {
          await pause(20);
          return { ok: true };
        },
        onUsage: (_user, _session, record) => {
          records.push(record);
        },
        ...extra,
      }),
    });
    const detail = async (id: string) =>
      (await (await app.request(`/api/sessions/${id}`, { headers: as("ada") })).json()) as { session: Session; busy: boolean };
    const until = async (id: string, done: (session: Session) => boolean) => {
      for (let i = 0; i < 400; i++) {
        const body = await detail(id);
        if (!body.busy && done(body.session)) return body.session;
        await pause(5);
      }
      throw new Error("Timed out");
    };
    const create = async () => {
      const created = await app.request("/api/sessions", send({ locale: "en", idea: "Online booking for 12 yoga studios" }));
      const { session } = (await created.json()) as { session: Session };
      await until(session.id, (s) => s.interview.length === 1);
      return session.id;
    };
    const ruled = async () => {
      const id = await create();
      await app.request(`/api/sessions/${id}/interview`, send({ answers: [{ question: "Budget?", answer: "€15,000" }] }));
      const review = await until(id, (s) => s.phase === "review");
      await app.request(`/api/sessions/${id}/sheet`, send({ sheet: review.sheet }, "ada", "PUT"));
      await until(id, (s) => s.phase === "awaiting_answers");
      await app.request(`/api/sessions/${id}/answers`, send({ answers: [{ question: "Hosted?", answer: "Yes" }] }));
      await until(id, (s) => s.phase === "complete");
      return id;
    };
    /** Sends both requests at once: their statuses, in order, and the refused one's error code. */
    const both = async (first: [string, RequestInit], second: [string, RequestInit] = first) => {
      const responses = await Promise.all([app.request(...first), app.request(...second)]);
      const statuses = responses.map((response) => response.status);
      const refused = responses.find((response) => response.status === 409);
      return { statuses: [...statuses].sort(), error: refused ? ((await refused.json()) as { error: string }).error : null };
    };
    const calls = (task: string) => records.filter((record) => record.task === task).length;
    return { app, records, detail, until, create, ruled, both, calls };
  }

  it("answers the interview once when two answers arrive together", async () => {
    const { both, create, until, calls } = await open();
    const id = await create();
    const asked = calls("interview");
    const answer = send({ answers: [{ question: "Budget?", answer: "€15,000" }] });
    expect(await both([`/api/sessions/${id}/interview`, answer])).toEqual({ statuses: [202, 409], error: "session_busy" });
    const session = await until(id, (s) => s.phase === "review");
    expect(calls("interview") - asked).toBeLessThanOrEqual(1);
    expect(session.interview.filter((entry) => entry.kind === "user")).toHaveLength(1);
  });

  it("resumes a stopped session once, and the running worker can still be stopped", async () => {
    const { app, both, detail } = await open({}, 5);
    const created = await app.request("/api/sessions", send({ locale: "en", idea: "A CRM" }));
    const { session } = (await created.json()) as { session: Session };
    expect((await app.request(`/api/sessions/${session.id}/stop`, send({}))).status).toBe(200);
    expect(await both([`/api/sessions/${session.id}/resume`, send({})])).toEqual({ statuses: [202, 409], error: "session_busy" });
    // The refused request does not release the claim of the worker that runs.
    expect(app.isRunning(session.id)).toBe(true);
    expect((await detail(session.id)).busy).toBe(true);
    const stopped = await app.request(`/api/sessions/${session.id}/stop`, send({}));
    expect(stopped.status).toBe(200);
    expect(app.isRunning(session.id)).toBe(false);
  });

  it("takes the answers to the debate's questions once", async () => {
    const { app, both, create, until } = await open();
    const id = await create();
    await app.request(`/api/sessions/${id}/interview`, send({ answers: [{ question: "Budget?", answer: "€15,000" }] }));
    const review = await until(id, (s) => s.phase === "review");
    await app.request(`/api/sessions/${id}/sheet`, send({ sheet: review.sheet }, "ada", "PUT"));
    await until(id, (s) => s.phase === "awaiting_answers");
    const answers = send({ answers: [{ question: "Hosted?", answer: "Yes" }] });
    expect(await both([`/api/sessions/${id}/answers`, answers])).toEqual({ statuses: [202, 409], error: "session_busy" });
    const done = await until(id, (s) => s.phase === "complete");
    expect(done.verdict).not.toBeNull();
  });

  it("makes one revision, or one scenario, when two are asked together", async () => {
    const { both, ruled, until } = await open();
    const id = await ruled();
    const revision = send({ facts: [{ question: null, answer: "The budget is €20,000", comment: null }] });
    expect(await both([`/api/sessions/${id}/revisions`, revision])).toEqual({ statuses: [202, 409], error: "session_busy" });
    let session = await until(id, (s) => s.revising === null);
    expect(session.revisions.map((made) => made.number)).toEqual([1, 2]);

    const scenario = send({ title: "Smaller team", question: null, changes: [{ kind: "team", delta: -1 }] });
    expect(await both([`/api/sessions/${id}/scenarios`, scenario], [`/api/sessions/${id}/revisions`, revision])).toEqual({
      statuses: [202, 409],
      error: "session_busy",
    });
    session = await until(id, (s) => s.revising === null);
    expect(session.revisions.map((made) => made.number)).toEqual([1, 2, 3]);
  });

  it("writes a brief once when two requests ask for it together", async () => {
    const { both, ruled, calls } = await open();
    const id = await ruled();
    const before = calls("brief");
    const ask = send({ audience: "executive" });
    expect(await both([`/api/sessions/${id}/brief`, ask])).toEqual({ statuses: [200, 409], error: "session_busy" });
    expect(calls("brief") - before).toBe(1);
  });

  it("refuses to delete a session while it works, then deletes it", async () => {
    const { app, both, create } = await open();
    const id = await create();
    const answer = send({ answers: [{ question: "Budget?", answer: "€15,000" }] });
    const removal = { method: "DELETE", headers: as("ada") };
    const result = await both([`/api/sessions/${id}/interview`, answer], [`/api/sessions/${id}`, removal]);
    expect(result.statuses).toContain(409);
    for (let i = 0; i < 400 && app.isRunning(id); i++) await pause(5);
    const deleted = await app.request(`/api/sessions/${id}`, removal);
    expect([204, 404]).toContain(deleted.status);
  });

  it("does not stay busy when the session's models cannot be set up", async () => {
    let keys = true;
    const { app, create, detail } = await open({
      providerEnv: () => {
        if (!keys) throw new Error("Missing credentials: no API key is set.");
        return {};
      },
    });
    const id = await create();
    keys = false;
    const answered = await app.request(`/api/sessions/${id}/interview`, send({ answers: [{ question: "Budget?", answer: "€15,000" }] }));
    expect(answered.status).toBe(503);
    expect(await answered.json()).toMatchObject({ error: "provider_unavailable" });
    expect((await detail(id)).busy).toBe(false);
    expect(app.isRunning(id)).toBe(false);
    // A new session is not saved at all.
    const created = await app.request("/api/sessions", send({ locale: "en", idea: "A CRM" }));
    expect(created.status).toBeGreaterThanOrEqual(500);
    expect((await (await app.request("/api/sessions", { headers: as("ada") })).json()) as { sessions: unknown[] }).toMatchObject({
      sessions: [{ id }],
    });
    keys = true;
    expect((await app.request(`/api/sessions/${id}`, { method: "DELETE", headers: as("ada") })).status).toBe(204);
  });

  it("waits at shutdown for the work that is not a worker, a brief being written", async () => {
    // The spending check waits: the brief holds the claim meanwhile.
    const { app, ruled } = await open();
    const id = await ruled();
    const brief = app.request(`/api/sessions/${id}/brief`, send({ audience: "executive" }));
    for (let i = 0; i < 400 && !app.isRunning(id); i++) await pause(1);
    expect(app.isRunning(id)).toBe(true);
    await app.interruptAll();
    expect(app.isRunning(id)).toBe(false);
    await brief;
  });

  it("stops new work once the server shuts down", async () => {
    const { app, create } = await open();
    const id = await create();
    await app.interruptAll();
    const refused = await app.request(`/api/sessions/${id}/interview`, send({ answers: [{ question: "Budget?", answer: "€15,000" }] }));
    expect(refused.status).toBe(409);
    expect(app.isRunning(id)).toBe(false);
  });

  it("writes the client brief of a client link even when the e-mail fails", async () => {
    const notifier: Notifier = {
      notify: async () => {
        throw new Error("The mail server is down.");
      },
    };
    const { app, until } = await open({}, 0, notifier);
    const created = await app.request("/api/sessions", send({ locale: "en", idea: "Online booking for 12 yoga studios", notify: true }));
    const id = ((await created.json()) as { session: Session }).session.id;
    await until(id, (s) => s.interview.length === 1);
    expect((await app.request(`/api/sessions/${id}/share`, send({}))).status).toBe(200);
    await app.request(`/api/sessions/${id}/interview`, send({ answers: [{ question: "Budget?", answer: "€15,000" }] }));
    const review = await until(id, (s) => s.phase === "review");
    await app.request(`/api/sessions/${id}/sheet`, send({ sheet: review.sheet }, "ada", "PUT"));
    await until(id, (s) => s.phase === "awaiting_answers");
    await app.request(`/api/sessions/${id}/answers`, send({ answers: [{ question: "Hosted?", answer: "Yes" }] }));
    const done = await until(id, (s) => s.phase === "complete" && Boolean(s.briefs.client));
    expect(done.briefs.client).toBeTruthy();
  });

  it("tries again to write a missing client brief once in a while only, whoever visits the link", async () => {
    let briefs = 0;
    const { app, ruled } = await open({
      authorizeSpend: async (_user, session) => {
        if (session.phase !== "complete") return { ok: true };
        briefs++;
        return { ok: false, code: "insufficient_credits", reason: "No credits left." };
      },
    });
    const id = await ruled();
    const { share } = (await (await app.request(`/api/sessions/${id}/share`, send({}))).json()) as { share: { token: string } };
    for (let i = 0; i < 400 && app.isRunning(id); i++) await pause(5);
    expect(briefs).toBe(1);
    for (let visit = 0; visit < 5; visit++) {
      expect((await app.request(`/api/shared/${share.token}`)).status).toBe(200);
      for (let i = 0; i < 400 && app.isRunning(id); i++) await pause(5);
    }
    expect(briefs).toBe(2);
  });

  it("reports each model call once, though the seats save at the same time", async () => {
    const reported: UsageRecord[] = [];
    const { ruled, detail } = await open({
      // A host that records usage over the network: the next saves happen while it waits.
      onUsage: async (_user, _session, record) => {
        await pause(10);
        reported.push(record);
      },
    });
    const id = await ruled();
    const { session } = await detail(id);
    expect(new Set(reported).size).toBe(reported.length);
    expect(reported).toHaveLength(session.usage.length);
  });
});
