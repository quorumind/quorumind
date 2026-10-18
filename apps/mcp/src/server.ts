import { access, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type CallToolResult, McpServer, ResourceTemplate, type ServerContext } from "@modelcontextprotocol/server";
import type { Answer, RequirementsSheet, Session } from "@quorumind/core";
import { z } from "zod";
import { QuorumindClient, QuorumindError, type SessionState } from "./client.ts";
import { ContextFileError, MAX_FILE_CHARS, MAX_FILES, readContextFiles } from "./files.ts";
import { formatSheet, formatUsd, formatVerdictSummary, interviewQuestions, renderSnapshot, snapshot, statusOf } from "./format.ts";
import { type Baseline, baselineOf, isStoppingPoint, waitForStoppingPoint } from "./wait.ts";
import { readZip, ZipError } from "./zip.ts";

export const VERSION = "0.1.0";

/** The files of the hand-off archive, written for coding agents. */
export const HANDOFF_FILES = ["CLAUDE.md", "AGENTS.md", "PLAN.md"] as const;

export interface McpOptions {
  client: QuorumindClient;
  /** Start recorded demo sessions: no API key needed, for tests and to try the tools. */
  demo?: boolean;
  /** Longest a single tool call waits for the debate before handing back. */
  waitMs?: number;
  /** Polling interval when the live event stream is unavailable. */
  pollMs?: number;
  /** Directory that relative paths are resolved against. */
  cwd?: string;
}

export function optionsFromEnv(env: Record<string, string | undefined>): McpOptions {
  const seconds = Number(env.QUORUMIND_MCP_WAIT_SECONDS ?? 600);
  return {
    client: new QuorumindClient({ baseUrl: env.QUORUMIND_URL || "http://127.0.0.1:8787", token: env.QUORUMIND_TOKEN ?? null }),
    demo: env.QUORUMIND_MCP_DEMO === "1" || env.QUORUMIND_MCP_DEMO === "true",
    waitMs: (Number.isFinite(seconds) && seconds > 0 ? seconds : 600) * 1_000,
    cwd: process.cwd(),
  };
}

const SessionId = z.string().min(1).describe("The session id returned by quorumind_start.");

const Answers = z
  .array(
    z.object({
      question: z.string().min(1).max(2_000).describe("The question as it was asked, or its id (interview questions have one)."),
      answer: z.string().max(4_000).describe("The user's answer. \"I don't know\" is a valid answer: it becomes an explicit assumption."),
    }),
  )
  .min(1)
  .max(20);

// Field names match the requirements sheet shown by quorumind_review.
const SheetEdits = z
  .object({
    projectName: z.string(),
    summary: z.string(),
    goals: z.array(z.string()),
    successCriteria: z.array(z.string()),
    mustHave: z.array(z.string()),
    niceToHave: z.array(z.string()),
    outOfScope: z.array(z.string()),
    users: z.string(),
    budget: z.string(),
    existingInfrastructure: z.array(z.string()),
    team: z.string(),
    deadline: z.string().nullable(),
    hardConstraints: z.array(z.string()),
    softConstraints: z.array(z.string()),
    priorities: z.array(z.object({ criterion: z.string(), weight: z.number().min(1).max(5) })),
    assumptions: z.array(z.string()),
  })
  .partial();

const text = (body: string, structured?: object): CallToolResult => ({
  content: [{ type: "text", text: body }],
  ...(structured ? { structuredContent: structured as Record<string, unknown> } : {}),
});

const failure = (body: string, structured?: object): CallToolResult => ({ ...text(body, structured), isError: true });

/** Turns the errors a tool can expect into a tool error the agent can read and act on. */
async function guarded(work: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof QuorumindError) {
      const hint =
        error.status === 404 && error.code === "not_found"
          ? " Call quorumind_sessions to list the sessions."
          : error.status === 402
            ? " This is the billing of the user's Quorumind account, not a problem with the project: ask them to add credits or a plan to their workspace, then try again."
            : error.code === "read_only"
              ? " Another member of the workspace started this session: start a new one, or ask its author."
              : "";
      return failure(`${error.message}${hint}`, { error: error.code, status: error.status });
    }
    if (error instanceof ContextFileError || error instanceof ZipError) return failure(error.message);
    throw error;
  }
}

/** Sends MCP progress notifications when the client asked for them with a progress token. */
function progressReporter(ctx: ServerContext): ((message: string) => void) | undefined {
  const token = ctx.mcpReq._meta?.progressToken;
  if (token === undefined) return undefined;
  let progress = 0;
  return (message) => {
    progress += 1;
    ctx.mcpReq.notify({ method: "notifications/progress", params: { progressToken: token, progress, message } }).catch(() => {
      // The client went away: nothing to report to.
    });
  };
}

