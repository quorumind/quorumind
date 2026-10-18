import {
  Audience,
  catalogFromEnv,
  createSession,
  DEMO_IDEA,
  DEMO_LINEUP,
  DEPTHS,
  DebateEngine,
  estimateDebateCost,
  InvalidStateError,
  isLocale,
  isLocalOnly,
  type Lineup,
  LOCALES,
  liveLineupFromEnv,
  MAX_ROUNDS,
  MODES,
  type ModelOption,
  type Participant,
  PERSONA_IDS,
  PROPOSER_SEATS,
  providersFor,
  RequirementsSheet,
  renderReport,
  type Session,
  TEMPLATE_IDS,
  type UsageRecord,
} from "@quorumind/core";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { BrandingStore } from "./branding.ts";
import type { EventBus } from "./bus.ts";
import { exportRoutes } from "./exports.ts";
import type { Notifier } from "./notifier.ts";
import type { SessionStore } from "./store.ts";

type Env = Record<string, string | undefined>;

export interface User {
  userId: string;
}

/**
 * Extension points used by the hosted version. Self-hosted, none is set: there is a single
 * local user, every configured model is available and nothing is metered.
 */
export interface AppHooks {
  /** Who is calling. When provided, a null result means 401 and every session is scoped to its owner. */
  identify?(request: Request): Promise<User | null>;
  /** Called before any model work starts or resumes. Refusing answers HTTP 402. */
  authorizeSpend?(
    user: User,
    session: Session,
    estimateUsd: number,
  ): Promise<{ ok: true } | { ok: false; reason: string; code: "insufficient_credits" | "plan_limit" }>;
  /** After every model call, with its real cost (null when the price is unknown). */
  onUsage?(user: User, session: Session, record: UsageRecord): void | Promise<void>;
  /** The models this user may pick. */
  catalog?(user: User): Promise<ModelOption[]>;
  /** The environment (API keys, base URLs) used to call the models for this user. */
  providerEnv?(user: User): Env;
  /** Where to send this user's notifications. */
  notifyRecipient?(user: User): Promise<string | null>;
  /** Forces a cost cap on every session, in US dollars. */
  maxBudgetUsd?: number;
}

export interface AppDeps {
  store: SessionStore;
  bus: EventBus;
  env: Env;
  hooks?: AppHooks;
  notifier?: Notifier | null;
  /** Delay between streamed chunks of the demo; 0 in tests. */
  mockDelayMs?: number;
  /** White-label branding of the exports; kept in memory when not given. */
  brandingStore?: BrandingStore;
}

const AnswerList = z.array(z.object({ question: z.string().max(2_000), answer: z.string().max(4_000) })).max(20);

const ParticipantInput = z.object({ provider: z.string(), model: z.string().max(200) });
const SeatInput = ParticipantInput.extend({ persona: z.string().trim().max(200).nullable().default(null) });

const LineupInput = z.object({
  interviewer: ParticipantInput,
  arbiter: ParticipantInput,
  seats: z.partialRecord(z.enum(PROPOSER_SEATS), SeatInput),
  devil: SeatInput.nullable().default(null),
});

const ContextInput = z
  .array(
    z.object({
      id: z.string().max(100),
      kind: z.enum(["file", "url", "github", "text"]),
      name: z.string().max(300),
      text: z.string().max(200_000),
    }),
  )
  .max(5)
  .default([]);

const NewSession = z.object({
  locale: z.string().refine(isLocale, "Unsupported language"),
  idea: z.string().trim().max(4_000).default(""),
  demo: z.boolean().default(false),
  mode: z.enum(MODES).default("standard"),
  template: z.enum(TEMPLATE_IDS).nullable().default(null),
  depth: z.enum(DEPTHS).default("standard"),
  rounds: z.number().int().min(1).max(MAX_ROUNDS).default(1),
  budgetUsd: z.number().positive().max(1_000).nullable().default(null),
  lineup: LineupInput.nullable().default(null),
  challenge: z.string().trim().max(8_000).nullable().default(null),
  context: ContextInput,
  redact: z.boolean().default(false),
  notify: z.boolean().default(false),
});

/** Fields of a session that never leave the server through a public link. */
function publicView(session: Session): Session {
  return {
    ...session,
    context: session.context.map((doc) => ({ ...doc, text: "" })),
    usage: [],
    notify: false,
  };
}

