import { createSession, type Session } from "@quorumind/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AppHooks, type Author, createApp, type Scope, type SessionAccess } from "./app.ts";
import { EventBus } from "./bus.ts";
import { BACKENDS, type Backend, type TestStorage } from "./testing.ts";

let backend: Backend;
let storage: TestStorage | null = null;

async function makeApp(hooks?: AppHooks) {
  storage = await backend.open();
  return createApp({
    store: storage.store,
    brandingStore: storage.brandingStore,
    bus: new EventBus(),
    env: {},
    mockDelayMs: 0,
    ...(hooks ? { hooks } : {}),
  });
}

afterEach(async () => {
  await storage?.close();
  storage = null;
});

type App = Awaited<ReturnType<typeof makeApp>>;

const as = (user: string) => ({ "x-user": user });
const json = (body: unknown, user: string, method = "POST") => ({
  method,
  headers: { "Content-Type": "application/json", ...as(user) },
  body: JSON.stringify(body),
});

interface Summary {
  id: string;
  idea: string;
  mine: boolean;
  private: boolean;
  author?: Author | null;
}

async function history(app: App, user: string, query = "") {
  return (await (await app.request(`/api/sessions${query}`, { headers: as(user) })).json()) as { sessions: Summary[]; shared: boolean };
}

async function detail(app: App, id: string, user: string) {
  const response = await app.request(`/api/sessions/${id}`, { headers: as(user) });
  return { status: response.status, body: (await response.json()) as { session: Session; busy: boolean; access: SessionAccess } };
}

