import { createSession, type Session } from "@quorumind/core";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { EventBus } from "./bus.ts";
import {
  decodeCursor,
  encodeCursor,
  type GalleryEntry,
  type PageKey,
  type PageOptions,
  SEARCH_LIMITS,
  type SessionStore,
  type SessionSummary,
} from "./store.ts";
import { BACKENDS, type TestStorage } from "./testing.ts";
import { as, hostedHooks, openApp, ruled } from "./testing-app.ts";

// The history beyond one page: cursors that hold when sessions are saved at the same instant, the search by title, the
// size of a page, and a store that knows nothing of any of it (the hosted version's, until it is updated).

const mock = { provider: "mock" as const, model: "mock" };

function newSession(idea: string, updatedAt: string): Session {
  const session = createSession({ locale: "en", idea, demo: true, interviewer: mock, arbiter: mock, seats: { A: mock, B: mock } });
  session.updatedAt = updatedAt;
  return session;
}

/** Runs `work` with the search limits lowered, as a large history would reach them. */
async function withLimits(limits: Partial<typeof SEARCH_LIMITS>, work: () => Promise<void>) {
  const before = { ...SEARCH_LIMITS };
  Object.assign(SEARCH_LIMITS, limits);
  try {
    await work();
  } finally {
    Object.assign(SEARCH_LIMITS, before);
  }
}

const day = (n: number) => new Date(Date.UTC(2026, 9, n)).toISOString();

/** Every page of a list, walked with the cursor of the last entry, as the client does. */
async function walk(read: (before: PageKey | undefined) => Promise<{ id: string; updatedAt: string }[]>, size: number) {
  const pages: string[][] = [];
  let before: PageKey | undefined;
  for (let guard = 0; guard < 100; guard++) {
    const entries = await read(before);
    if (entries.length === 0) break;
    pages.push(entries.map((entry) => entry.id));
    const last = entries.at(-1);
    if (!last || entries.length < size) break;
    before = { updatedAt: last.updatedAt, id: last.id };
  }
  return pages;
}