const slug = (session: Session) =>
  (session.sheet?.projectName ?? "quorumind")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "quorumind";

export function createApp(deps: AppDeps) {
  const { store, bus, env, hooks = {} } = deps;
  const busy = new Set<string>();
  const users = new Map<string, User | null>();
  const mockOptions = deps.mockDelayMs === undefined ? {} : { mockDelayMs: deps.mockDelayMs };

  // Ollama discovery takes a network call: done once, then reused.
  let catalogCache: Promise<ModelOption[]> | null = null;
  const catalogFor = (user: User | null): Promise<ModelOption[]> => {
    if (user && hooks.catalog) return hooks.catalog(user);
    catalogCache ??= catalogFromEnv(env).catch(() => []);
    return catalogCache;
  };
  const envFor = (user: User | null): Env => (user && hooks.providerEnv ? hooks.providerEnv(user) : env);

  const engineFor = (session: Session) => {
    const user = users.get(session.id) ?? null;
    let reported = session.usage.length;
    return new DebateEngine(providersFor(session, envFor(user), mockOptions), {
      emit: (id, event) => bus.publish(id, event),
      save: async (updated) => {
        store.save(updated);
        if (user && hooks.onUsage) {
          for (const record of updated.usage.slice(reported)) await hooks.onUsage(user, updated, record);
        }
        reported = updated.usage.length;
      },
    });
  };

  const estimateFor = (session: {
    seats: Record<string, { model: string }>;
    devil: { model: string } | null;
    arbiter: { model: string };
    rounds: number;
    mode: Session["mode"];
  }) => {
    const seatModels = Object.values(session.seats).map((seat) => seat.model);
    const devil = session.devil ? [session.devil.model] : [];
    return estimateDebateCost({
      proposerModels: session.mode === "challenge" ? [] : seatModels,
      criticModels: session.mode === "challenge" ? [...seatModels, ...devil] : devil,
      arbiterModel: session.arbiter.model,
      rounds: session.rounds,
    });
  };

  const authorize = async (session: Session) => {
    const user = users.get(session.id) ?? null;
    if (!user || !hooks.authorizeSpend || session.demo) return;
    const estimate = session.verdict ? 0.05 : (estimateFor(session)?.high ?? 1);
    const answer = await hooks.authorizeSpend(user, session, estimate);
    if (!answer.ok) throw new PaymentRequired(answer.code, answer.reason);
  };

  const notify = async (session: Session) => {
    if (!deps.notifier || !session.notify) return;
    if (session.phase !== "complete" && session.phase !== "awaiting_answers" && session.phase !== "failed") return;
    const user = users.get(session.id) ?? null;
    const recipient = user && hooks.notifyRecipient ? await hooks.notifyRecipient(user) : null;
    await deps.notifier.notify(session, session.phase, recipient);
  };

  // Long operations run in the background; the client follows them through the event stream.
  const runInBackground = (session: Session, work: (engine: DebateEngine) => Promise<void>) => {
    busy.add(session.id);
    work(engineFor(session))
      .then(() => notify(session))
      .catch((error) => console.error(`Session ${session.id} failed:`, error))
      .finally(() => busy.delete(session.id));
  };

  const app = new Hono<{ Variables: { user: User | null } }>();
  app.use("/api/*", bodyLimit({ maxSize: 512 * 1024 }));

  const open = ["/api/health", "/api/config", "/api/gallery"];
  app.use("/api/*", async (c, next) => {
    if (!hooks.identify) {
      c.set("user", null);
      return next();
    }
    const user = await hooks.identify(c.req.raw);
    if (!user && !open.includes(c.req.path) && !c.req.path.startsWith("/api/shared/")) {
      return c.json({ error: "unauthorized", message: "Sign in to continue." }, 401);
    }
    c.set("user", user);
    return next();
  });
  const ownerOf = (user: User | null) => user?.userId ?? null;

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.get("/api/config", async (c) => {
    const user = c.get("user");
    const catalog = await catalogFor(user);
    const lineup = hooks.catalog && user ? defaultLineup(catalog) : liveLineupFromEnv(envFor(user), catalog);
    const estimate = (value: Lineup) => estimateFor({ ...value, rounds: 1, mode: "standard" });
    return c.json({
      locales: LOCALES,
      catalog,
      live: lineup ? { lineup, estimateUsd: estimate(lineup) } : null,
      demo: { lineup: DEMO_LINEUP, idea: DEMO_IDEA },
      templates: TEMPLATE_IDS,
      personas: PERSONA_IDS,
      localOnly: isLocalOnly(env),
      notifications: Boolean(deps.notifier),
      retentionDays: retentionDays(env),
      maxBudgetUsd: hooks.maxBudgetUsd ?? null,
    });
  });

  app.post("/api/estimate", async (c) => {
    const input = z.object({ lineup: LineupInput, rounds: NewSession.shape.rounds, mode: NewSession.shape.mode }).parse(await c.req.json());
    return c.json({ estimateUsd: estimateFor({ ...input.lineup, rounds: input.rounds, mode: input.mode }) });
  });

  app.get("/api/sessions", (c) => c.json({ sessions: store.list(50, ownerOf(c.get("user"))) }));

  app.post("/api/sessions", async (c) => {
    const user = c.get("user");
    const input = NewSession.parse(await c.req.json());
    let lineup: Lineup;
    if (input.demo) {
      lineup = DEMO_LINEUP;
    } else {
      const catalog = await catalogFor(user);
      if (input.lineup) {
        lineup = validateLineup(input.lineup, catalog);
      } else {
        const fallback = hooks.catalog && user ? defaultLineup(catalog) : liveLineupFromEnv(envFor(user), catalog);
        if (!fallback) {
          return c.json({ error: "live_unavailable", message: "No AI model is configured. Add an API key, or try the demo." }, 400);
        }
        lineup = fallback;
      }
      if (!input.idea) return c.json({ error: "invalid_request", message: "Describe your project idea." }, 400);
      if (input.mode === "challenge" && !input.challenge) {
        return c.json({ error: "invalid_request", message: "Describe the solution you want challenged." }, 400);
      }
    }
    const cap = hooks.maxBudgetUsd;
    const session = createSession({
      locale: input.locale as Session["locale"],
      idea: input.demo ? input.idea || DEMO_IDEA : input.idea,
      demo: input.demo,
      mode: input.demo ? "standard" : input.mode,
      template: input.template,
      depth: input.depth,
      rounds: input.rounds,
      budgetUsd: cap === undefined ? input.budgetUsd : Math.min(input.budgetUsd ?? cap, cap),
      ...lineup,
      challenge: input.challenge,
      context: input.context,
      redact: input.redact,
      notify: input.notify && Boolean(deps.notifier),
    });
    users.set(session.id, user);
    await authorize(session);
    store.save(session, ownerOf(user));
    runInBackground(session, (engine) => engine.startInterview(session));
    return c.json({ session }, 201);
  });

  const load = (id: string, user: User | null) => {
    const session = store.get(id, ownerOf(user));
    if (!session) throw new NotFound();
    if (!users.has(id)) users.set(id, user);
    return session;
  };

  const startAction = (session: Session) => {
    if (busy.has(session.id)) throw new InvalidStateError("This session is already working. Wait for it to finish.");
  };

  app.get("/api/sessions/:id", (c) => {
    const id = c.req.param("id");
    const session = load(id, c.get("user"));
    return c.json({ session, busy: busy.has(id), share: store.shareOf(id), feedback: store.feedbackOf(id) });
  });

  app.delete("/api/sessions/:id", (c) => {
    const session = load(c.req.param("id"), c.get("user"));
    startAction(session);
    store.delete(session.id, ownerOf(c.get("user")));
    users.delete(session.id);
    return c.body(null, 204);
  });

  app.post("/api/sessions/:id/interview", async (c) => {
    const session = load(c.req.param("id"), c.get("user"));
    startAction(session);
    const { answers } = z.object({ answers: AnswerList }).parse(await c.req.json());
    if (session.phase !== "interview") throw new InvalidStateError("The interview is over.");
    await authorize(session);
    runInBackground(session, (engine) => engine.answerInterview(session, answers));
    return c.json({ accepted: true }, 202);
  });

  app.put("/api/sessions/:id/sheet", async (c) => {
    const session = load(c.req.param("id"), c.get("user"));
    startAction(session);
    const { sheet } = z.object({ sheet: RequirementsSheet }).parse(await c.req.json());
    await authorize(session);
    await engineFor(session).confirmSheet(session, sheet);
    runInBackground(session, (engine) => engine.runDebate(session));
    return c.json({ accepted: true }, 202);
  });

  app.post("/api/sessions/:id/answers", async (c) => {
    const session = load(c.req.param("id"), c.get("user"));
    startAction(session);
    const { answers } = z.object({ answers: AnswerList }).parse(await c.req.json());
    await authorize(session);
    await engineFor(session).answerDebate(session, answers);
    runInBackground(session, (engine) => engine.runDebate(session));
    return c.json({ accepted: true }, 202);
  });

  app.post("/api/sessions/:id/resume", async (c) => {
    const session = load(c.req.param("id"), c.get("user"));
    startAction(session);
    await authorize(session);
    runInBackground(session, async (engine) => {
      const next = await engine.resume(session);
      if (next === "debate" && session.phase === "debating") await engine.runDebate(session);
    });
    return c.json({ accepted: true }, 202);
  });

  // The verdict rewritten for another reader. Short enough to wait for.
  app.post("/api/sessions/:id/brief", async (c) => {
    const session = load(c.req.param("id"), c.get("user"));
    startAction(session);
    const { audience } = z.object({ audience: Audience }).parse(await c.req.json());
    const cached = session.briefs[audience];
    if (cached) return c.json({ brief: cached });
    await authorize(session);
    busy.add(session.id);
    try {
      await engineFor(session).writeBrief(session, audience);
    } finally {
      busy.delete(session.id);
    }
    return c.json({ brief: session.briefs[audience] });
  });

  // Starts a new session from an earlier one, at the requirements review: the person
  // changes what moved in their project and runs the debate again.
  app.post("/api/sessions/:id/fork", async (c) => {
    const user = c.get("user");
    const source = load(c.req.param("id"), user);
    if (!source.sheet) throw new InvalidStateError("This session has no requirements sheet yet.");
    const session = createSession({
      locale: source.locale,
      idea: source.idea,
      demo: source.demo,
      mode: source.mode,
      template: source.template,
      depth: source.depth,
      rounds: Math.min(source.rounds, MAX_ROUNDS),
      budgetUsd: source.budgetUsd,
      interviewer: source.interviewer,
      arbiter: source.arbiter,
      seats: source.seats,
      devil: source.devil,
      challenge: source.challenge,
      context: source.context,
      redact: source.redact,
      notify: source.notify,
      parentId: source.id,
    });
    session.interview = structuredClone(source.interview);
    session.sheet = structuredClone(source.sheet);
    session.phase = "review";
    users.set(session.id, user);
    store.save(session, ownerOf(user));
    return c.json({ session }, 201);
  });

  app.post("/api/sessions/:id/share", async (c) => {
    const session = load(c.req.param("id"), c.get("user"));
    const { public: isPublic } = z.object({ public: z.boolean().default(false) }).parse(await c.req.json());
    return c.json({ share: store.share(session.id, isPublic) });
  });

  app.delete("/api/sessions/:id/share", (c) => {
    const session = load(c.req.param("id"), c.get("user"));
    store.unshare(session.id);
    return c.body(null, 204);
  });

  app.get("/api/shared/:token", (c) => {
    const session = store.shared(c.req.param("token"));
    if (!session) throw new NotFound();
    return c.json({ session: publicView(session) });
  });

  app.get("/api/shared/:token/report.md", (c) => {
    const session = store.shared(c.req.param("token"));
    if (!session) throw new NotFound();
    return markdown(c, publicView(session));
  });

  app.get("/api/gallery", (c) => c.json({ sessions: store.gallery() }));

  app.post("/api/sessions/:id/feedback", async (c) => {
    const session = load(c.req.param("id"), c.get("user"));
    const input = z
      .object({
        helpful: z.boolean().nullable().default(null),
        kind: z.enum(["rating", "error"]).default("rating"),
        comment: z.string().trim().max(2_000).default(""),
      })
      .parse(await c.req.json());
    store.addFeedback({ sessionId: session.id, ...input, createdAt: new Date().toISOString() });
    return c.json({ feedback: store.feedbackOf(session.id) }, 201);
  });

  // Everything stored about the caller, in one file: the GDPR right to data portability.
  app.get("/api/export", (c) => {
    const sessions = store.all(ownerOf(c.get("user")));
    c.header("Content-Disposition", `attachment; filename="quorumind-export-${new Date().toISOString().slice(0, 10)}.json"`);
    return c.json({
      exportedAt: new Date().toISOString(),
      sessions: sessions.map((session) => ({ ...session, share: store.shareOf(session.id), feedback: store.feedbackOf(session.id) })),
    });
  });

  app.get("/api/sessions/:id/report.md", (c) => markdown(c, load(c.req.param("id"), c.get("user"))));

  app.get("/api/sessions/:id/events", (c) => {
    const session = load(c.req.param("id"), c.get("user"));
    return streamSSE(c, async (stream) => {
      let id = 0;
      const queue: string[] = [];
      let wake: (() => void) | null = null;
      const unsubscribe = bus.subscribe(session.id, (event) => {
        queue.push(JSON.stringify(event));
        wake?.();
      });
      stream.onAbort(() => {
        unsubscribe();
        wake?.();
      });
      await stream.writeSSE({ id: String(id++), event: "message", data: JSON.stringify({ type: "session", session }) });
      while (!stream.aborted) {
        const next = queue.shift();
        if (next !== undefined) {
          await stream.writeSSE({ id: String(id++), event: "message", data: next });
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, 15_000);
        });
        wake = null;
        if (queue.length === 0 && !stream.aborted) await stream.writeSSE({ event: "ping", data: "" });
      }
      unsubscribe();
    });
  });

  app.route(
    "/",
    exportRoutes({
      getSession: (id, user) => store.get(id, ownerOf(user)),
      ownerOf,
      branding: deps.brandingStore ?? new BrandingStore(":memory:"),
    }),
  );

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((error, c) => {
    if (error instanceof NotFound) return c.json({ error: "not_found", message: "This session does not exist." }, 404);
    if (error instanceof InvalidStateError) return c.json({ error: "invalid_state", message: error.message }, 409);
    if (error instanceof InvalidLineup) return c.json({ error: "invalid_lineup", message: error.message }, 400);
    if (error instanceof PaymentRequired) return c.json({ error: error.code, message: error.message }, 402);
    if (error instanceof z.ZodError) return c.json({ error: "invalid_request", issues: error.issues }, 400);
    if (error instanceof SyntaxError) return c.json({ error: "invalid_request", message: "The body is not valid JSON." }, 400);
    console.error(error);
    return c.json({ error: "internal_error", message: "Something went wrong on the server." }, 500);
  });

  return app;
}

