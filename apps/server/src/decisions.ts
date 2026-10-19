import {
  adoptScenario,
  approveDecision,
  compareRevisions,
  DECISION_LIMITS,
  DECISION_STATUSES,
  type DecisionActor,
  DecisionError,
  decisionStatus,
  InvalidStateError,
  isLocale,
  type Locale,
  type PendingRevision,
  type RegisterEntry,
  type RevisionRequest,
  type RevisionScenario,
  registerEntry,
  rejectDecision,
  renderRegisterCsv,
  reopenDecision,
  requestApproval,
  reviewDue,
  SCENARIO_LIMITS,
  type Session,
  scenariosOf,
  setDecisionDetails,
  supersedeDecision,
} from "@quorumind/core";
import { type Context, Hono } from "hono";
import { z } from "zod";
import type { AppHooks, Author, SessionAccess, User } from "./app.ts";
import type { ChatNotifier } from "./chat.ts";
import type { Notifier } from "./notifier.ts";
import type { DecisionQuery, Placement, SessionStore, StoredDecision, StoredSession } from "./store.ts";

// "What if" scenarios, the comparison of two versions and the decision register. A scenario is a revision of the
// verdict (the same machinery, the same price) made beside the others; one of them can be adopted as the decision.
// The register lists the decisions the caller may read, as the history does: approving one takes the right to change
// its session, asking for an approval only the right to read it. Each review date sends one reminder when it comes.

type Env = { Variables: { user: User | null } };

export interface DecisionDeps {
  store: SessionStore;
  hooks: AppHooks;
  /** A session the caller may read, with what they may do with it, or a 404. */
  access(id: string, user: User | null): Promise<StoredSession & { access: SessionAccess }>;
  /** A session the caller may change, or a 403/404. */
  editable(id: string, user: User | null): Promise<StoredSession>;
  /** Refuses an action while the session works. */
  startAction(session: Session): void;
  /** Starts a revision of the verdict (a scenario here) for the caller, as the other revisions are. */
  revise(session: Session, request: Omit<RevisionRequest, "by">): Promise<PendingRevision>;
  /** Tells the views of a session that it changed. */
  publish(session: Session): void;
  ownerOf(user: User | null): string | null;
  /** The workspace scope of the hosted version; null outside it. */
  scopeOf(user: User | null): Promise<{ workspace: string | null } | null>;
  notifier: Notifier | null;
  chat: ChatNotifier | null;
  /** The address of the interface, for the links of the CSV export; the request's origin otherwise. */
  publicUrl: string | null;
}

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .default(null)
    .transform((value) => value || null);

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date is written YYYY-MM-DD.");

const nonZero = (value: number) => value !== 0;

const ChangeInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("team"), delta: z.number().int().min(-SCENARIO_LIMITS.team).max(SCENARIO_LIMITS.team).refine(nonZero) }),
  z.object({
    kind: z.literal("budget"),
    target: z.enum(["build", "run"]),
    percent: z.number().min(SCENARIO_LIMITS.minPercent).max(SCENARIO_LIMITS.maxPercent).refine(nonZero),
  }),
  z.object({
    kind: z.literal("deadline"),
    delta: z.number().int().min(-SCENARIO_LIMITS.deadline).max(SCENARIO_LIMITS.deadline).refine(nonZero),
    unit: z.enum(["week", "month"]),
  }),
  z.object({ kind: z.literal("constraint"), text: z.string().trim().min(1).max(SCENARIO_LIMITS.constraint) }),
]);

const ScenarioInput = z.object({
  title: z.string().trim().min(1).max(SCENARIO_LIMITS.title),
  question: text(SCENARIO_LIMITS.question),
  changes: z.array(ChangeInput).max(SCENARIO_LIMITS.changes).default([]),
  /** The revision to branch from; the current one by default. */
  basedOn: z.number().int().min(1).optional(),
});

const ActionInput = z.object({
  comment: text(DECISION_LIMITS.comment),
  /** The name to record on a self-hosted server, where the host names nobody. */
  name: text(DECISION_LIMITS.name),
});

const DetailsInput = z.object({
  note: text(DECISION_LIMITS.note).optional(),
  review: z.object({ on: Day.nullable().default(null), when: text(DECISION_LIMITS.when) }).optional(),
});

