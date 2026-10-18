import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { createSession, type Session } from "@quorumind/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteBrandingStore } from "./branding.ts";
import { loadMigrations, migrate } from "./postgres/migrate.ts";
import { pgliteDatabase } from "./postgres/pglite.ts";
import { migrateSessions, PostgresSessionStore } from "./postgres/store.ts";
import { SqliteSessionStore } from "./store.ts";
import { BACKENDS, type TestStorage, testDatabase } from "./testing.ts";

const mock = { provider: "mock" as const, model: "mock" };

function newSession(idea: string, updatedAt = new Date().toISOString()): Session {
  const session = createSession({ locale: "en", idea, demo: true, interviewer: mock, arbiter: mock, seats: { A: mock, B: mock } });
  session.updatedAt = updatedAt;
  return session;
}

function completed(idea: string, updatedAt?: string): Session {
  const session = newSession(idea, updatedAt);
  session.phase = "complete";
  return session;
}

const day = (n: number) => new Date(Date.UTC(2026, 9, n)).toISOString();

describe.each(BACKENDS)("the session store on $name", (backend) => {
  let storage: TestStorage;
  beforeEach(async () => {
    storage = await backend.open();
  });
  afterEach(() => storage.close());

  it("keeps one live object per session and reads it back after a restart", async () => {
    const { store } = storage;
    const session = newSession("A CRM");
    await store.save(session);
    expect(await store.get(session.id)).toBe(session);
    session.idea = "A CRM for bakeries";
    await store.save(session);

    const restarted = storage.reopen();
    const [first, second] = await Promise.all([restarted.get(session.id), restarted.get(session.id)]);
    expect(first).toEqual(session);
    expect(first).not.toBe(session);
    // Two requests loading it at once still share one object.
    expect(second).toBe(first);
    expect(await restarted.get("unknown")).toBeNull();
  });

  it("only shows a session to its owner", async () => {
    const { store } = storage;
    const ada = newSession("Ada's");
    const local = newSession("Local");
    await store.save(ada, "ada");
    await store.save(local);
    // The engine saves without an owner: the session keeps the one it was created with.
    await store.save(ada);
    expect(await store.get(ada.id, "bob")).toBeNull();
    expect(await store.get(ada.id)).toBeNull();
    expect(await store.get(ada.id, "ada")).toBe(ada);

    const restarted = storage.reopen();
    expect(await restarted.get(ada.id)).toBeNull();
    expect((await restarted.get(ada.id, "ada"))?.idea).toBe("Ada's");
    expect((await restarted.list(50, "ada")).map((summary) => summary.id)).toEqual([ada.id]);
    expect((await restarted.list()).map((summary) => summary.id)).toEqual([local.id]);
    expect(await restarted.delete(ada.id, "bob")).toBe(false);
    expect(await restarted.all("bob")).toEqual([]);
  });

  it("shares a session with the workspace it was started in, unless it is private", async () => {
    const { store } = storage;
    const shared = newSession("Shared", day(4));
    const secret = newSession("Secret", day(3));
    const bobs = newSession("Bob's", day(2));
    const legacy = newSession("Legacy", day(1));
    const elsewhere = newSession("Elsewhere", day(5));
    await store.save(shared, "ada", { workspace: "team" });
    await store.save(secret, "ada", { workspace: "team", private: true });
    await store.save(bobs, "bob", { workspace: "team" });
    await store.save(legacy, "ada");
    await store.save(elsewhere, "ada", { workspace: "other" });
    // The engine saves without a placement: the session keeps the one it was created with.
    await store.save(shared);

    for (const view of [store, storage.reopen()]) {
      const history = async (owner: string, mine = false) =>
        (await view.history(50, { owner, workspace: "team", mine })).map((entry) => entry.idea);
      expect(await history("ada")).toEqual(["Shared", "Secret", "Bob's", "Legacy"]);
      expect(await history("bob")).toEqual(["Shared", "Bob's"]);
      expect(await history("ada", true)).toEqual(["Shared", "Secret", "Legacy"]);
      expect((await view.history(50, { owner: "ada", workspace: null })).map((entry) => entry.idea)).toEqual(["Legacy"]);
      expect((await view.history(1, { owner: "ada", workspace: "team" }))[0]).toEqual({
        id: shared.id,
        idea: "Shared",
        phase: "interview",
        mode: "standard",
        updatedAt: day(4),
        owner: "ada",
        workspace: "team",
        private: false,
      });
      expect(await view.find(secret.id)).toMatchObject({ owner: "ada", workspace: "team", private: true, session: { id: secret.id } });
      expect(await view.find(legacy.id)).toMatchObject({ owner: "ada", workspace: null, private: false });
      expect(await view.find("unknown")).toBeNull();
      // Read by its owner only, as before.
      expect(await view.get(bobs.id, "ada")).toBeNull();
    }

    await store.setPrivate(secret.id, false);
    await store.setPrivate(shared.id, true);
    expect((await store.find(shared.id))?.private).toBe(true);
    const restarted = storage.reopen();
    expect((await restarted.history(50, { owner: "bob", workspace: "team" })).map((entry) => entry.idea)).toEqual(["Secret", "Bob's"]);
    expect((await restarted.find(shared.id))?.private).toBe(true);
  });

  it("lists the latest sessions first, and exports them all oldest first", async () => {
    const { store } = storage;
    const old = newSession("Old", day(1));
    const recent = newSession("Recent", day(3));
    const middle = newSession("Middle", day(2));
    middle.sheet = { projectName: "Named project" } as Session["sheet"];
    for (const session of [old, recent, middle]) await store.save(session, "ada");

    const list = await storage.reopen().list(2, "ada");
    expect(list).toEqual([
      { id: recent.id, idea: "Recent", phase: "interview", mode: "standard", updatedAt: day(3) },
      { id: middle.id, idea: "Named project", phase: "interview", mode: "standard", updatedAt: day(2) },
    ]);
    expect((await store.all("ada")).map((session) => session.idea)).toEqual(["Old", "Middle", "Recent"]);
  });

  it("applies the writes of a session in the order they were made", async () => {
    const { store } = storage;
    const session = newSession("v0");
    const writes: Promise<void>[] = [];
    for (let version = 1; version <= 20; version++) {
      session.idea = `v${version}`;
      writes.push(store.save(session));
    }
    // The object moves on while the writes wait: each one stores the session as it was when saved.
    session.idea = "unsaved";
    await Promise.all(writes);
    expect((await storage.reopen().get(session.id))?.idea).toBe("v20");
  });

  it("deletes a session with its share link and feedback", async () => {
    const { store } = storage;
    const session = completed("Shared");
    await store.save(session);
    const share = await store.share(session.id, { public: true });
    await store.addFeedback({ sessionId: session.id, helpful: true, kind: "rating", comment: "", createdAt: day(1) });
    expect(await store.delete(session.id)).toBe(true);
    expect(await store.get(session.id)).toBeNull();
    expect(await store.shared(share.token)).toBeNull();
    expect(await store.shareOf(session.id)).toBeNull();
    expect(await store.feedbackOf(session.id)).toEqual([]);
    expect(await store.delete(session.id)).toBe(false);
  });

  it("fails the sessions a stopped server left working, and only those", async () => {
    const { store } = storage;
    const starting = newSession("Interviewer due", day(1));
    const debating = newSession("Debating", day(1));
    debating.phase = "debating";
    const waiting = newSession("Waiting for the person", day(1));
    waiting.interview.push({ kind: "interviewer", data: { speech: "", status: "ask", questions: [], sheet: null } });
    const done = completed("Done", day(1));
    for (const session of [starting, debating, waiting, done]) await store.save(session, "ada");

    const restarted = storage.reopen();
    expect(await restarted.markInterrupted(new Date(day(2)))).toBe(2);
    const phases = await Promise.all([starting, debating, waiting, done].map((session) => restarted.get(session.id, "ada")));
    expect(phases.map((session) => session?.phase)).toEqual(["failed", "failed", "interview", "complete"]);
    expect(phases[1]?.error?.code).toBe("interrupted");
    expect(phases[1]?.updatedAt).toBe(day(2));
    // A second start finds nothing left to fix; the owner is kept.
    expect(await storage.reopen().markInterrupted()).toBe(0);
    expect((await storage.reopen().list(50, "ada")).filter((summary) => summary.phase === "failed")).toHaveLength(2);
  });

  it("purges the sessions nobody touched for the retention period", async () => {
    const { store } = storage;
    const stale = newSession("Stale", day(1));
    const fresh = newSession("Fresh", day(20));
    await store.save(stale);
    await store.save(fresh);
    await store.share(stale.id, {});
    await store.addFeedback({ sessionId: stale.id, helpful: null, kind: "error", comment: "Broke", createdAt: day(1) });

    expect(await store.purgeOlderThan(10, Date.parse(day(15)))).toBe(1);
    expect(await store.get(stale.id)).toBeNull();
    expect(await storage.reopen().get(stale.id)).toBeNull();
    expect(await store.feedbackOf(stale.id)).toEqual([]);
    expect(await store.shareOf(stale.id)).toBeNull();
    expect(await store.get(fresh.id)).toBe(fresh);
    expect(await store.purgeOlderThan(10, Date.parse(day(15)))).toBe(0);
  });

  it("shares a session through one link, and changes only what is asked", async () => {
    const { store } = storage;
    const session = completed("Shared");
    await store.save(session, "ada");
    expect(await store.shareOf(session.id)).toBeNull();

    const share = await store.share(session.id, {});
    expect(share).toEqual({
      token: expect.stringMatching(/^[\w-]{24}$/),
      public: false,
      createdAt: expect.any(String),
      mode: "client",
      expiresAt: null,
      hasPassword: false,
    });
    const again = await store.share(session.id, { public: true });
    expect(again).toEqual({ ...share, public: true });
    expect(await store.shareOf(session.id)).toEqual(again);
    const changed = await store.share(session.id, { mode: "full", expiresAt: day(30), passwordHash: "scrypt$hash" });
    expect(changed).toEqual({ ...again, mode: "full", expiresAt: day(30), hasPassword: true });
    expect(JSON.stringify(await store.shareOf(session.id))).not.toContain("scrypt");
    expect(await store.share(session.id, { passwordHash: null, expiresAt: null })).toEqual({
      ...changed,
      expiresAt: null,
      hasPassword: false,
    });

    // The token is the permission: whoever owns the session. A live session is the object in use.
    expect((await store.shared(share.token))?.session).toBe(session);
    expect(await storage.reopen().shared(share.token)).toEqual({
      session,
      share: { ...changed, expiresAt: null, hasPassword: false, passwordHash: null },
    });
    expect(await store.shared("unknown")).toBeNull();

    await store.unshare(session.id);
    expect(await store.shareOf(session.id)).toBeNull();
    expect(await store.shared(share.token)).toBeNull();
  });

  it("shows the completed public sessions in the gallery, latest first", async () => {
    const { store } = storage;
    const older = completed("Older", day(1));
    older.sheet = { projectName: "Older project", summary: "What was decided" } as Session["sheet"];
    const newer = completed("Newer", day(2));
    const unfinished = newSession("Unfinished", day(3));
    const unlisted = completed("Unlisted", day(4));
    const expired = completed("Expired", day(5));
    const protectedOne = completed("Protected", day(6));
    const hidden = completed("Private", day(7));
    for (const session of [older, newer, unfinished, unlisted, expired, protectedOne, hidden]) {
      await store.save(session, "ada", { workspace: "team", private: session === hidden });
      await store.share(session.id, {
        public: session !== unlisted,
        ...(session === expired ? { expiresAt: day(1) } : {}),
        ...(session === protectedOne ? { passwordHash: "scrypt$hash" } : {}),
      });
    }
    const gallery = await storage.reopen().gallery();
    expect(gallery.map((entry) => entry.idea)).toEqual(["Newer", "Older project"]);
    expect(gallery[1]).toMatchObject({ id: older.id, token: (await store.shareOf(older.id))?.token, summary: "What was decided" });
    expect(gallery[0]?.summary).toBeNull();
  });

  it("keeps the feedback of a session in order", async () => {
    const { store } = storage;
    const session = newSession("Rated");
    await store.save(session);
    await store.addFeedback({ sessionId: session.id, helpful: true, kind: "rating", comment: "Clear", createdAt: day(1) });
    await store.addFeedback({ sessionId: session.id, helpful: false, kind: "rating", comment: "", createdAt: day(2) });
    await store.addFeedback({ sessionId: session.id, helpful: null, kind: "error", comment: "Timed out", createdAt: day(3) });
    expect(await store.feedbackOf(session.id)).toEqual([
      { sessionId: session.id, helpful: true, kind: "rating", comment: "Clear", createdAt: day(1) },
      { sessionId: session.id, helpful: false, kind: "rating", comment: "", createdAt: day(2) },
      { sessionId: session.id, helpful: null, kind: "error", comment: "Timed out", createdAt: day(3) },
    ]);
  });

  it("keeps a branding per owner", async () => {
    const { brandingStore } = storage;
    expect(await brandingStore.get()).toEqual({ name: null, logoDataUrl: null, accent: null });
    const extra = { name: "Agency", logoDataUrl: null, accent: "#123456", unknown: true };
    expect(await brandingStore.set(null, extra)).toEqual({ name: "Agency", logoDataUrl: null, accent: "#123456" });
    await brandingStore.set("ada", { name: "Ada Studio", logoDataUrl: null, accent: null });
    await brandingStore.set("ada", { name: "Ada Studio 2", logoDataUrl: null, accent: null });
    expect(await brandingStore.get()).toEqual({ name: "Agency", logoDataUrl: null, accent: "#123456" });
    expect((await brandingStore.get("ada")).name).toBe("Ada Studio 2");
    await brandingStore.delete("ada");
    expect((await brandingStore.get("ada")).name).toBeNull();
    expect((await brandingStore.get()).name).toBe("Agency");
  });
});