async function waitFor(app: App, id: string, user: string, done: (session: Session) => boolean) {
  for (let i = 0; i < 300; i++) {
    const { body } = await detail(app, id, user);
    if (!body.busy && done(body.session)) return body.session;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out");
}

async function create(app: App, user: string, body: Record<string, unknown> = {}) {
  const response = await app.request("/api/sessions", json({ locale: "en", demo: true, ...body }, user));
  expect(response.status).toBe(201);
  const { session } = (await response.json()) as { session: Session };
  await waitFor(app, session.id, user, (s) => s.interview.length === 1);
  return session;
}

/** Answers the interview, so the session reaches the requirements review. */
async function toReview(app: App, id: string, user: string) {
  const answered = await app.request(`/api/sessions/${id}/interview`, json({ answers: [{ question: "Budget?", answer: "15k" }] }, user));
  expect(answered.status).toBe(202);
  return waitFor(app, id, user, (s) => s.phase === "review");
}

/**
 * A team: Ada and Bob are members, Carol is its admin. Dan works in another workspace. Ada's name is forgotten when
 * `formerAda` is set, as after an account deletion.
 */
function teamHooks(options: { formerAda?: boolean; scopes?: Record<string, Scope> } = {}): AppHooks {
  const team: Scope = { workspace: "team", workspaces: ["team"] };
  const scopes: Record<string, Scope> = {
    ada: team,
    bob: team,
    carol: team,
    dan: { workspace: "other", workspaces: ["other"] },
    ...options.scopes,
  };
  const people: Record<string, Author> = {
    ada: { name: "Ada", email: "ada@example.com" },
    bob: { name: null, email: "bob@example.com" },
    carol: { name: "Carol", email: "carol@example.com" },
  };
  return {
    identify: async (request) => {
      const user = request.headers.get("x-user");
      return user ? { userId: user } : null;
    },
    scope: async (user) => scopes[user.userId] ?? { workspace: null, workspaces: [] },
    canEdit: async (user, session) => user.userId === "carol" && session.workspace === "team",
    authors: async (owners) =>
      Object.fromEntries(
        owners.flatMap((owner) => (people[owner] && !(owner === "ada" && options.formerAda) ? [[owner, people[owner]]] : [])),
      ),
  };
}

describe.each(BACKENDS)("on $name", (each) => {
  beforeEach(() => {
    backend = each;
  });

  describe("without workspaces", () => {
    it("keeps every session to its owner, who may do everything with it", async () => {
      const app = await makeApp();
      const session = await create(app, "anyone");
      const { body } = await detail(app, session.id, "anyone");
      expect(body.access).toEqual({ mine: true, canEdit: true, shared: false, private: false });
      const list = await history(app, "anyone");
      expect(list.shared).toBe(false);
      expect(list.sessions.map((item) => item.id)).toEqual([session.id]);
    });

    it("scopes sessions to their owner when the host identifies people but shares nothing", async () => {
      const { scope: _scope, canEdit: _canEdit, authors: _authors, ...identifyOnly } = teamHooks();
      const app = await makeApp(identifyOnly);
      const session = await create(app, "ada");
      expect((await detail(app, session.id, "bob")).status).toBe(404);
      expect((await history(app, "bob")).sessions).toEqual([]);
      expect((await history(app, "ada")).shared).toBe(false);
    });
  });

  describe("with workspaces", () => {
    it("lists the workspace's sessions with their author, and lets every member read them", async () => {
      const app = await makeApp(teamHooks());
      const adas = await create(app, "ada");
      const bobs = await create(app, "bob");

      const seenByBob = await history(app, "bob");
      expect(seenByBob.shared).toBe(true);
      expect(seenByBob.sessions.map(({ id, mine, private: isPrivate, author }) => ({ id, mine, private: isPrivate, author }))).toEqual([
        { id: bobs.id, mine: true, private: false, author: undefined },
        { id: adas.id, mine: false, private: false, author: { name: "Ada", email: "ada@example.com" } },
      ]);
      expect((await history(app, "bob", "?mine=1")).sessions.map((item) => item.id)).toEqual([bobs.id]);
      expect((await history(app, "dan")).sessions).toEqual([]);

      const read = await detail(app, adas.id, "bob");
      expect(read.status).toBe(200);
      expect(read.body.access).toEqual({
        mine: false,
        canEdit: false,
        shared: true,
        private: false,
        author: { name: "Ada", email: "ada@example.com" },
      });
      expect((await detail(app, adas.id, "ada")).body.access).toEqual({ mine: true, canEdit: true, shared: true, private: false });
      expect((await app.request(`/api/sessions/${adas.id}/report.md`, { headers: as("bob") })).status).toBe(200);
      expect((await app.request(`/api/sessions/${adas.id}/report.html`, { headers: as("bob") })).status).toBe(200);
      expect((await detail(app, adas.id, "dan")).status).toBe(404);
      expect((await app.request(`/api/sessions/${adas.id}/report.md`, { headers: as("dan") })).status).toBe(404);
    });

    it("lets the author and the workspace's admins change a session, the other members only fork it", async () => {
      const app = await makeApp(teamHooks());
      const session = await create(app, "ada");
      const answers = { answers: [{ question: "Budget?", answer: "15k" }] };

      const refused = await app.request(`/api/sessions/${session.id}/interview`, json(answers, "bob"));
      expect(refused.status).toBe(403);
      expect(((await refused.json()) as { error: string }).error).toBe("read_only");
      expect((await app.request(`/api/sessions/${session.id}/share`, json({ public: false }, "bob"))).status).toBe(403);
      expect((await app.request(`/api/sessions/${session.id}`, { method: "DELETE", headers: as("bob") })).status).toBe(403);
      expect((await app.request(`/api/sessions/${session.id}/resume`, json({}, "bob"))).status).toBe(403);
      expect((await app.request(`/api/sessions/${session.id}/interview`, json(answers, "dan"))).status).toBe(404);

      // The admin answers for the team; the author confirms.
      expect((await detail(app, session.id, "carol")).body.access.canEdit).toBe(true);
      const review = await toReview(app, session.id, "carol");
      expect((await app.request(`/api/sessions/${session.id}/sheet`, json({ sheet: review.sheet }, "bob", "PUT"))).status).toBe(403);

      const forked = await app.request(`/api/sessions/${session.id}/fork`, json({}, "bob"));
      expect(forked.status).toBe(201);
      const copy = ((await forked.json()) as { session: Session }).session;
      expect(copy.parentId).toBe(session.id);
      expect((await detail(app, copy.id, "bob")).body.access).toMatchObject({ mine: true, canEdit: true, shared: true });
      expect((await detail(app, copy.id, "ada")).body.access).toMatchObject({ mine: false, canEdit: false });

      const shared = await app.request(`/api/sessions/${session.id}/share`, json({ public: false }, "carol"));
      expect(shared.status).toBe(200);
      expect((await app.request(`/api/sessions/${session.id}`, { method: "DELETE", headers: as("carol") })).status).toBe(204);
      expect((await detail(app, session.id, "ada")).status).toBe(404);
    });

    it("hides a private session from everyone but its author, admins included", async () => {
      const app = await makeApp(teamHooks());
      const session = await create(app, "ada");
      const hidden = await create(app, "ada", { private: true });
      expect((await detail(app, hidden.id, "ada")).body.access).toMatchObject({ mine: true, private: true });
      expect((await detail(app, hidden.id, "carol")).status).toBe(404);

      // Only the author decides who sees a session.
      expect((await app.request(`/api/sessions/${session.id}/visibility`, json({ private: true }, "carol", "PUT"))).status).toBe(403);
      const changed = await app.request(`/api/sessions/${session.id}/visibility`, json({ private: true }, "ada", "PUT"));
      expect(changed.status).toBe(200);
      expect(((await changed.json()) as { access: SessionAccess }).access.private).toBe(true);
      for (const member of ["bob", "carol"]) {
        expect((await detail(app, session.id, member)).status).toBe(404);
        expect((await history(app, member)).sessions).toEqual([]);
      }
      expect((await history(app, "ada")).sessions.map((item) => [item.id, item.private])).toEqual([
        [hidden.id, true],
        [session.id, true],
      ]);

      await app.request(`/api/sessions/${session.id}/visibility`, json({ private: false }, "ada", "PUT"));
      expect((await detail(app, session.id, "bob")).status).toBe(200);
      // A copy of a private session stays private.
      await toReview(app, hidden.id, "ada");
      const forked = await app.request(`/api/sessions/${hidden.id}/fork`, json({}, "ada"));
      const copy = ((await forked.json()) as { session: Session }).session;
      expect((await detail(app, copy.id, "bob")).status).toBe(404);
    });

    it("keeps a session in its workspace: a former member no longer sees it, and shows as such to the others", async () => {
      const app = await makeApp(teamHooks({ formerAda: true, scopes: { ada: { workspace: null, workspaces: [] } } }));
      // A session Ada started when she was a member, and one she starts now, outside any workspace.
      const mock = { provider: "mock" as const, model: "mock" };
      const kept = createSession({ locale: "en", idea: "Kept", demo: true, interviewer: mock, arbiter: mock, seats: { A: mock, B: mock } });
      await storage?.store.save(kept, "ada", { workspace: "team" });
      const before = await create(app, "ada");

      expect((await detail(app, kept.id, "ada")).status).toBe(404);
      expect((await history(app, "ada")).sessions.map((item) => item.id)).toEqual([before.id]);
      expect((await history(app, "bob")).sessions.find((item) => item.id === kept.id)?.author).toBeNull();
      expect((await detail(app, kept.id, "bob")).body.access.author).toBeNull();
      // Still the author's in their data export.
      const exported = (await (await app.request("/api/export", { headers: as("ada") })).json()) as { sessions: { id: string }[] };
      expect(exported.sessions.map((item) => item.id).sort()).toEqual([before.id, kept.id].sort());
    });

    it("lets members read a rewritten verdict, and only those who may change the session write one", async () => {
      const app = await makeApp(teamHooks());
      const session = await create(app, "ada");
      const review = await toReview(app, session.id, "ada");
      await app.request(`/api/sessions/${session.id}/sheet`, json({ sheet: review.sheet }, "ada", "PUT"));
      await waitFor(app, session.id, "ada", (s) => s.phase === "awaiting_answers");
      await app.request(`/api/sessions/${session.id}/answers`, json({ answers: [{ question: "Hosted?", answer: "Yes" }] }, "ada"));
      await waitFor(app, session.id, "ada", (s) => s.phase === "complete");

      expect((await app.request(`/api/sessions/${session.id}/brief`, json({ audience: "executive" }, "bob"))).status).toBe(403);
      expect((await app.request(`/api/sessions/${session.id}/brief`, json({ audience: "executive" }, "ada"))).status).toBe(200);
      const cached = await app.request(`/api/sessions/${session.id}/brief`, json({ audience: "executive" }, "bob"));
      expect(cached.status).toBe(200);
      expect((await app.request(`/api/sessions/${session.id}/feedback`, json({ helpful: true }, "bob"))).status).toBe(201);
    });
  });
});
