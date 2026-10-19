import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { createSession, DEMO_SCRIPT, type Session } from "@quorumind/core";
import { afterEach, describe, expect, it } from "vitest";
import type { Purchase, RevisionEvent } from "./app.ts";
import { loadMigrations, migrate } from "./postgres/migrate.ts";
import { pgliteDatabase } from "./postgres/pglite.ts";
import { migrateSessions, PostgresSessionStore } from "./postgres/store.ts";
import { SqliteSessionStore } from "./store.ts";
import { BACKENDS, type TestStorage } from "./testing.ts";
import { as, detail, hostedHooks, openApp, ruled, send, waitFor } from "./testing-app.ts";

let storage: TestStorage | null = null;

afterEach(async () => {
  await storage?.close();
  storage = null;
});

const facts = {
  facts: [{ question: "Which SMS provider meets the cost assumption?", answer: "Brevo at €0.04", comment: null }],
  note: null,
};

describe.each(BACKENDS)("verdict revisions on $name", (backend) => {
  it("rule again on new facts, keep the earlier verdict readable, and tell the host how each one went", async () => {
    const purchases: Purchase[] = [];
    const events: RevisionEvent[] = [];
    const caps: number[] = [];
    const opened = await openApp(
      backend,
      hostedHooks({
        authorizeSpend: async (_user, _session, estimateUsd, purchase) => {
          purchases.push(purchase ?? { kind: "debate" });
          if (purchase?.kind === "revision") caps.push(estimateUsd);
          return { ok: true };
        },
        onRevision: (_user, _session, event) => {
          events.push(event);
        },
        revisionBudgetUsd: () => 0.3,
        quote: async (_user, settings, _id, item) => ({
          amount: item === "revision" ? 1 : 7,
          currency: "EUR",
          label: item === "revision" ? `Verdict update (${settings.locale})` : "Standard debate",
        }),
      }),
    );
    storage = opened.storage;
    const { app } = opened;
    const session = await ruled(app);
    expect(session.revisions.map((revision) => revision.number)).toEqual([1]);
    expect((await detail(app, session.id)).revisionPrice).toEqual({ amount: 1, currency: "EUR", label: "Verdict update (en)" });
    // Someone else does not even see the session, let alone its price.
    expect((await detail(app, session.id, "bob")) as unknown).toMatchObject({ error: "not_found" });

    const accepted = await app.request(`/api/sessions/${session.id}/revisions`, send(facts));
    expect(accepted.status).toBe(202);
    expect(await accepted.json()).toEqual({ accepted: true, revision: 2 });
    const revised = await waitFor(app, session.id, (s) => s.revisions.length === 2 && !s.revising);
    expect(revised.revisions[1]).toMatchObject({ number: 2, reason: "edit", basedOn: 1, by: "ada" });
    expect(revised.verdict?.openQuestions).toEqual([]);
    expect(purchases.at(-1)).toEqual({ kind: "revision", number: 2 });
    expect(caps[0]).toBeGreaterThanOrEqual(0);
    expect(events.map((event) => [event.number, event.status])).toEqual([
      [2, "started"],
      [2, "completed"],
    ]);
    expect(new Set(events.map((event) => event.id)).size).toBe(1);
    expect(revised.usage.filter((record) => record.revision === 2).map((record) => record.task)).toEqual(["critique", "reassess"]);

    const latest = await (await app.request(`/api/sessions/${session.id}/report.md`, { headers: as("ada") })).text();
    expect(latest).toContain("## What changed since revision 1");
    const first = await (await app.request(`/api/sessions/${session.id}/report.md?revision=1`, { headers: as("ada") })).text();
    expect(first).toContain(" · Revision 1 · ");
    expect(first).not.toContain("What changed");
    expect(first).toContain("Which SMS provider meets the cost assumption?");
    expect((await app.request(`/api/sessions/${session.id}/report.md?revision=9`, { headers: as("ada") })).status).toBe(404);
    const word = await app.request(`/api/sessions/${session.id}/report.docx?revision=1`, { headers: as("ada") });
    expect(word.status).toBe(200);
  });

  it("are refused before the verdict, without facts, or when the host will not pay", async () => {
    let allow = true;
    const events: RevisionEvent[] = [];
    const opened = await openApp(
      backend,
      hostedHooks({
        authorizeSpend: async (_user, _session, _estimate, purchase) =>
          allow || purchase?.kind !== "revision" ? { ok: true } : { ok: false, code: "insufficient_credits", reason: "Buy credits." },
        onRevision: (_user, _session, event) => {
          events.push(event);
        },
      }),
    );
    storage = opened.storage;
    const { app } = opened;
    const created = await app.request("/api/sessions", send({ locale: "en", idea: "A CRM" }));
    const { session: early } = (await created.json()) as { session: Session };
    await waitFor(app, early.id, (s) => s.interview.length === 1);
    expect(await (await app.request(`/api/sessions/${early.id}/revisions`, send(facts))).json()).toMatchObject({ error: "wrong_phase" });

    const session = await ruled(app);
    const empty = await app.request(`/api/sessions/${session.id}/revisions`, send({ facts: [], note: "  " }));
    expect(await empty.json()).toMatchObject({ error: "no_answers" });
    allow = false;
    const refused = await app.request(`/api/sessions/${session.id}/revisions`, send(facts));
    expect(refused.status).toBe(402);
    expect(events).toEqual([]);
    expect((await detail(app, session.id)).session.revising).toBeNull();
  });

  it("tell the host a revision failed when the arbiter stops, and leave the verdict as it was", async () => {
    const events: RevisionEvent[] = [];
    const opened = await openApp(
      backend,
      hostedHooks({
        onRevision: (_user, _session, event) => {
          events.push(event);
        },
        // Too small for the arbiter's ruling: the revision stops before any call.
        revisionBudgetUsd: () => 0,
      }),
    );
    storage = opened.storage;
    const { app } = opened;
    const session = await ruled(app);
    // The demo model costs nothing: give the ruling a price so the cap stops it.
    const { setModelPrice } = await import("@quorumind/core");
    setModelPrice("mock", { input: 1, output: 1 });
    try {
      await app.request(`/api/sessions/${session.id}/revisions`, send(facts));
      const failed = await waitFor(app, session.id, (s) => Boolean(s.revising?.error));
      expect(failed.revising?.error?.code).toBe("budget_exceeded");
      expect(failed.revisions).toHaveLength(1);
      expect(failed.phase).toBe("complete");
      expect(events.map((event) => event.status)).toEqual(["started", "failed"]);
      expect(failed.usage.filter((record) => record.revision === 2)).toEqual([]);
    } finally {
      setModelPrice("mock", { input: 0, output: 0 });
    }
  });
});