describe("the PostgreSQL schema", () => {
  it("is migrated once, even by servers starting together", async () => {
    const db = await pgliteDatabase();
    try {
      const runs = await Promise.all([migrateSessions(db), migrateSessions(db)]);
      expect(runs.flat()).toEqual([1, 2, 3]);
      expect(await migrateSessions(db)).toEqual([]);
      const { rows } = await db.query("SELECT component, version, name FROM schema_migrations ORDER BY version");
      expect(rows).toEqual([
        { component: "quorumind", version: 1, name: "sessions" },
        { component: "quorumind", version: 2, name: "workspaces" },
        { component: "quorumind", version: 3, name: "share_options" },
      ]);
    } finally {
      await db.close();
    }
  });

  it("keeps the owner of the sessions stored before workspaces, unshared and not private", async () => {
    const db = await pgliteDatabase();
    try {
      const [first] = loadMigrations(fileURLToPath(new URL("./postgres/migrations/", import.meta.url)));
      await migrate(db, "quorumind", first ? [first] : []);
      const session = newSession("Before");
      await db.query("INSERT INTO sessions (id, owner_id, data, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)", [
        session.id,
        "ada",
        JSON.stringify(session),
        day(1),
      ]);
      expect(await migrateSessions(db)).toEqual([2, 3]);
      const store = new PostgresSessionStore(db);
      expect(await store.find(session.id)).toMatchObject({ owner: "ada", workspace: null, private: false });
      expect((await store.history(50, { owner: "ada", workspace: "team" })).map((entry) => entry.id)).toEqual([session.id]);
    } finally {
      await db.close();
    }
  });

  it("rolls back a transaction that fails", async () => {
    const db = await testDatabase();
    try {
      const session = newSession("Kept");
      await expect(
        db.transaction(async (tx) => {
          await tx.query("INSERT INTO sessions (id, data, created_at, updated_at) VALUES ($1, $2, $3, $3)", ["s1", "{}", day(1)]);
          throw new Error("Interrupted");
        }),
      ).rejects.toThrow("Interrupted");
      const store = new PostgresSessionStore(db);
      await store.save(session);
      expect((await db.query("SELECT id FROM sessions")).rows).toEqual([{ id: session.id }]);
    } finally {
      await db.close();
    }
  });

  it("stores text holding a NUL character, which PostgreSQL refuses", async () => {
    const db = await testDatabase();
    try {
      const session = newSession("A\0B");
      await new PostgresSessionStore(db).save(session);
      expect((await new PostgresSessionStore(db).get(session.id))?.idea).toBe("AB");
    } finally {
      await db.close();
    }
  });
});