describe.each(BACKENDS)("paged lists on $name", (backend) => {
  let storage: TestStorage | undefined;
  afterEach(() => storage?.close());

  it("never repeats or skips a session when several were saved at the same instant", async () => {
    storage = await backend.open();
    const { store } = storage;
    const same = day(5);
    const tied = Array.from({ length: 7 }, (_, index) => newSession(`Tied ${index}`, same));
    const newer = newSession("Newer", day(9));
    const older = newSession("Older", day(1));
    for (const session of [...tied, newer, older]) await store.save(session, "ada", { workspace: "team" });

    const history = (page: { before?: PageKey; search?: string }, limit: number) =>
      store.history(limit, { owner: "ada", workspace: "team" }, page);
    const pages = await walk((before) => history(before ? { before } : {}, 3), 3);
    const everyone = pages.flat();
    expect(pages.map((page) => page.length)).toEqual([3, 3, 3]);
    expect(new Set(everyone).size).toBe(9);
    expect(everyone[0]).toBe(newer.id);
    expect(everyone.at(-1)).toBe(older.id);
    // The same order whatever the page size, and as the unpaged list gives it.
    expect(everyone).toEqual((await history({}, 50)).map((entry) => entry.id));
    expect((await walk((before) => history(before ? { before } : {}, 2), 2)).flat()).toEqual(everyone);

    // The owner's plain list pages the same way.
    expect((await walk((before) => store.list(4, "ada", before ? { before } : {}), 4)).flat()).toEqual(everyone);
  });

  it("pages the list of a self-hosted owner", async () => {
    storage = await backend.open();
    const { store } = storage;
    const sessions = Array.from({ length: 5 }, (_, index) => newSession(`Local ${index}`, day(3)));
    for (const session of sessions) await store.save(session);
    const pages = await walk((before) => store.list(2, null, before ? { before } : {}), 2);
    expect(pages.map((page) => page.length)).toEqual([2, 2, 1]);
    expect(new Set(pages.flat()).size).toBe(5);
  });

  it("finds titles by their words, whatever the case or the accents, and pages through the matches", async () => {
    storage = await backend.open();
    const { store } = storage;
    await store.save(newSession("Équipe de nuit", day(1)), "ada", { workspace: "team" });
    await store.save(newSession("Night EQUIPE rota", day(2)), "ada", { workspace: "team" });
    await store.save(newSession("Something else", day(3)), "ada", { workspace: "team" });
    await store.save(newSession("Une autre équipe", day(4)), "ada", { workspace: "team" });
    const scope = { owner: "ada", workspace: "team" };

    expect((await store.history(10, scope, { search: "equipe" })).map((entry) => entry.idea)).toEqual([
      "Une autre équipe",
      "Night EQUIPE rota",
      "Équipe de nuit",
    ]);
    expect((await store.history(10, scope, { search: "  ÉQUIPE " })).length).toBe(3);
    expect(await store.history(10, scope, { search: "nothing like it" })).toEqual([]);
    const first = await store.history(2, scope, { search: "equipe" });
    expect(first.map((entry) => entry.idea)).toEqual(["Une autre équipe", "Night EQUIPE rota"]);
    const last = first[1];
    expect(
      (await store.history(2, scope, { search: "equipe", before: { updatedAt: last?.updatedAt ?? "", id: last?.id ?? "" } })).map(
        (entry) => entry.idea,
      ),
    ).toEqual(["Équipe de nuit"]);
    // A blank search is no search.
    expect((await store.history(10, scope, { search: "   " })).length).toBe(4);
  });

  it("finds a title beyond the first chunk it reads, scanning titles chunk by chunk", async () => {
    storage = await backend.open();
    const { store } = storage;
    await store.save(newSession("Zeppelin freight", day(1)));
    for (let index = 0; index < 25; index++) {
      await store.save(newSession(`Filler ${index}`, new Date(Date.UTC(2026, 10, 1, 0, 0, index)).toISOString()));
    }
    await withLimits({ chunk: 10, cap: 100 }, async () => {
      const page: PageOptions = { search: "zeppelin" };
      expect((await store.list(50, null, page)).map((entry) => entry.idea)).toEqual(["Zeppelin freight"]);
      // Reached within the cap: nothing is left to continue.
      expect(page.progress).toBeUndefined();
    });
    expect((await store.list(50)).length).toBe(26);
  });

  it("searches the title a debate shows (the sheet's project name before the idea), nothing else of it", async () => {
    storage = await backend.open();
    const { store } = storage;
    const renamed = newSession("Original idea about rockets", day(2));
    renamed.sheet = { ...(renamed.sheet ?? {}), projectName: "Renamed thing" } as NonNullable<Session["sheet"]>;
    const mentioning = newSession("Unrelated", day(1));
    mentioning.interview = [{ question: "Rockets?", answer: "Rockets are in the transcript only" }] as unknown as Session["interview"];
    await store.save(renamed);
    await store.save(mentioning);
    expect((await store.list(10, null, { search: "renamed" })).map((entry) => entry.idea)).toEqual(["Renamed thing"]);
    expect(await store.list(10, null, { search: "rockets" })).toEqual([]);
  });

  it("examines a bounded number of rows per search, and says where it went on from", async () => {
    storage = await backend.open();
    const { store } = storage;
    await store.save(newSession("Zeppelin freight", day(1)));
    for (let index = 0; index < 30; index++) {
      await store.save(newSession(`Filler ${index}`, new Date(Date.UTC(2026, 10, 1, 0, 0, index)).toISOString()));
    }
    await withLimits({ chunk: 5, cap: 12 }, async () => {
      let before: PageKey | undefined;
      const requests: { found: string[]; resumed: boolean }[] = [];
      for (let guard = 0; guard < 10; guard++) {
        const page: PageOptions = { search: "zeppelin", ...(before ? { before } : {}) };
        const found = (await store.list(5, null, page)).map((entry) => entry.idea);
        requests.push({ found, resumed: page.progress?.resumeAfter !== undefined });
        before = page.progress?.resumeAfter;
        if (!before) break;
      }
      // 31 rows, 12 examined at a time: the match is in the third request, and the first two found nothing but went on.
      expect(requests).toEqual([
        { found: [], resumed: true },
        { found: [], resumed: true },
        { found: ["Zeppelin freight"], resumed: false },
      ]);
    });
  });

  it("pages the gallery, which holds completed and public debates only", async () => {
    storage = await backend.open();
    const { store } = storage;
    const sessions: Session[] = [];
    for (let index = 0; index < 5; index++) {
      const session = newSession(`Public ${index}`, day(4));
      session.phase = "complete";
      sessions.push(session);
      await store.save(session);
      await store.share(session.id, { public: true });
    }
    const unfinished = newSession("Unfinished", day(8));
    await store.save(unfinished);
    await store.share(unfinished.id, { public: true });
    const pages = await walk((before) => store.gallery(2, before ? { before } : {}), 2);
    expect(pages.map((page) => page.length)).toEqual([2, 2, 1]);
    expect(new Set(pages.flat()).size).toBe(5);
    expect(pages.flat()).not.toContain(unfinished.id);
    // The gallery has no search: a store never scans it for one.
    const unsearched: GalleryEntry[] = await store.gallery(10, { search: "public 3" });
    expect(unsearched).toHaveLength(5);
  });
});