const ListInput = z.object({
  status: z.enum(DECISION_STATUSES).optional(),
  /** An author's user id, or "me". */
  author: z.string().min(1).max(200).optional(),
  from: Day.optional(),
  to: Day.optional(),
  lang: z.string().optional(),
});

const Pair = z.object({ a: z.coerce.number().int().min(1), b: z.coerce.number().int().min(1) });

/** A row of the register as the caller gets it: with who started it and whether the caller may change it. */
export type DecisionView = RegisterEntry & { author: Author | null; mine: boolean; canEdit: boolean; private: boolean };

const DECISION_REFUSALS: Record<DecisionError["code"], 409> = {
  no_verdict: 409,
  already_approved: 409,
  not_approved: 409,
  closed: 409,
  not_closed: 409,
  self_superseding: 409,
};

export function decisionRoutes(deps: DecisionDeps) {
  const app = new Hono<Env>();
  const { store, hooks } = deps;

  /** Who acts: the user id, with the name the host gives it (or the one typed on a self-hosted server). */
  const actorOf = async (user: User | null, typed: string | null): Promise<DecisionActor> => {
    const id = deps.ownerOf(user);
    if (id && hooks.authors) {
      const author = (await hooks.authors([id]))[id];
      return { id, name: author?.name ?? author?.email ?? null };
    }
    return { id, name: typed };
  };

  const saved = async (session: Session) => {
    session.updatedAt = new Date().toISOString();
    await store.save(session);
    deps.publish(session);
    return registerEntry(session);
  };

  const refused = (c: Context<Env>, error: DecisionError) =>
    c.json({ error: error.code, message: error.message }, DECISION_REFUSALS[error.code]);

  // A "what if" scenario: a revision of its own, made from the changes and the question, branching from any revision.
  app.post("/api/sessions/:id/scenarios", async (c) => {
    const { session } = await deps.editable(c.req.param("id"), c.get("user"));
    const input = ScenarioInput.parse(await c.req.json());
    if (input.changes.length === 0 && !input.question)
      throw new InvalidStateError("Describe the scenario or change a value.", "no_changes");
    const scenario: RevisionScenario = { title: input.title, question: input.question, changes: input.changes };
    const pending = await deps.revise(session, {
      reason: "scenario",
      inputs: { facts: [], note: input.question, questionnaireId: null },
      scenario,
      ...(input.basedOn === undefined ? {} : { basedOn: input.basedOn }),
    });
    return c.json({ accepted: true, revision: pending.number }, 202);
  });

  app.get("/api/sessions/:id/scenarios", async (c) => {
    const { session } = await deps.access(c.req.param("id"), c.get("user"));
    return c.json({
      adopted: session.adopted,
      scenarios: scenariosOf(session).map((revision) => ({
        number: revision.number,
        createdAt: revision.createdAt,
        basedOn: revision.basedOn,
        title: revision.scenario?.title ?? "",
        question: revision.scenario?.question ?? null,
        changes: revision.scenario?.changes ?? [],
        recommendation: revision.verdict.recommendation.seat,
        adopted: session.adopted === revision.number,
      })),
    });
  });

  // Adopts a scenario as the decision, or goes back to the latest revision (null).
  app.put("/api/sessions/:id/adopted", async (c) => {
    const { session } = await deps.editable(c.req.param("id"), c.get("user"));
    deps.startAction(session);
    const { revision } = z.object({ revision: z.number().int().min(1).nullable() }).parse(await c.req.json());
    try {
      adoptScenario(session, revision);
    } catch (error) {
      if (error instanceof RangeError) throw new InvalidStateError(error.message, "not_a_scenario", { number: revision ?? 0 });
      throw error;
    }
    return c.json({ adopted: session.adopted, decision: await saved(session) });
  });

  // Two versions side by side, with what differs (?a=1&b=3).
  app.get("/api/sessions/:id/compare", async (c) => {
    const { session } = await deps.access(c.req.param("id"), c.get("user"));
    const { a, b } = Pair.parse(c.req.query());
    const comparison = compareRevisions(session, a, b);
    if (!comparison) return c.json({ error: "not_found", message: "There is no such revision." }, 404);
    return c.json({ comparison });
  });

  // The register's steps. Approving, rejecting, superseding and reopening need the right to change the session; asking
  // for an approval, the right to read it.
  app.post("/api/sessions/:id/decision/request", async (c) => {
    const user = c.get("user");
    const found = await deps.access(c.req.param("id"), user);
    const input = ActionInput.parse(await c.req.json().catch(() => ({})));
    const session = found.session;
    try {
      requestApproval(session, await actorOf(user, input.name), input.comment, new Date().toISOString());
    } catch (error) {
      if (error instanceof DecisionError) return refused(c, error);
      throw error;
    }
    const decision = await saved(session);
    // Those who may approve hear it in the team's channel; the author by e-mail, unless they asked.
    await deps.chat?.notify(session, "approval_requested", found);
    if (deps.notifier && found.owner !== deps.ownerOf(user)) {
      const recipient = found.owner && hooks.notifyRecipient ? await hooks.notifyRecipient({ userId: found.owner }) : null;
      if (recipient || !found.owner) await deps.notifier.notify(session, "approval_requested", recipient);
    }
    return c.json({ decision });
  });

  app.post("/api/sessions/:id/decision/:action{approve|reject|reopen|supersede}", async (c) => {
    const user = c.get("user");
    const action = c.req.param("action");
    const { session } = await deps.editable(c.req.param("id"), user);
    const body = await c.req.json().catch(() => ({}));
    const input = ActionInput.parse(body);
    const actor = await actorOf(user, input.name);
    const at = new Date().toISOString();
    try {
      if (action === "approve") {
        approveDecision(session, actor, input.comment, at);
        await supersedeParent(session, user, actor, at);
      } else if (action === "reject") rejectDecision(session, actor, input.comment, at);
      else if (action === "reopen") reopenDecision(session, actor, input.comment, at);
      else {
        const { by } = z.object({ by: z.string().min(1).max(200) }).parse(body);
        const replacement = await deps.access(by, user);
        const title = replacement.session.sheet?.projectName ?? replacement.session.idea.slice(0, 120);
        supersedeDecision(session, actor, { id: replacement.session.id, title }, input.comment, at);
      }
    } catch (error) {
      if (error instanceof DecisionError) return refused(c, error);
      throw error;
    }
    return c.json({ decision: await saved(session) });
  });

  /**
   * A session started from an earlier decision replaces it once approved: the earlier one is marked superseded, when
   * the approver may change it and it is still open.
   */
  const supersedeParent = async (session: Session, user: User | null, actor: DecisionActor, at: string) => {
    if (!session.parentId) return;
    const parent = await deps.access(session.parentId, user).catch(() => null);
    if (!parent?.access.canEdit) return;
    const status = decisionStatus(parent.session);
    if (status !== "proposed" && status !== "approved") return;
    supersedeDecision(parent.session, actor, { id: session.id, title: session.sheet?.projectName ?? null }, null, at);
    await saved(parent.session);
  };

  // The note and the review of a decision: a field left out keeps its value.
  app.put("/api/sessions/:id/decision", async (c) => {
    const { session } = await deps.editable(c.req.param("id"), c.get("user"));
    const input = DetailsInput.parse(await c.req.json());
    try {
      setDecisionDetails(session, {
        ...(input.note === undefined ? {} : { note: input.note }),
        ...(input.review ? { review: input.review } : {}),
      });
    } catch (error) {
      if (error instanceof DecisionError) return refused(c, error);
      throw error;
    }
    return c.json({ decision: await saved(session) });
  });

  /** The decisions the caller may read, with the filters asked for, and the authors to filter by. */
  const listed = async (c: Context<Env>): Promise<{ decisions: DecisionView[]; authors: (Author & { id: string })[]; shared: boolean }> => {
    const user = c.get("user");
    const input = ListInput.parse(c.req.query());
    const owner = deps.ownerOf(user);
    const scope = await deps.scopeOf(user);
    const base: DecisionQuery = scope ? { owner, workspace: scope.workspace } : { owner };
    const author = input.author === "me" ? owner : input.author;
    const rows = await store.decisions({
      ...base,
      ...(input.status ? { status: input.status } : {}),
      ...(author !== undefined ? { author } : {}),
      ...(input.from ? { from: input.from } : {}),
      ...(input.to ? { to: input.to } : {}),
    });
    const everyone = author === undefined ? rows : await store.decisions(base);
    const owners = [...new Set(everyone.flatMap((row) => (row.owner ? [row.owner] : [])))];
    const names = hooks.authors && owners.length > 0 ? await hooks.authors(owners) : {};
    const decisions = await Promise.all(
      rows.map(async (row): Promise<DecisionView> => {
        const mine = row.owner === owner;
        const placement: Placement = { owner: row.owner, workspace: row.workspace, private: row.private };
        const canEdit =
          mine || (user && hooks.canEdit && row.workspace ? await hooks.canEdit(user, { id: row.sessionId, ...placement }) : false);
        const { owner: _owner, workspace: _workspace, private: isPrivate, ...entry } = row as StoredDecision;
        return { ...entry, author: mine ? null : (names[row.owner ?? ""] ?? null), mine, canEdit, private: isPrivate };
      }),
    );
    return {
      decisions,
      authors: owners.map((id) => ({ id, name: names[id]?.name ?? null, email: names[id]?.email ?? null })),
      shared: Boolean(scope?.workspace),
    };
  };

  app.get("/api/decisions", async (c) => c.json(await listed(c)));

  app.get("/api/decisions.csv", async (c) => {
    const { decisions } = await listed(c);
    const lang = c.req.query("lang");
    const locale: Locale = lang && isLocale(lang) ? lang : "en";
    const base = (deps.publicUrl ?? new URL(c.req.url).origin).replace(/\/+$/, "");
    const rows = decisions.map((entry) => ({ ...entry, author: entry.mine ? null : (entry.author?.name ?? entry.author?.email ?? null) }));
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="decisions-${new Date().toISOString().slice(0, 10)}.csv"`);
    c.header("Cache-Control", "no-store");
    return c.body(renderRegisterCsv(rows, locale, (id) => `${base}/#/s/${id}`));
  });

  return app;
}

