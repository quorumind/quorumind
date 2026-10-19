import type { RegisterEntry, Session } from "@quorumind/core";
import { afterEach, describe, expect, it } from "vitest";
import { type AppHooks, type Author, createApp, type Purchase, type RevisionEvent, type Scope } from "./app.ts";
import { EventBus } from "./bus.ts";
import type { ChatNotifier } from "./chat.ts";
import type { DecisionView } from "./decisions.ts";
import type { Notifier, NotifyReason } from "./notifier.ts";
import type { SessionStore } from "./store.ts";
import { BACKENDS, type Backend, type TestStorage } from "./testing.ts";
import { as, detail, hostedHooks, ruled, send, waitFor } from "./testing-app.ts";

let storage: TestStorage | null = null;

afterEach(async () => {
  await storage?.close();
  storage = null;
});

interface Sent {
  sessionId: string;
  reason: NotifyReason;
  to: string | null;
}

/** An app on the demo model with a notifier and a chat channel that record what they send. */
async function makeApp(backend: Backend, hooks: AppHooks, store?: (storage: TestStorage) => SessionStore) {
  storage = await backend.open();
  const mails: Sent[] = [];
  const posts: Sent[] = [];
  /** The recipients whose e-mail fails ("chat" for the channel). */
  const failing = new Set<string>();
  const notifier: Notifier = {
    notify: async (session, reason, to) => {
      if (failing.has(to ?? "")) throw new Error("The mail server refused it.");
      mails.push({ sessionId: session.id, reason, to });
    },
  };
  const chat: ChatNotifier = {
    notify: async (session, reason) => {
      if (failing.has("chat")) throw new Error("The webhook is down.");
      posts.push({ sessionId: session.id, reason, to: null });
    },
  };
  const app = createApp({
    store: store ? store(storage) : storage.store,
    brandingStore: storage.brandingStore,
    bus: new EventBus(),
    env: {},
    mockDelayMs: 0,
    hooks,
    notifier,
    chat,
    publicUrl: "https://decide.example",
  });
  return { app, mails, posts, failing, notifier, chat };
}

type App = Awaited<ReturnType<typeof makeApp>>["app"];

/** A team: Ada and Carol are members, Bob is its admin; Dan works elsewhere. */
function teamHooks(extra: AppHooks = {}): AppHooks {
  const team: Scope = { workspace: "team", workspaces: ["team"] };
  const scopes: Record<string, Scope> = { ada: team, bob: team, carol: team, dan: { workspace: "other", workspaces: ["other"] } };
  const people: Record<string, Author> = {
    ada: { name: "Ada", email: "ada@example.com" },
    bob: { name: "Bob Admin", email: "bob@example.com" },
    carol: { name: null, email: "carol@example.com" },
  };
  return hostedHooks({
    scope: async (user) => scopes[user.userId] ?? { workspace: null, workspaces: [] },
    canEdit: async (user, session) => user.userId === "bob" && session.workspace === "team",
    authors: async (owners) => Object.fromEntries(owners.flatMap((owner) => (people[owner] ? [[owner, people[owner]]] : []))),
    notifyRecipient: async (user) => people[user.userId]?.email ?? null,
    ...extra,
  });
}

const scenario = {
  title: "Budget cut",
  question: "What if the client cuts the build budget?",
  changes: [
    { kind: "budget", target: "build", percent: -30 },
    { kind: "team", delta: 2 },
  ],
};

async function list(app: App, user: string, query = "") {
  const response = await app.request(`/api/decisions${query}`, { headers: as(user) });
  return (await response.json()) as { decisions: DecisionView[]; authors: (Author & { id: string })[]; shared: boolean };
}

async function act(app: App, id: string, action: string, user: string, body: Record<string, unknown> = {}) {
  const response = await app.request(`/api/sessions/${id}/decision/${action}`, send(body, user));
  return { status: response.status, body: (await response.json()) as { decision: RegisterEntry; error?: string } };
}