function markdown(c: { header(name: string, value: string): void; body(data: string): Response }, session: Session) {
  c.header("Content-Type", "text/markdown; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="${slug(session)}-report.md"`);
  return c.body(renderReport(session));
}

export function retentionDays(env: Env): number | null {
  const days = Number(env.QUORUMIND_RETENTION_DAYS);
  return Number.isFinite(days) && days > 0 ? days : null;
}

/** Seats must be consecutive from A, two to four of them, and every model must be in the catalog. */
function validateLineup(input: z.infer<typeof LineupInput>, catalog: ModelOption[]): Lineup {
  const known = (participant: { provider: string; model: string }): Participant => {
    const option = catalog.find((entry) => entry.provider === participant.provider && entry.model === participant.model);
    if (!option) throw new InvalidLineup(`The model ${participant.provider}:${participant.model} is not available on this server.`);
    return { provider: option.provider, model: option.model };
  };
  const keys = Object.keys(input.seats).sort();
  if (keys.length < 2 || keys.join("") !== PROPOSER_SEATS.slice(0, keys.length).join("")) {
    throw new InvalidLineup("A debate needs two to four seats, named from A.");
  }
  return {
    interviewer: known(input.interviewer),
    arbiter: known(input.arbiter),
    seats: Object.fromEntries(
      keys.map((key) => [key, { ...known(input.seats[key as "A"] as Participant), persona: input.seats[key as "A"]?.persona ?? null }]),
    ),
    devil: input.devil ? { ...known(input.devil), persona: input.devil.persona } : null,
  };
}

/** The hosted catalog's default: the first two vendors face each other, the first model rules. */
function defaultLineup(catalog: ModelOption[]): Lineup | null {
  const first = catalog[0];
  if (!first) return null;
  const second = catalog.find((entry) => entry.provider !== first.provider) ?? first;
  const pick = (option: ModelOption): Participant => ({ provider: option.provider, model: option.model });
  return {
    interviewer: pick(first),
    arbiter: pick(first),
    seats: { A: { ...pick(first), persona: null }, B: { ...pick(second), persona: null } },
    devil: null,
  };
}

class NotFound extends Error {}
class InvalidLineup extends Error {}
class PaymentRequired extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