describe("cursors", () => {
  it("round-trip, and refuse what a server did not make", () => {
    const key = { updatedAt: day(3), id: "abc" };
    expect(decodeCursor(encodeCursor(key))).toEqual(key);
    // A time the stores did not write is refused here, not by the database (PostgreSQL would answer a 500).
    const forged = [Buffer.from('["1","x"]'), Buffer.from('["2026-10-03","x"]'), Buffer.from('["not a date","x"]'), Buffer.from("[1,2]")];
    for (const text of ["", "nope", ...forged.map((bytes) => bytes.toString("base64url"))]) {
      expect(decodeCursor(text)).toBeNull();
    }
  });
});

describe.each(BACKENDS)("the history routes on $name", (backend) => {
  let storage: TestStorage | null = null;
  afterEach(async () => {
    await storage?.close();
    storage = null;
  });

  const scoped = { scope: async () => ({ workspace: "team", workspaces: ["team"] }) };

  async function fill(store: SessionStore, count: number) {
    for (let index = 0; index < count; index++) {
      await store.save(newSession(`Debate ${index}`, new Date(Date.UTC(2026, 9, 1, 0, 0, index)).toISOString()), "ada", {
        workspace: "team",
      });
    }
  }

  interface Page {
    sessions: (SessionSummary & { mine?: boolean })[];
    shared?: boolean;
    next: string | null;
  }
  const get = async (app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> }, query: string, user = "ada") => {
    const response = await app.request(`/api/sessions${query}`, { headers: as(user) });
    return { status: response.status, body: (await response.json()) as Page & { error?: string } };
  };

  it("keeps the answer of today for a client that asks for nothing more: fifty, the latest first", async () => {
    const opened = await openApp(backend, hostedHooks(scoped));
    storage = opened.storage;
    await fill(opened.storage.store, 60);
    const { status, body } = await get(opened.app, "");
    expect(status).toBe(200);
    expect(body.sessions).toHaveLength(50);
    expect(body.sessions[0]?.idea).toBe("Debate 59");
    expect(body.shared).toBe(true);
    expect(body.next).toBeTruthy();
  });

  it("serves the next pages by cursor until the history ends, and searches the whole of it", async () => {
    const opened = await openApp(backend, hostedHooks(scoped));
    storage = opened.storage;
    await fill(opened.storage.store, 60);
    const first = await get(opened.app, "?limit=25");
    const second = await get(opened.app, `?limit=25&before=${first.body.next}`);
    const third = await get(opened.app, `?limit=25&before=${second.body.next}`);
    expect([first, second, third].map((page) => page.body.sessions.length)).toEqual([25, 25, 10]);
    expect(third.body.next).toBeNull();
    const ids = [first, second, third].flatMap((page) => page.body.sessions.map((item) => item.id));
    expect(new Set(ids).size).toBe(60);

    // The oldest debate is found though it is far beyond the first page.
    const found = await get(opened.app, "?q=debate%200");
    expect(found.body.sessions.map((item) => item.idea)).toEqual(["Debate 0"]);
    expect(found.body.next).toBeNull();
    expect((await get(opened.app, "?q=debate%201&limit=3")).body.sessions).toHaveLength(3);
    expect((await get(opened.app, "?q=debate%201&limit=3")).body.next).toBeTruthy();
    // Someone else's list is theirs: Bob is in the workspace, and has started none of them.
    expect((await get(opened.app, "?mine=1", "bob")).body.sessions).toEqual([]);
  });

  it("limits a page, and refuses a limit or a cursor it cannot use", async () => {
    const opened = await openApp(backend, hostedHooks(scoped));
    storage = opened.storage;
    await fill(opened.storage.store, 3);
    expect((await get(opened.app, "?limit=1")).body.sessions).toHaveLength(1);
    expect((await get(opened.app, "?limit=100")).status).toBe(200);
    for (const query of ["?limit=0", "?limit=101", "?limit=abc", "?limit=1.5", `?q=${"x".repeat(201)}`]) {
      expect((await get(opened.app, query)).status, query).toBe(400);
    }
    const bad = await get(opened.app, "?before=not-a-cursor");
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("invalid_cursor");
  });

  it("pages the sessions of a self-hosted server too", async () => {
    storage = await backend.open();
    const app = createApp({ store: storage.store, brandingStore: storage.brandingStore, bus: new EventBus(), env: {}, mockDelayMs: 0 });
    for (let index = 0; index < 5; index++) await storage.store.save(newSession(`Local ${index}`, day(index + 1)));
    const first = (await (await app.request("/api/sessions?limit=2")).json()) as Page;
    expect(first.shared).toBe(false);
    expect(first.sessions.map((item) => item.idea)).toEqual(["Local 4", "Local 3"]);
    const second = (await (await app.request(`/api/sessions?limit=2&before=${first.next}`)).json()) as Page;
    expect(second.sessions.map((item) => item.idea)).toEqual(["Local 2", "Local 1"]);
    const last = (await (await app.request(`/api/sessions?limit=2&before=${second.next}`)).json()) as Page;
    expect(last.sessions.map((item) => item.idea)).toEqual(["Local 0"]);
    expect(last.next).toBeNull();
  });

  it("pages the gallery by cursor", async () => {
    storage = await backend.open();
    const app = createApp({ store: storage.store, brandingStore: storage.brandingStore, bus: new EventBus(), env: {}, mockDelayMs: 0 });
    for (let index = 0; index < 3; index++) {
      const session = newSession(`Shown ${index}`, day(index + 1));
      session.phase = "complete";
      await storage.store.save(session);
      await storage.store.share(session.id, { public: true });
    }
    const first = (await (await app.request("/api/gallery?limit=2")).json()) as Page;
    expect(first.sessions.map((item) => item.idea)).toEqual(["Shown 2", "Shown 1"]);
    const second = (await (await app.request(`/api/gallery?limit=2&before=${first.next}`)).json()) as Page;
    expect(second.sessions.map((item) => item.idea)).toEqual(["Shown 0"]);
    expect(second.next).toBeNull();
    expect((await app.request("/api/gallery?before=zzz")).status).toBe(400);
  });

  it("goes on with a search the cap stopped: no match so far, and a cursor to continue from", async () => {
    const opened = await openApp(backend, hostedHooks(scoped));
    storage = opened.storage;
    await opened.storage.store.save(newSession("Zeppelin freight", day(1)), "ada", { workspace: "team" });
    await fill(opened.storage.store, 20);
    await withLimits({ chunk: 6, cap: 8 }, async () => {
      const seen: { count: number; next: boolean }[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 10; guard++) {
        const { status, body } = await get(opened.app, `?q=zeppelin${cursor ? `&before=${cursor}` : ""}`);
        expect(status).toBe(200);
        seen.push({ count: body.sessions.length, next: body.next !== null });
        cursor = body.next;
        if (!cursor) break;
      }
      // 21 rows, 8 examined per request: two requests find nothing and say so, the third finds it and ends.
      expect(seen).toEqual([
        { count: 0, next: true },
        { count: 0, next: true },
        { count: 1, next: false },
      ]);
    });
  });

  it("leaves the gallery without a search: a q is not read, so a public page cannot be made to scan", async () => {
    storage = await backend.open();
    const app = createApp({ store: storage.store, brandingStore: storage.brandingStore, bus: new EventBus(), env: {}, mockDelayMs: 0 });
    for (let index = 0; index < 2; index++) {
      const session = newSession(`Shown ${index}`, day(index + 1));
      session.phase = "complete";
      await storage.store.save(session);
      await storage.store.share(session.id, { public: true });
    }
    const answer = (await (await app.request("/api/gallery?q=nothing-like-it")).json()) as Page;
    expect(answer.sessions).toHaveLength(2);
  });

  it("lists every author of the register on its first page, whatever the page holds, and none on the next", async () => {
    const opened = await openApp(
      backend,
      hostedHooks({
        ...scoped,
        authors: async (owners) => Object.fromEntries(owners.map((id) => [id, { name: id.toUpperCase(), email: null }])),
      }),
    );
    storage = opened.storage;
    const original = await ruled(opened.app);
    // Ada's older decision is the oldest; four of Bob's, saved after, fill the first page.
    await opened.storage.store.save({ ...structuredClone(original), id: crypto.randomUUID(), updatedAt: day(1) }, "ada", {
      workspace: "team",
    });
    for (let index = 0; index < 4; index++) {
      await opened.storage.store.save(
        { ...structuredClone(original), id: crypto.randomUUID(), updatedAt: new Date(Date.now() + (index + 1) * 60_000).toISOString() },
        "bob",
        {
          workspace: "team",
        },
      );
    }
    type Register = {
      decisions: { author: { name: string | null } | null; mine: boolean }[];
      authors: { id: string; name: string | null }[];
      next: string | null;
    };
    const read = async (query: string) =>
      (await (await opened.app.request(`/api/decisions${query}`, { headers: as("ada") })).json()) as Register;
    const first = await read("?limit=2");
    expect(first.decisions.every((row) => !row.mine)).toBe(true);
    expect(first.authors.map((author) => author.id).sort()).toEqual(["ada", "bob"]);
    expect(first.decisions[0]?.author?.name).toBe("BOB");
    // The next page names the authors of its rows, and carries no list (the client keeps the first).
    const second = await read(`?limit=2&before=${first.next}`);
    expect(second.authors).toEqual([]);
    expect(second.decisions.length).toBeGreaterThan(0);
    expect(second.decisions.find((row) => !row.mine)?.author?.name).toBe("BOB");
    // An author filter does not shrink the list of authors to choose from.
    expect((await read("?limit=2&author=bob")).authors.map((author) => author.id).sort()).toEqual(["ada", "bob"]);
  });

  it("lists the register's authors from a distinct-owners query, not from rows that stop at a cap", async () => {
    storage = await backend.open();
    const store = storage.store;
    const ruledOnce = await (async () => {
      const opened = await openApp(backend, hostedHooks(scoped));
      const session = await ruled(opened.app);
      await opened.storage.close();
      return session;
    })();
    const copy = (updatedAt: string) => ({ ...structuredClone(ruledOnce), id: crypto.randomUUID(), updatedAt });
    await store.save(copy(day(1)), "ada", { workspace: "team" });
    await store.save(copy(day(2)), "bob", { workspace: "team" });
    await store.save(copy(day(3)), "bob", { workspace: "team" });
    // Carol's is private: not in the register Ada reads, so not among her authors.
    await store.save(copy(day(4)), "carol", { workspace: "team", private: true });
    await store.save(copy(day(5)), "dan", { workspace: "other" });
    const owners = async (owner: string) => ((await store.decisionOwners?.({ owner, workspace: "team" })) ?? []).sort();
    expect(await owners("ada")).toEqual(["ada", "bob"]);
    expect(await owners("carol")).toEqual(["ada", "bob", "carol"]);
    expect(await store.decisionOwners?.({ owner: "dan", workspace: "other" })).toEqual(["dan"]);

    // The route uses it: even a store whose `decisions` answers two rows only (a cap) lists every author.
    const capped = Object.create(store) as SessionStore;
    capped.decisions = async (query) => (await store.decisions(query)).slice(0, 2);
    const app = createApp({
      store: capped,
      brandingStore: storage.brandingStore,
      bus: new EventBus(),
      env: {},
      mockDelayMs: 0,
      hooks: hostedHooks(scoped),
    });
    const answer = (await (await app.request("/api/decisions?limit=1", { headers: as("ada") })).json()) as { authors: { id: string }[] };
    expect(answer.authors.map((author) => author.id).sort()).toEqual(["ada", "bob"]);
  });

  it("pages the decision register by cursor, and answers every decision to a client that asks for no page", async () => {
    const opened = await openApp(backend, hostedHooks(scoped));
    storage = opened.storage;
    const original = await ruled(opened.app);
    // Five more decisions that changed at the very same instant.
    for (let index = 0; index < 5; index++) {
      const copy: Session = { ...structuredClone(original), id: crypto.randomUUID() };
      await opened.storage.store.save(copy, "ada", { workspace: "team" });
    }
    type Register = { decisions: { sessionId: string }[]; next: string | null };
    const read = async (query: string) =>
      (await (await opened.app.request(`/api/decisions${query}`, { headers: as("ada") })).json()) as Register;
    const everything = await read("");
    expect(everything.decisions.length).toBe(6);
    expect(everything.next).toBeNull();
    const ids: string[] = [];
    let cursor: string | null = null;
    const sizes: number[] = [];
    for (let guard = 0; guard < 10; guard++) {
      const page: Register = await read(`?limit=4${cursor ? `&before=${cursor}` : ""}`);
      sizes.push(page.decisions.length);
      ids.push(...page.decisions.map((row) => row.sessionId));
      cursor = page.next;
      if (!cursor) break;
    }
    expect(sizes).toEqual([4, 2]);
    expect(new Set(ids).size).toBe(6);
    expect((await opened.app.request("/api/decisions?before=zzz", { headers: as("ada") })).status).toBe(400);
    expect((await opened.app.request("/api/decisions?limit=0", { headers: as("ada") })).status).toBe(400);
  });
});

