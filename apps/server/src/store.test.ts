import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createSession, type Session } from "@quorumind/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteBrandingStore } from "./branding.ts";
import { SqliteSessionStore } from "./store.ts";
import { BACKENDS, type TestStorage } from "./testing.ts";

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
    const share = await store.share(session.id, true);
    await store.addFeedback({ sessionId: session.id, helpful: true, kind: "rating", comment: "", createdAt: day(1) });
    expect(await store.delete(session.id)).toBe(true);
    expect(await store.get(session.id)).toBeNull();
    expect(await store.shared(share.token)).toBeNull();
    expect(await store.shareOf(session.id)).toBeNull();
    expect(await store.feedbackOf(session.id)).toEqual([]);
    expect(await store.delete(session.id)).toBe(false);
  });

  it("purges the sessions nobody touched for the retention period", async () => {
    const { store } = storage;
    const stale = newSession("Stale", day(1));
    const fresh = newSession("Fresh", day(20));
    await store.save(stale);
    await store.save(fresh);
    await store.share(stale.id, false);
    await store.addFeedback({ sessionId: stale.id, helpful: null, kind: "error", comment: "Broke", createdAt: day(1) });

    expect(await store.purgeOlderThan(10, Date.parse(day(15)))).toBe(1);
    expect(await store.get(stale.id)).toBeNull();
    expect(await storage.reopen().get(stale.id)).toBeNull();
    expect(await store.feedbackOf(stale.id)).toEqual([]);
    expect(await store.shareOf(stale.id)).toBeNull();
    expect(await store.get(fresh.id)).toBe(fresh);
    expect(await store.purgeOlderThan(10, Date.parse(day(15)))).toBe(0);
  });

  it("shares a session through one link, public or not", async () => {
    const { store } = storage;
    const session = completed("Shared");
    await store.save(session, "ada");
    expect(await store.shareOf(session.id)).toBeNull();

    const share = await store.share(session.id, false);
    expect(share).toEqual({ token: expect.stringMatching(/^[\w-]{24}$/), public: false, createdAt: expect.any(String) });
    const again = await store.share(session.id, true);
    expect(again).toEqual({ ...share, public: true });
    expect(await store.shareOf(session.id)).toEqual(again);

    // The token is the permission: whoever owns the session. A live session is the object in use.
    expect(await store.shared(share.token)).toBe(session);
    expect(await storage.reopen().shared(share.token)).toEqual(session);
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
    for (const session of [older, newer, unfinished, unlisted]) {
      await store.save(session);
      await store.share(session.id, session !== unlisted);
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