describe("the SQLite schema", () => {
  it("adds the workspace and private columns to a database from before them, keeping each session's owner", async () => {
    const dir = mkdtempSync(join(tmpdir(), "quorumind-schema-"));
    try {
      const path = join(dir, "quorumind.db");
      const session = newSession("Before");
      const old = new DatabaseSync(path);
      old.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL, owner_id TEXT)");
      old.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?)").run(session.id, JSON.stringify(session), day(1), "ada");
      old.close();
      const store = new SqliteSessionStore(path);
      expect(await store.find(session.id)).toMatchObject({ owner: "ada", workspace: null, private: false });
      expect((await store.history(50, { owner: "ada", workspace: "team" })).map((entry) => entry.id)).toEqual([session.id]);
      await store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("share links made before their options", () => {
  it("keep showing the whole session, with no expiry, on SQLite", async () => {
    const dir = mkdtempSync(join(tmpdir(), "quorumind-shares-"));
    try {
      const path = join(dir, "quorumind.db");
      const db = new DatabaseSync(path);
      db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL, owner_id TEXT);
        CREATE TABLE shares (token TEXT PRIMARY KEY, session_id TEXT NOT NULL UNIQUE, public INTEGER NOT NULL, created_at TEXT NOT NULL);`);
      const session = completed("Old link", day(1));
      db.prepare("INSERT INTO sessions (id, data, updated_at) VALUES (?, ?, ?)").run(session.id, JSON.stringify(session), day(1));
      db.prepare("INSERT INTO shares VALUES ('old-token', ?, 1, ?)").run(session.id, day(1));
      db.close();
      const store = new SqliteSessionStore(path);
      expect(await store.shareOf(session.id)).toEqual({
        token: "old-token",
        public: true,
        createdAt: day(1),
        mode: "full",
        expiresAt: null,
        hasPassword: false,
      });
      expect((await store.gallery()).map((entry) => entry.token)).toEqual(["old-token"]);
      await store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keep showing the whole session, with no expiry, on PostgreSQL", async () => {
    const db = await pgliteDatabase();
    try {
      await migrate(db, "quorumind", loadMigrations(fileURLToPath(new URL("./postgres/migrations/", import.meta.url))).slice(0, 2));
      const session = completed("Old link", day(1));
      await new PostgresSessionStore(db).save(session);
      await db.query("INSERT INTO shares (token, session_id, public, created_at) VALUES ('old-token', $1, true, $2)", [session.id, day(1)]);
      expect(await migrateSessions(db)).toEqual([3]);
      expect(await new PostgresSessionStore(db).shareOf(session.id)).toEqual({
        token: "old-token",
        public: true,
        createdAt: day(1),
        mode: "full",
        expiresAt: null,
        hasPassword: false,
      });
    } finally {
      await db.close();
    }
  });
});

describe("the SQLite branding", () => {
  it("persists in the settings table, through a path or an open database", async () => {
    const dir = mkdtempSync(join(tmpdir(), "quorumind-branding-"));
    try {
      const path = join(dir, "quorumind.db");
      const sessions = new SqliteSessionStore(path);
      const writer = new SqliteBrandingStore(path);
      await writer.set(null, { name: "Agency", logoDataUrl: null, accent: "#123456" });
      await writer.set("ada", { name: "Ada Studio", logoDataUrl: null, accent: null });
      await writer.close();
      const db = new DatabaseSync(path);
      expect(await new SqliteBrandingStore(db).get()).toEqual({ name: "Agency", logoDataUrl: null, accent: "#123456" });
      expect((await new SqliteBrandingStore(db).get("ada")).name).toBe("Ada Studio");
      expect(db.prepare("SELECT key FROM settings ORDER BY key").all()).toEqual([{ key: "branding" }, { key: "branding:ada" }]);
      db.close();
      await sessions.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