describe.each(BACKENDS)("on $name", (backend) => {
  describe("what if scenarios", () => {
    it("are revisions of their own, at the revision's price, branching beside the verdict", async () => {
      const purchases: Purchase[] = [];
      const events: RevisionEvent[] = [];
      const { app } = await makeApp(
        backend,
        hostedHooks({
          authorizeSpend: async (_user, _session, _estimate, purchase) => {
            purchases.push(purchase ?? { kind: "debate" });
            return { ok: true };
          },
          onRevision: (_user, _session, event) => {
            events.push(event);
          },
          quote: async (_user, _settings, _id, item) => ({ amount: item === "revision" ? 1 : 7, currency: "EUR", label: item ?? "debate" }),
        }),
      );
      const session = await ruled(app);
      expect((await detail(app, session.id)).revisionPrice).toEqual({ amount: 1, currency: "EUR", label: "revision" });

      const accepted = await app.request(`/api/sessions/${session.id}/scenarios`, send(scenario));
      expect(accepted.status).toBe(202);
      expect(await accepted.json()).toEqual({ accepted: true, revision: 2 });
      const made = await waitFor(app, session.id, (s) => s.revisions.length === 2 && !s.revising);
      expect(made.revisions[1]).toMatchObject({ number: 2, reason: "scenario", basedOn: 1, by: "ada", scenario: { title: "Budget cut" } });
      expect(purchases.at(-1)).toEqual({ kind: "revision", number: 2 });
      expect(events.map((event) => [event.number, event.reason, event.status])).toEqual([
        [2, "scenario", "started"],
        [2, "scenario", "completed"],
      ]);
      // The verdict shown stays the debate's until the scenario is adopted.
      expect(made.verdict).toEqual(made.revisions[0]?.verdict);
      expect((await detail(app, session.id)) as unknown).toMatchObject({ checks: { A: { build: { budget: 15_000 } } } });

      const listed = (await (await app.request(`/api/sessions/${session.id}/scenarios`, { headers: as("ada") })).json()) as {
        scenarios: { number: number; title: string; adopted: boolean }[];
      };
      expect(listed.scenarios).toMatchObject([{ number: 2, title: "Budget cut", adopted: false }]);

      // Side by side, with what differs; in Markdown and on a printable page.
      const compared = (await (await app.request(`/api/sessions/${session.id}/compare?a=1&b=2`, { headers: as("ada") })).json()) as {
        comparison: { diff: { requirements: { build: boolean }; count: number } };
      };
      expect(compared.comparison.diff.requirements.build).toBe(true);
      expect((await app.request(`/api/sessions/${session.id}/compare?a=1&b=5`, { headers: as("ada") })).status).toBe(404);
      const markdown = await app.request(`/api/sessions/${session.id}/compare.md?a=1&b=2`, { headers: as("ada") });
      expect(markdown.headers.get("content-disposition")).toContain("-comparison-1-2.md");
      expect(await markdown.text()).toContain("| Build budget | **€15,000** | **€10,500** |");
      const page = await app.request(`/api/sessions/${session.id}/compare.html?a=1&b=2&print=1`, { headers: as("ada") });
      expect(page.headers.get("content-security-policy")).toContain("script-src 'sha256-");
      expect(await page.text()).toContain('class="differs"');
      expect((await app.request(`/api/sessions/${session.id}/compare.md?a=x&b=2`, { headers: as("ada") })).status).toBe(400);

      // Adopted, it is the decision: its numbers in the checks and the report.
      const adopted = await app.request(`/api/sessions/${session.id}/adopted`, send({ revision: 2 }, "ada", "PUT"));
      expect(await adopted.json()).toMatchObject({ adopted: 2, decision: { revision: { number: 2, scenario: "Budget cut" } } });
      expect((await detail(app, session.id)) as unknown).toMatchObject({ checks: { A: { build: { budget: 10_500 } } } });
      const report = await (await app.request(`/api/sessions/${session.id}/report.md`, { headers: as("ada") })).text();
      expect(report).toContain("Build budget: €10,500");
      expect(report).toContain("## What changed since revision 1");
      expect(report).toContain("- Build budget -30%");
      const notScenario = await app.request(`/api/sessions/${session.id}/adopted`, send({ revision: 1 }, "ada", "PUT"));
      expect(await notScenario.json()).toMatchObject({ error: "not_a_scenario" });
      await app.request(`/api/sessions/${session.id}/adopted`, send({ revision: null }, "ada", "PUT"));
      expect((await detail(app, session.id)).session.adopted).toBeNull();
    });

    it("need a change or a question, valid values, and the right to change the session", async () => {
      const { app } = await makeApp(backend, teamHooks());
      const session = await ruled(app);
      const empty = await app.request(`/api/sessions/${session.id}/scenarios`, send({ title: "Nothing", changes: [] }));
      expect(await empty.json()).toMatchObject({ error: "no_changes" });
      const wrong = await app.request(
        `/api/sessions/${session.id}/scenarios`,
        send({ title: "Too much", changes: [{ kind: "budget", target: "build", percent: -150 }] }),
      );
      expect(wrong.status).toBe(400);
      const zero = await app.request(
        `/api/sessions/${session.id}/scenarios`,
        send({ title: "Zero", changes: [{ kind: "team", delta: 0 }] }),
      );
      expect(zero.status).toBe(400);
      const nowhere = await app.request(`/api/sessions/${session.id}/scenarios`, send({ ...scenario, basedOn: 7 }));
      expect(await nowhere.json()).toMatchObject({ error: "no_such_revision" });
      // Carol may read Ada's session, not try scenarios on it; Dan does not even see it.
      expect((await app.request(`/api/sessions/${session.id}/scenarios`, send(scenario, "carol"))).status).toBe(403);
      expect((await app.request(`/api/sessions/${session.id}/scenarios`, send(scenario, "dan"))).status).toBe(404);
      expect((await app.request(`/api/sessions/${session.id}/compare?a=1&b=1`, { headers: as("carol") })).status).toBe(200);
    });
  });

  describe("the decision register", () => {
    it("records who asked and who approved, as the workspace's roles allow", async () => {
      const { app, mails, posts } = await makeApp(backend, teamHooks());
      const session = await ruled(app);
      expect((await list(app, "carol")).decisions).toMatchObject([
        { sessionId: session.id, status: "proposed", author: { name: "Ada" }, mine: false, canEdit: false },
      ]);
      expect((await list(app, "ada")).decisions[0]).toMatchObject({ mine: true, canEdit: true, author: null });
      expect((await list(app, "bob")).decisions[0]).toMatchObject({ canEdit: true });
      expect((await list(app, "dan")).decisions).toEqual([]);

      // Carol may only ask; the request reaches the channel, and Ada by e-mail.
      expect((await act(app, session.id, "approve", "carol")).status).toBe(403);
      const asked = await act(app, session.id, "request", "carol", { comment: "For Monday's committee" });
      expect(asked.body.decision.request).toMatchObject({ by: "carol", name: "carol@example.com", comment: "For Monday's committee" });
      expect(posts).toContainEqual({ sessionId: session.id, reason: "approval_requested", to: null });
      expect(mails).toContainEqual({ sessionId: session.id, reason: "approval_requested", to: "ada@example.com" });

      // Bob, the admin, approves: the name comes from the host, not from the request.
      const approved = await act(app, session.id, "approve", "bob", { comment: "Go", name: "Someone else" });
      expect(approved.status).toBe(200);
      expect(approved.body.decision).toMatchObject({
        status: "approved",
        approval: { by: "bob", name: "Bob Admin", comment: "Go", revision: 1 },
      });
      expect((await act(app, session.id, "approve", "ada")).body).toMatchObject({ error: "already_approved" });
      const adr = await (await app.request(`/api/sessions/${session.id}/adr.md`, { headers: as("carol") })).text();
      expect(adr).toMatch(/- \*\*Status:\*\* Accepted, approved by Bob Admin on \w+ \d+, \d{4}/);
      expect(await (await app.request(`/api/sessions/${session.id}/report.md`, { headers: as("carol") })).text()).toContain("## Decision");

      // The note and the review: for those who may change it.
      const details = { note: "Pilot first.", review: { on: "2026-11-02", when: "the SMS price doubles" } };
      expect((await app.request(`/api/sessions/${session.id}/decision`, send(details, "carol", "PUT"))).status).toBe(403);
      const noted = await app.request(`/api/sessions/${session.id}/decision`, send(details, "ada", "PUT"));
      expect(((await noted.json()) as { decision: RegisterEntry }).decision).toMatchObject({
        note: "Pilot first.",
        review: details.review,
      });
      const badDate = await app.request(`/api/sessions/${session.id}/decision`, send({ review: { on: "next week" } }, "ada", "PUT"));
      expect(badDate.status).toBe(400);

      // Filters: status, author, the day of the verdict.
      const today = new Date().toISOString().slice(0, 10);
      expect((await list(app, "carol", "?status=approved")).decisions).toHaveLength(1);
      expect((await list(app, "carol", "?status=rejected")).decisions).toEqual([]);
      expect((await list(app, "carol", "?author=ada")).decisions).toHaveLength(1);
      expect((await list(app, "carol", "?author=me")).decisions).toEqual([]);
      expect((await list(app, "carol", `?from=${today}&to=${today}`)).decisions).toHaveLength(1);
      expect((await list(app, "carol", "?to=2000-01-01")).decisions).toEqual([]);
      const filtered = await list(app, "carol", "?author=me");
      expect(filtered.authors).toEqual([{ id: "ada", name: "Ada", email: "ada@example.com" }]);
      expect(filtered.shared).toBe(true);
      expect((await app.request("/api/decisions?status=lost", { headers: as("carol") })).status).toBe(400);

      // The CSV, in the language asked for, with links to the sessions.
      const csv = await app.request("/api/decisions.csv?lang=fr", { headers: as("carol") });
      expect(csv.headers.get("content-type")).toContain("text/csv");
      const text = await csv.text();
      expect(text.split("\r\n")[0]?.startsWith('"Décision","Recommandation","Statut"')).toBe(true);
      expect(text).toContain(`"https://decide.example/#/s/${session.id}"`);
      expect(text).toContain('"Accepté"');
      expect(text).toContain('"Bob Admin","');

      // Rejected, then reopened; a private session stays out of the others' register.
      expect((await act(app, session.id, "reject", "bob", { comment: "Too risky" })).body.decision.status).toBe("rejected");
      expect((await act(app, session.id, "reject", "bob")).body).toMatchObject({ error: "closed" });
      expect((await act(app, session.id, "reopen", "ada")).body.decision.status).toBe("proposed");
      await app.request(`/api/sessions/${session.id}/visibility`, send({ private: true }, "ada", "PUT"));
      expect((await list(app, "carol")).decisions).toEqual([]);
      expect((await list(app, "ada")).decisions).toHaveLength(1);
    });

    it("goes back to proposed when a new revision is made, and links the decision that supersedes it", async () => {
      const { app } = await makeApp(backend, teamHooks());
      const first = await ruled(app);
      await act(app, first.id, "approve", "ada");
      await app.request(`/api/sessions/${first.id}/revisions`, send({ facts: [], note: "The launch moves to October." }));
      await waitFor(app, first.id, (s) => s.revisions.length === 2 && !s.revising);
      expect((await list(app, "ada")).decisions[0]).toMatchObject({ status: "proposed", previousApproval: { revision: 1, name: "Ada" } });

      // A session started again from it replaces it once approved.
      const forked = await app.request(`/api/sessions/${first.id}/fork`, send({}));
      const { session: second } = (await forked.json()) as { session: Session };
      await app.request(`/api/sessions/${second.id}/sheet`, send({ sheet: second.sheet }, "ada", "PUT"));
      await waitFor(app, second.id, (s) => s.phase === "awaiting_answers");
      await app.request(`/api/sessions/${second.id}/answers`, send({ answers: [{ question: "Hosted?", answer: "Yes" }] }));
      await waitFor(app, second.id, (s) => s.phase === "complete");
      await act(app, second.id, "approve", "ada");
      const rows = (await list(app, "ada")).decisions;
      expect(rows.find((row) => row.sessionId === first.id)).toMatchObject({ status: "superseded", supersededBy: second.id });
      expect(rows.find((row) => row.sessionId === second.id)).toMatchObject({ status: "approved", revisits: first.id });
      const adr = await (await app.request(`/api/sessions/${first.id}/adr.md`, { headers: as("ada") })).text();
      expect(adr).toContain("- **Status:** Superseded, superseded by “Studio booking app”");

      // By hand, to another decision the caller can read, never to itself.
      await act(app, second.id, "reopen", "ada");
      expect((await act(app, second.id, "supersede", "ada", { by: second.id })).body).toMatchObject({ error: "self_superseding" });
      expect((await act(app, second.id, "supersede", "ada", { by: "nowhere" })).status).toBe(404);
      expect((await act(app, second.id, "supersede", "ada", { by: first.id })).body.decision).toMatchObject({ status: "superseded" });
    });

    it("records the name typed on a self-hosted server, and refuses before the verdict", async () => {
      const { app } = await makeApp(backend, {});
      const created = await app.request("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: "en", demo: true }),
      });
      const { session } = (await created.json()) as { session: Session };
      const early = await app.request(`/api/sessions/${session.id}/decision/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Ada" }),
      });
      expect(await early.json()).toMatchObject({ error: "no_verdict" });
      expect(((await (await app.request("/api/decisions")).json()) as { decisions: unknown[] }).decisions).toEqual([]);
    });
  });

  describe("review reminders", () => {
    it("are sent once, on the review date, to the author and the approver, and in the channel", async () => {
      const { app, mails, posts } = await makeApp(backend, teamHooks());
      const session = await ruled(app);
      await act(app, session.id, "approve", "bob");
      await app.request(`/api/sessions/${session.id}/decision`, send({ review: { on: "2026-11-02", when: null } }, "ada", "PUT"));
      mails.length = 0;
      posts.length = 0;

      expect(await app.sendReminders(new Date("2026-11-01T23:59:00Z"))).toBe(0);
      expect(await app.sendReminders(new Date("2026-11-02T06:00:00Z"))).toBe(1);
      expect(mails).toEqual([
        { sessionId: session.id, reason: "review_due", to: "ada@example.com" },
        { sessionId: session.id, reason: "review_due", to: "bob@example.com" },
      ]);
      expect(posts).toEqual([{ sessionId: session.id, reason: "review_due", to: null }]);
      // Once per date, even later, and after a restart.
      expect(await app.sendReminders(new Date("2026-11-20T06:00:00Z"))).toBe(0);
      expect(storage?.reopen()).toBeTruthy();
      expect((await detail(app, session.id)).session.decision?.review.remindedFor).toBe("2026-11-02");

      // A new date gets its own reminder; a closed decision none.
      await app.request(`/api/sessions/${session.id}/decision`, send({ review: { on: "2026-12-01", when: null } }, "ada", "PUT"));
      await act(app, session.id, "reject", "bob");
      expect(await app.sendReminders(new Date("2026-12-02T06:00:00Z"))).toBe(0);
      await act(app, session.id, "reopen", "bob");
      expect(await app.sendReminders(new Date("2026-12-02T06:00:00Z"))).toBe(1);
      expect(await await storage!.reopen().dueReviews("2026-12-31")).toEqual([]);
    });

    /** A session approved by Bob, whose review comes on 2 November. */
    const due = async (app: App) => {
      const session = await ruled(app);
      await act(app, session.id, "approve", "bob");
      await app.request(`/api/sessions/${session.id}/decision`, send({ review: { on: "2026-11-02", when: null } }, "ada", "PUT"));
      return session;
    };
    const day = new Date("2026-11-02T06:00:00Z");

    it("are not sent again when one of their messages failed, and tried again when all did", async () => {
      const { app, mails, posts, failing } = await makeApp(backend, teamHooks());
      await due(app);
      mails.length = 0;
      posts.length = 0;
      failing.add("bob@example.com");
      expect(await app.sendReminders(day)).toBe(1);
      expect(mails.map((mail) => mail.to)).toEqual(["ada@example.com"]);
      failing.clear();
      expect(await app.sendReminders(day)).toBe(0);
      expect(mails).toHaveLength(1);
      expect(posts).toHaveLength(1);

      const other = await makeApp(backend, teamHooks());
      await due(other.app);
      other.mails.length = 0;
      for (const name of ["chat", "ada@example.com", "bob@example.com"]) other.failing.add(name);
      expect(await other.app.sendReminders(day)).toBe(0);
      other.failing.clear();
      expect(await other.app.sendReminders(day)).toBe(1);
      expect(other.mails.map((mail) => mail.to)).toEqual(["ada@example.com", "bob@example.com"]);
    });

    it("are sent once by runs at the same moment, in one process or two", async () => {
      const { app, mails, posts, notifier, chat } = await makeApp(backend, teamHooks());
      await due(app);
      mails.length = 0;
      posts.length = 0;
      // A second process on the same database, with nothing in memory.
      const second = createApp({
        store: storage?.reopen() as SessionStore,
        bus: new EventBus(),
        env: {},
        mockDelayMs: 0,
        hooks: teamHooks(),
        notifier,
        chat,
      });
      const counts = await Promise.all([app.sendReminders(day), app.sendReminders(day), second.sendReminders(day)]);
      expect(counts.reduce((sum, count) => sum + count, 0)).toBe(1);
      expect(mails).toHaveLength(2);
      expect(posts).toHaveLength(1);
    });

    it("never fall back to the server's default address for a signed-in user without one", async () => {
      const { app, mails } = await makeApp(backend, teamHooks({ notifyRecipient: async () => null }));
      const created = await app.request("/api/sessions", send({ locale: "en", idea: "Online booking", notify: true }, "dan"));
      const id = ((await created.json()) as { session: Session }).session.id;
      await waitFor(app, id, (s) => s.interview.length === 1, "dan");
      await app.request(`/api/sessions/${id}/interview`, send({ answers: [{ question: "Budget?", answer: "€15,000" }] }, "dan"));
      const review = await waitFor(app, id, (s) => s.phase === "review", "dan");
      await app.request(`/api/sessions/${id}/sheet`, send({ sheet: review.sheet }, "dan", "PUT"));
      await waitFor(app, id, (s) => s.phase === "awaiting_answers", "dan");
      await app.request(`/api/sessions/${id}/answers`, send({ answers: [{ question: "Hosted?", answer: "Yes" }] }, "dan"));
      const session = await waitFor(app, id, (s) => s.phase === "complete", "dan");
      expect(session.notify).toBe(true);
      await app.request(`/api/sessions/${session.id}/decision`, send({ review: { on: "2026-11-02", when: null } }, "dan", "PUT"));
      await app.sendReminders(day);
      expect(mails.filter((mail) => mail.to === null)).toEqual([]);
    });

    it("go on with the others when one cannot be saved", async () => {
      let broken = "";
      const { app, mails } = await makeApp(backend, teamHooks(), (opened) => {
        const store = Object.create(opened.store) as SessionStore;
        store.save = (session, ...rest) =>
          session.id === broken ? Promise.reject(new Error("Disk full.")) : opened.store.save(session, ...rest);
        return store;
      });
      const first = await due(app);
      const second = await due(app);
      mails.length = 0;
      broken = first.id;
      expect(await app.sendReminders(day)).toBe(1);
      expect(new Set(mails.map((mail) => mail.sessionId))).toEqual(new Set([first.id, second.id]));
    });
  });
});