/**
 * Sends the reminders of the decisions whose review date has come (`now` gives the day, in UTC), once per date: an
 * e-mail to the author of the session and to whoever approved it (the server's default address when self-hosted),
 * and a message in the chat channel when there is one. Returns how many decisions were reminded of.
 *
 * Each reminder is taken in the database before it is sent, so two runs at once (two processes during a rolling
 * update, or the hosted hourly job on several instances) send it once. A reminder whose every message failed is given
 * back and tried again on the next run; one that reached somebody is not sent again, and the messages that failed are
 * logged. One reminder that fails never holds the others.
 */
export async function sendReviewReminders(
  deps: Pick<DecisionDeps, "store" | "hooks" | "notifier" | "chat">,
  now = new Date(),
): Promise<number> {
  const today = now.toISOString().slice(0, 10);
  let count = 0;
  for (const id of await deps.store.dueReviews(today)) {
    try {
      const found = await deps.store.find(id);
      const decision = found?.session.decision;
      if (!found || !decision?.review.on || !reviewDue(found.session, today)) continue;
      const on = decision.review.on;
      if (!(await deps.store.claimReminder(id, on))) continue;
      const { delivered, failed } = await remind(deps, found);
      if (delivered === 0 && failed > 0) {
        await deps.store.releaseReminder(id, on);
        continue;
      }
      decision.review.remindedFor = on;
      await deps.store.save(found.session);
      count++;
    } catch (error) {
      console.error(`The review reminder of session ${id} failed:`, error);
    }
  }
  return count;
}

/** Sends one reminder through every channel, each on its own: how many messages went, and how many failed. */
async function remind(deps: Pick<DecisionDeps, "hooks" | "notifier" | "chat">, found: StoredSession) {
  let delivered = 0;
  let failed = 0;
  const attempt = async (send: () => Promise<void>) => {
    try {
      await send();
      delivered++;
    } catch (error) {
      failed++;
      console.error(`A review reminder of session ${found.session.id} was not sent:`, error);
    }
  };
  const { chat, notifier, hooks } = deps;
  if (chat) await attempt(() => chat.notify(found.session, "review_due", found));
  if (notifier) {
    const approver = found.session.decision?.approval?.by.id ?? null;
    const people = [...new Set([found.owner, approver].filter((person): person is string => person !== null))];
    if (people.length === 0 || !hooks.notifyRecipient) await attempt(() => notifier.notify(found.session, "review_due", null));
    else {
      for (const person of people) {
        await attempt(async () => {
          const recipient = await hooks.notifyRecipient?.({ userId: person });
          if (recipient) await notifier.notify(found.session, "review_due", recipient);
        });
      }
    }
  }
  return { delivered, failed };
}