describe("a host whose store knows nothing of cursors or search", () => {
  it("keeps working: it is asked for one entry more, and the app pages and filters what it gave", async () => {
    const [sqlite] = BACKENDS;
    if (!sqlite) throw new Error("No backend");
    const storage = await sqlite.open();
    try {
      const asked: unknown[][] = [];
      // The store of a host before this change: it reads the limit and the scope, never a third argument.
      const old = Object.create(storage.store) as SessionStore;
      // It does not say it pages.
      Object.defineProperty(old, "pages", { value: undefined });
      old.history = async (limit, scope) => {
        asked.push([limit, scope]);
        return storage.store.history(limit, scope);
      };
      const app = createApp({
        store: old,
        brandingStore: storage.brandingStore,
        bus: new EventBus(),
        env: {},
        mockDelayMs: 0,
        hooks: hostedHooks({ scope: async () => ({ workspace: "team", workspaces: ["team"] }) }),
      });
      for (let index = 0; index < 8; index++) {
        await storage.store.save(newSession(`Old host ${index}`, day(index + 1)), "ada", { workspace: "team" });
      }
      const read = async (query: string) =>
        (await (await app.request(`/api/sessions${query}`, { headers: as("ada") })).json()) as {
          sessions: SessionSummary[];
          next: string | null;
        };
      // What it always answered: the sessions, the latest first.
      const plain = await read("");
      expect(plain.sessions).toHaveLength(8);
      expect(plain.next).toBeNull();
      // A page of 3: asked for 4, answered 3 and a cursor.
      const first = await read("?limit=3");
      expect(first.sessions.map((item) => item.idea)).toEqual(["Old host 7", "Old host 6", "Old host 5"]);
      expect(first.next).toBeTruthy();
      expect(asked.at(-1)?.[0]).toBe(4);
      // The cursor it ignores is applied by the app, and so is the search. Such a store cannot go deeper than the entry
      // it was asked for beyond the page: what remains of those is all the next page holds, and it says nothing more.
      const second = await read(`?limit=3&before=${first.next}`);
      expect(second.sessions.map((item) => item.idea)).toEqual(["Old host 4"]);
      expect(second.next).toBeNull();
      expect((await read("?q=host%203")).sessions.map((item) => item.idea)).toEqual(["Old host 3"]);
    } finally {
      await storage.close();
    }
  });
});
