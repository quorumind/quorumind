import {
  createSession,
  DEMO_IDEA,
  DEMO_LINEUP,
  DebateEngine,
  estimateDebateCost,
  InvalidStateError,
  isLocale,
  type Lineup,
  LOCALES,
  liveLineupFromEnv,
  providersFor,
  RequirementsSheet,
  renderReport,
  type Session,
} from "@quorumind/core";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { EventBus } from "./bus.ts";
import type { SessionStore } from "./store.ts";

export interface AppDeps {
  store: SessionStore;
  bus: EventBus;
  env: Record<string, string | undefined>;
  /** Delay between streamed chunks of the demo; 0 in tests. */
  mockDelayMs?: number;
}

const AnswerList = z.array(z.object({ question: z.string().max(2_000), answer: z.string().max(4_000) })).max(20);

const NewSession = z.object({
  locale: z.string().refine(isLocale, "Unsupported language"),
  idea: z.string().trim().max(4_000).default(""),
  demo: z.boolean().default(false),
  rounds: z.number().int().min(1).max(3).default(1),
  budgetUsd: z.number().positive().max(1_000).nullable().default(null),
});

export function createApp(deps: AppDeps) {
  const { store, bus, env } = deps;
  const liveLineup = liveLineupFromEnv(env);
  const busy = new Set<string>();

  const engineFor = (session: Session) => {
    const lineup = { interviewer: session.interviewer, arbiter: session.arbiter, seats: session.seats };
    return new DebateEngine(providersFor(lineup, env, deps.mockDelayMs === undefined ? {} : { mockDelayMs: deps.mockDelayMs }), {
      emit: (id, event) => bus.publish(id, event),
      save: (updated) => store.save(updated),
    });
  };

  // Long operations run in the background; the client follows them through the event stream.
  const runInBackground = (session: Session, work: (engine: DebateEngine) => Promise<void>) => {
    busy.add(session.id);
    work(engineFor(session))
      .catch((error) => console.error(`Session ${session.id} failed:`, error))
      .finally(() => busy.delete(session.id));
  };

  const app = new Hono();
  app.use("/api/*", bodyLimit({ maxSize: 256 * 1024 }));

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.get("/api/config", (c) => {
    const estimate = (lineup: Lineup) =>
      estimateDebateCost({
        proposerModels: Object.values(lineup.seats).map((seat) => seat.model),
        arbiterModel: lineup.arbiter.model,
        rounds: 1,
      });
    return c.json({
      locales: LOCALES,
      live: liveLineup ? { lineup: liveLineup, estimateUsd: estimate(liveLineup) } : null,
      demo: { lineup: DEMO_LINEUP, idea: DEMO_IDEA },
    });
  });

  app.get("/api/sessions", (c) => c.json({ sessions: store.list() }));

  app.post("/api/sessions", async (c) => {
    const input = NewSession.parse(await c.req.json());
    if (!input.demo && !liveLineup) {
      return c.json({ error: "live_unavailable", message: "No API key is configured. Add one, or try the demo." }, 400);
    }
    if (!input.demo && !input.idea) return c.json({ error: "invalid_request", message: "Describe your project idea." }, 400);
    const lineup = input.demo ? DEMO_LINEUP : (liveLineup as Lineup);
    const session = createSession({
      locale: input.locale as Session["locale"],
      idea: input.demo ? input.idea || DEMO_IDEA : input.idea,
      demo: input.demo,
      rounds: input.rounds,
      budgetUsd: input.budgetUsd,
      ...lineup,
    });
    store.save(session);
    runInBackground(session, (engine) => engine.startInterview(session));
    return c.json({ session }, 201);
  });

  const load = (id: string) => {
    const session = store.get(id);
    if (!session) throw new NotFound();
    return session;
  };

  const startAction = (session: Session) => {
    if (busy.has(session.id)) throw new InvalidStateError("This session is already working. Wait for it to finish.");
  };

  app.get("/api/sessions/:id", (c) => c.json({ session: load(c.req.param("id")), busy: busy.has(c.req.param("id")) }));

  app.post("/api/sessions/:id/interview", async (c) => {
    const session = load(c.req.param("id"));
    startAction(session);
    const { answers } = z.object({ answers: AnswerList }).parse(await c.req.json());
    if (session.phase !== "interview") throw new InvalidStateError("The interview is over.");
    runInBackground(session, (engine) => engine.answerInterview(session, answers));
    return c.json({ accepted: true }, 202);
  });

  app.put("/api/sessions/:id/sheet", async (c) => {
    const session = load(c.req.param("id"));
    startAction(session);
    const { sheet } = z.object({ sheet: RequirementsSheet }).parse(await c.req.json());
    await engineFor(session).confirmSheet(session, sheet);
    runInBackground(session, (engine) => engine.runDebate(session));
    return c.json({ accepted: true }, 202);
  });

  app.post("/api/sessions/:id/answers", async (c) => {
    const session = load(c.req.param("id"));
    startAction(session);
    const { answers } = z.object({ answers: AnswerList }).parse(await c.req.json());
    await engineFor(session).answerDebate(session, answers);
    runInBackground(session, (engine) => engine.runDebate(session));
    return c.json({ accepted: true }, 202);
  });

  app.post("/api/sessions/:id/resume", async (c) => {
    const session = load(c.req.param("id"));
    startAction(session);
    runInBackground(session, async (engine) => {
      const next = await engine.resume(session);
      if (next === "debate" && session.phase === "debating") await engine.runDebate(session);
    });
    return c.json({ accepted: true }, 202);
  });

  app.get("/api/sessions/:id/report.md", (c) => {
    const session = load(c.req.param("id"));
    const name = (session.sheet?.projectName ?? "quorumind")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    c.header("Content-Type", "text/markdown; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="${name || "quorumind"}-report.md"`);
    return c.body(renderReport(session));
  });

  app.get("/api/sessions/:id/events", (c) => {
    const session = load(c.req.param("id"));
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

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((error, c) => {
    if (error instanceof NotFound) return c.json({ error: "not_found", message: "This session does not exist." }, 404);
    if (error instanceof InvalidStateError) return c.json({ error: "invalid_state", message: error.message }, 409);
    if (error instanceof z.ZodError) return c.json({ error: "invalid_request", issues: error.issues }, 400);
    if (error instanceof SyntaxError) return c.json({ error: "invalid_request", message: "The body is not valid JSON." }, 400);
    console.error(error);
    return c.json({ error: "internal_error", message: "Something went wrong on the server." }, 500);
  });

  return app;
}

class NotFound extends Error {}