describe("sessions ruled on before revisions", () => {
  const legacy = () => {
    const session = createSession({
      locale: "en",
      idea: "Old",
      demo: true,
      interviewer: { provider: "mock", model: "mock" },
      arbiter: { provider: "mock", model: "mock" },
      seats: { A: { provider: "mock", model: "mock" } },
    });
    const { revisions: _revisions, revising: _revising, ...stored } = { ...session, phase: "complete", verdict: DEMO_SCRIPT.verdict };
    return stored as unknown as Session;
  };

  it("get their verdict as revision 1 in the PostgreSQL documents", async () => {
    const db = await pgliteDatabase();
    try {
      const all = loadMigrations(fileURLToPath(new URL("./postgres/migrations/", import.meta.url)));
      await migrate(db, "quorumind", all.slice(0, 4));
      const session = legacy();
      const unruled = { ...legacy(), id: "unruled", verdict: null };
      for (const item of [session, unruled]) {
        await db.query("INSERT INTO sessions (id, data, created_at, updated_at) VALUES ($1, $2, $3, $3)", [
          item.id,
          JSON.stringify(item),
          session.updatedAt,
        ]);
      }
      expect(await migrateSessions(db)).toEqual([5, 6, 7]);
      const { rows } = await db.query<{ data: Session }>("SELECT data FROM sessions WHERE id = $1", [session.id]);
      expect(rows[0]?.data.revisions).toEqual([
        {
          number: 1,
          createdAt: session.updatedAt,
          reason: "debate",
          inputs: { facts: [], note: null, questionnaireId: null },
          basedOn: null,
          verdict: DEMO_SCRIPT.verdict,
          costs: [],
          critiques: [],
          by: null,
        },
      ]);
      const untouched = await db.query<{ data: Session }>("SELECT data FROM sessions WHERE id = 'unruled'");
      expect(untouched.rows[0]?.data.revisions).toBeUndefined();
      expect((await new PostgresSessionStore(db).get("unruled"))?.revisions).toEqual([]);
    } finally {
      await db.close();
    }
  });

  it("get their verdict as revision 1 in the SQLite documents, once", async () => {
    const dir = mkdtempSync(join(tmpdir(), "quorumind-revisions-"));
    try {
      const path = join(dir, "quorumind.db");
      const session = legacy();
      const old = new DatabaseSync(path);
      old.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL)");
      old.prepare("INSERT INTO sessions VALUES (?, ?, ?)").run(session.id, JSON.stringify(session), session.updatedAt);
      old.close();
      await new SqliteSessionStore(path).close();
      const db = new DatabaseSync(path);
      const row = db.prepare("SELECT data FROM sessions").get() as { data: string };
      const stored = JSON.parse(row.data) as Session;
      expect(stored.revisions).toHaveLength(1);
      expect(stored.revisions[0]).toMatchObject({ number: 1, reason: "debate", basedOn: null, createdAt: session.updatedAt });
      expect(stored.revisions[0]?.verdict).toEqual(DEMO_SCRIPT.verdict);
      expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(1);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe.each(BACKENDS)("an unfinished revision on $name", (backend) => {
  it("is marked interrupted when the server starts again, the session staying complete", async () => {
    storage = await backend.open();
    const session = createSession({
      locale: "en",
      idea: "Revising",
      demo: true,
      interviewer: { provider: "mock", model: "mock" },
      arbiter: { provider: "mock", model: "mock" },
      seats: { A: { provider: "mock", model: "mock" } },
    });
    session.phase = "complete";
    session.verdict = DEMO_SCRIPT.verdict;
    session.revising = {
      id: "attempt",
      number: 2,
      reason: "edit",
      inputs: { facts: [], note: "Later launch", questionnaireId: null },
      basedOn: 1,
      by: null,
      startedAt: new Date().toISOString(),
      error: null,
    };
    await storage.store.save(session);
    const restarted = storage.reopen();
    expect(await restarted.markInterrupted()).toBe(1);
    const stored = await storage.reopen().get(session.id);
    expect(stored?.phase).toBe("complete");
    expect(stored?.revising?.error?.code).toBe("interrupted");
    expect(await storage.reopen().markInterrupted()).toBe(0);
  });
});