export function createMcpServer(options: McpOptions): McpServer {
  const { client } = options;
  const waitMs = options.waitMs ?? 600_000;
  const cwd = options.cwd ?? process.cwd();

  const server = new McpServer(
    { name: "quorumind", version: VERSION },
    {
      instructions:
        "Quorumind makes several AI models debate a software project before it is built, then an arbiter rules. " +
        "Use it before coding anything significant: quorumind_start, relay the interview questions to the user, " +
        "quorumind_answer, quorumind_review and quorumind_confirm the requirements sheet, answer the debate questions, " +
        "then read quorumind_verdict and write the plan with quorumind_handoff. Each call returns what to do next.",
    },
  );

  /** Waits for the next stopping point and describes it. */
  const settle = async (id: string, baseline: Baseline | null, ctx: ServerContext, preface: string[] = []) => {
    const onProgress = progressReporter(ctx);
    const { state, outcome } = await waitForStoppingPoint(client, id, baseline, {
      timeoutMs: waitMs,
      ...(options.pollMs === undefined ? {} : { pollMs: options.pollMs }),
      signal: ctx.mcpReq.signal,
      ...(onProgress ? { onProgress } : {}),
    });
    const status = statusOf(state, outcome);
    const snap = snapshot(client, state, status);
    const lines = [...preface];
    if (outcome === "timeout") {
      lines.push(`Waited ${Math.round(waitMs / 1000)} s; the session is not at a stopping point yet.`);
    }
    lines.push(renderSnapshot(snap, state.session));
    return text(lines.join("\n"), snap);
  };

  // A request that does not fit where the session stands: say why, and where it stands.
  const refuse = (state: SessionState, preface: string) => {
    const snap = snapshot(client, state, statusOf(state));
    return failure(`${preface}\n\n${renderSnapshot(snap, state.session)}`, snap);
  };

  server.registerTool(
    "quorumind_start",
    {
      title: "Start a Quorumind debate",
      description:
        "Start a Quorumind session on a software project, before writing code: several AI models will debate how to build it and an arbiter will rule. " +
        "It first runs a scoping interview: this call waits for the interviewer's first questions and returns them with the session id. " +
        "Relay the questions to the user, then call quorumind_answer. Runs on the Quorumind server configured for this MCP server (QUORUMIND_URL); " +
        "real debates call paid models through that server, so mention the estimated cost (or, on the hosted version, the price of the debate) to the user.",
      inputSchema: z.object({
        idea: z
          .string()
          .min(1)
          .max(4_000)
          .describe("The project or the change to decide, in a few sentences: what it does, for whom, and what is already decided."),
        mode: z
          .enum(["standard", "express", "challenge"])
          .optional()
          .describe(
            "standard: the models design competing options. express: five questions and one short round, cheaper. challenge: the models only look for flaws in own_solution.",
          ),
        template: z
          .enum(["saas", "mobile", "data_ai", "migration", "ecommerce"])
          .optional()
          .describe("Framing that focuses the interview on what matters for this kind of project."),
        locale: z
          .string()
          .default("en")
          .describe(
            "Language of the interview, the debate and the report: en, fr, es, pt, it, de, hi, ja, zh-Hans or ar. Use the user's language.",
          ),
        depth: z.enum(["quick", "standard", "deep"]).optional().describe("How hard the models think. deep costs more."),
        rounds: z.number().int().min(1).max(3).optional().describe("Critique and revision rounds after the blind proposals (default 1)."),
        budget_usd: z.number().positive().max(1_000).optional().describe("Cost cap in US dollars: the debate stops when it is reached."),
        own_solution: z
          .string()
          .max(8_000)
          .optional()
          .describe(
            "The solution the user already has in mind. Implies mode challenge: the models look for its flaws instead of designing options.",
          ),
        context_files: z
          .array(z.string())
          .max(MAX_FILES)
          .optional()
          .describe(
            `Paths of up to ${MAX_FILES} local text files the models should read: README, architecture notes, schema, package.json... Absolute, or relative to the directory this MCP server runs in. Files longer than ${MAX_FILE_CHARS} characters are cut.`,
          ),
        redact: z.boolean().optional().describe("Mask e-mails, phone numbers, card numbers and secrets before anything reaches a model."),
      }),
    },
    (input, ctx) =>
      guarded(async () => {
        const mode = input.mode ?? (input.own_solution ? "challenge" : undefined);
        if (mode === "challenge" && !input.own_solution) {
          return failure("Challenge mode needs own_solution: the solution the models should challenge.");
        }
        const { documents, notes } = input.context_files?.length
          ? await readContextFiles(input.context_files, cwd)
          : { documents: [], notes: [] };
        const config = await client.config().catch(() => null);
        const session = await client.createSession({
          locale: input.locale,
          idea: input.idea,
          demo: options.demo ?? false,
          ...(mode ? { mode } : {}),
          ...(input.template ? { template: input.template } : {}),
          ...(input.depth ? { depth: input.depth } : {}),
          ...(input.rounds ? { rounds: input.rounds } : {}),
          ...(input.budget_usd ? { budgetUsd: input.budget_usd } : {}),
          ...(mode === "challenge" ? { challenge: input.own_solution ?? null } : {}),
          ...(documents.length > 0 ? { context: documents } : {}),
          ...(input.redact === undefined ? {} : { redact: input.redact }),
        });
        const preface: string[] = [];
        if (options.demo) preface.push("Demo mode: a recorded debate is replayed, no model is called and nothing is billed.");
        else if (config?.providerCosts === false) {
          preface.push("This Quorumind server sells each debate at a fixed price, charged once when the debate starts (shown below).");
        } else if (config?.live?.estimateUsd) {
          const { low, high } = config.live.estimateUsd;
          preface.push(
            `Estimated cost of the debate: ${formatUsd(low)} to ${formatUsd(high)} for one round, billed to the server's API keys.`,
          );
        }
        if (documents.length > 0) preface.push(`Attached: ${documents.map((doc) => doc.name).join(", ")}.`);
        preface.push(...notes);
        const result = await settle(session.id, null, ctx, preface);
        if (!options.demo && config?.live?.estimateUsd) {
          (result.structuredContent as Record<string, unknown>).estimateUsd = config.live.estimateUsd;
        }
        return result;
      }),
  );

  server.registerTool(
    "quorumind_answer",
    {
      title: "Answer Quorumind's questions",
      description:
        "Send the user's answers to the questions Quorumind is waiting on: the interview questions, or the questions the debate paused on. " +
        "Then waits for the next stopping point (more questions, the requirements sheet to review, the verdict, or a failure) and says what to do next.",
      inputSchema: z.object({ session_id: SessionId, answers: Answers }),
    },
    ({ session_id, answers }, ctx) =>
      guarded(async () => {
        const state = await client.getSession(session_id);
        const { session } = state;
        if (state.busy) return refuse(state, "Quorumind is still working on this session: wait for it before answering.");
        if (session.phase === "interview") {
          await client.answerInterview(session_id, resolveQuestions(session, answers));
        } else if (session.phase === "awaiting_answers") {
          await client.answerDebate(session_id, answers);
        } else {
          return refuse(state, "This session is not waiting for answers.");
        }
        return settle(session_id, baselineOf(session), ctx);
      }),
  );

  server.registerTool(
    "quorumind_review",
    {
      title: "Show the requirements sheet",
      description:
        "Show the requirements sheet the interview produced: goals, scope, users, budget, team, constraints and priorities. " +
        "The debate is judged against it, so have the user check it, then call quorumind_confirm (with edits if anything is wrong).",
      inputSchema: z.object({ session_id: SessionId }),
      annotations: { readOnlyHint: true },
    },
    ({ session_id }) =>
      guarded(async () => {
        const state = await client.getSession(session_id);
        const { session } = state;
        if (!session.sheet) return refuse(state, "The interview has not produced a requirements sheet yet.");
        const confirmed = session.sheetConfirmedAt !== null;
        const next = confirmed
          ? "The sheet is already confirmed; the debate uses it."
          : "Next: show it to the user, then call quorumind_confirm, with `edits` (same field names) for anything they correct.";
        return text(`${formatSheet(session.sheet)}\n\n${next}`, {
          sessionId: session.id,
          phase: session.phase,
          confirmed,
          sheet: session.sheet,
        });
      }),
  );

  server.registerTool(
    "quorumind_confirm",
    {
      title: "Confirm the requirements sheet and run the debate",
      description:
        "Confirm the requirements sheet, optionally with corrections, and start the debate: blind proposals, critiques, revisions, then the arbiter's verdict. " +
        "`edits` replaces whole fields of the sheet (a list replaces the list). Waits until the debate needs the user or reaches the verdict; this can take several minutes.",
      inputSchema: z.object({
        session_id: SessionId,
        edits: SheetEdits.optional().describe("Fields to change, named as in quorumind_review. Omit to confirm the sheet as it is."),
      }),
    },
    ({ session_id, edits }, ctx) =>
      guarded(async () => {
        const state = await client.getSession(session_id);
        const { session } = state;
        if (state.busy || session.phase !== "review" || !session.sheet) {
          return refuse(state, "There is no requirements sheet waiting for confirmation.");
        }
        const sheet = { ...session.sheet, ...(edits ?? {}) } as RequirementsSheet;
        await client.confirmSheet(session_id, sheet);
        const changed = Object.keys(edits ?? {});
        const preface = [changed.length > 0 ? `Sheet confirmed with changes to: ${changed.join(", ")}.` : "Sheet confirmed.", ""];
        return settle(session_id, baselineOf(session), ctx, preface);
      }),
  );

  server.registerTool(
    "quorumind_status",
    {
      title: "Session status",
      description:
        "Where a Quorumind session stands: phase, whether a model is working, cost so far, and what is expected next. " +
        "With wait: true, waits for the next stopping point first: use it after a call that returned 'still running'.",
      inputSchema: z.object({
        session_id: SessionId,
        wait: z.boolean().default(false).describe("Wait until the session needs the user, or is over, before answering."),
      }),
      annotations: { readOnlyHint: true },
    },
    ({ session_id, wait }, ctx) =>
      guarded(async () => {
        const state = await client.getSession(session_id);
        if (wait && !isStoppingPoint(state, null)) return settle(session_id, null, ctx);
        const snap = snapshot(client, state, statusOf(state));
        return text(renderSnapshot(snap, state.session), snap);
      }),
  );

  server.registerTool(
    "quorumind_resume",
    {
      title: "Retry a failed session",
      description:
        "Retry the step a failed session stopped on (a provider error, or the cost cap). Then waits for the next stopping point, like quorumind_answer.",
      inputSchema: z.object({ session_id: SessionId }),
    },
    ({ session_id }, ctx) =>
      guarded(async () => {
        const state = await client.getSession(session_id);
        if (state.session.phase !== "failed") return refuse(state, "Only a failed session can be resumed.");
        await client.resume(session_id);
        return settle(session_id, null, ctx);
      }),
  );

  server.registerTool(
    "quorumind_stop",
    {
      title: "Stop a running session",
      description:
        "Stop a session while the models work on it, when the user asks to: the calls in flight are cancelled and nothing more is spent. " +
        "What is already done is kept, and quorumind_resume continues from where it stopped.",
      inputSchema: z.object({ session_id: SessionId }),
    },
    ({ session_id }) =>
      guarded(async () => {
        const state = await client.getSession(session_id);
        if (!state.busy) return refuse(state, "This session is not running: there is nothing to stop.");
        let session: Session;
        try {
          session = await client.stop(session_id);
        } catch (error) {
          // It reached a stopping point on its own in the meantime.
          if (error instanceof QuorumindError && error.code === "not_running")
            return refuse(await client.getSession(session_id), error.message);
          throw error;
        }
        const stopped = { session, busy: false };
        const snap = snapshot(client, stopped, statusOf(stopped));
        return text(`Stopped.\n\n${renderSnapshot(snap, session)}`, snap);
      }),
  );

  server.registerTool(
    "quorumind_verdict",
    {
      title: "Read the verdict",
      description:
        "Read the outcome of a finished debate. summary: the recommendation, each option's feasibility, risks and roadmap, short. " +
        "markdown: the full decision report. adr: an Architecture Decision Record to commit next to the code.",
      inputSchema: z.object({
        session_id: SessionId,
        format: z.enum(["summary", "markdown", "adr"]).default("summary"),
      }),
      annotations: { readOnlyHint: true },
    },
    ({ session_id, format }) =>
      guarded(async () => {
        const state = await client.getSession(session_id);
        const { session } = state;
        if (session.phase !== "complete" || !session.verdict) return refuse(state, "The verdict is not ready.");
        const snap = snapshot(client, state, "complete");
        const structured = { sessionId: session.id, format, recommendation: snap.recommendation, options: snap.options };
        if (format === "summary") return text(formatVerdictSummary(session), { ...structured, verdict: session.verdict });
        const path = `/api/sessions/${encodeURIComponent(session_id)}/${format === "adr" ? "adr.md" : "report.md"}`;
        try {
          return text(await client.text(path), structured);
        } catch (error) {
          if (format === "adr" && isMissingRoute(error)) {
            return failure("This Quorumind server cannot export an ADR yet: update it, or use format markdown.");
          }
          throw error;
        }
      }),
  );

  server.registerTool(
    "quorumind_handoff",
    {
      title: "Write the hand-off files",
      description:
        "Write the hand-off of a finished debate into a directory, usually the project root: CLAUDE.md, AGENTS.md (instructions for coding agents, from the verdict) and PLAN.md (the roadmap). " +
        "Refuses to replace existing files unless overwrite is true: if the project already has a CLAUDE.md or AGENTS.md, write to another directory and merge by hand.",
      inputSchema: z.object({
        session_id: SessionId,
        directory: z
          .string()
          .min(1)
          .describe("Where to write the files: absolute, or relative to the directory this MCP server runs in. Created if missing."),
        overwrite: z.boolean().default(false).describe("Replace files that already exist."),
      }),
      annotations: { destructiveHint: true },
    },
    ({ session_id, directory, overwrite }) =>
      guarded(async () => {
        const state = await client.getSession(session_id);
        if (state.session.phase !== "complete") return refuse(state, "The hand-off is written from the verdict, which is not ready.");
        let archive: Buffer;
        try {
          archive = await client.bytes(`/api/sessions/${encodeURIComponent(session_id)}/handoff.zip`);
        } catch (error) {
          if (isMissingRoute(error)) return failure("This Quorumind server cannot export a hand-off yet: update it.");
          throw error;
        }
        const files = readZip(archive).filter((entry) => (HANDOFF_FILES as readonly string[]).includes(entry.name));
        if (files.length === 0) return failure("The hand-off archive has none of CLAUDE.md, AGENTS.md or PLAN.md.");
        const target = resolve(cwd, directory);
        if (!overwrite) {
          const existing: string[] = [];
          for (const file of files) {
            if (await exists(join(target, file.name))) existing.push(file.name);
          }
          if (existing.length > 0) {
            return failure(
              `${existing.join(", ")} already exist${existing.length === 1 ? "s" : ""} in ${target}. Nothing was written. ` +
                "Ask the user before calling again with overwrite: true, or write to another directory and merge.",
              { directory: target, existing },
            );
          }
        }
        await mkdir(target, { recursive: true });
        for (const file of files) await writeFile(join(target, file.name), file.data);
        const written = files.map((file) => join(target, file.name));
        return text(
          `Wrote ${written.join(", ")}.\n\nNext: read PLAN.md and follow it; CLAUDE.md and AGENTS.md hold the decisions coding agents must respect.`,
          { directory: target, files: written },
        );
      }),
  );

  server.registerTool(
    "quorumind_sessions",
    {
      title: "Recent sessions",
      description: "List the most recent Quorumind sessions, newest first, with their phase. Use it to find a session id again.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(50).default(10) }),
      annotations: { readOnlyHint: true },
    },
    ({ limit }) =>
      guarded(async () => {
        const sessions = (await client.listSessions()).slice(0, limit);
        if (sessions.length === 0) return text("No session yet. Start one with quorumind_start.", { sessions });
        const by = (item: (typeof sessions)[number]) =>
          item.mine === false ? ` (by ${item.author?.name ?? item.author?.email ?? "a former member"})` : "";
        const lines = sessions.map(
          (item) => `- \`${item.id}\` ${item.phase}, ${item.updatedAt.slice(0, 16).replace("T", " ")}: ${item.idea}${by(item)}`,
        );
        return text(lines.join("\n"), { sessions });
      }),
  );

  server.registerResource(
    "session-report",
    new ResourceTemplate("quorumind://sessions/{id}/report", {
      list: async () => {
        const sessions = await client.listSessions().catch(() => []);
        return {
          resources: sessions
            .filter((item) => item.phase === "complete")
            .map((item) => ({
              uri: `quorumind://sessions/${item.id}/report`,
              name: `Decision report: ${item.idea}`,
              mimeType: "text/markdown",
            })),
        };
      },
    }),
    { title: "Quorumind decision report", description: "The Markdown decision report of a finished debate.", mimeType: "text/markdown" },
    async (uri, variables) => {
      const id = String(variables.id);
      const report = await client.text(`/api/sessions/${encodeURIComponent(id)}/report.md`);
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: report }] };
    },
  );

  return server;
}

/** Interview answers may name a question by its id: the interviewer reads the question itself. */
function resolveQuestions(session: Session, answers: Answer[]): Answer[] {
  const byId = new Map(interviewQuestions(session).map((question) => [question.id, question.text]));
  return answers.map((item) => ({ question: byId.get(item.question) ?? item.question, answer: item.answer }));
}

/** An older server answers an unknown route with a bare `not_found`, without the message of a missing session. */
const isMissingRoute = (error: unknown) => error instanceof QuorumindError && error.status === 404 && !/session/i.test(error.message);

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );
