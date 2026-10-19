import { access, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type CallToolResult, McpServer, ResourceTemplate, type ServerContext } from "@modelcontextprotocol/server";
import {
  type Answer,
  changeText,
  currentRevision,
  type GithubIssuePlan,
  type RequirementsSheet,
  type ScenarioChange,
  type Session,
  scenariosOf,
} from "@quorumind/core";
import { z } from "zod";
import { AdrError, adrSlug, findAdrTarget, isDirectory, writeAdr } from "./adr.ts";
import { QuorumindClient, QuorumindError, type SessionState } from "./client.ts";
import { ContextFileError, MAX_FILE_CHARS, MAX_FILES, readContextFiles } from "./files.ts";
import {
  formatSheet,
  formatUsd,
  formatVerdictSummary,
  interviewQuestions,
  profileNotice,
  renderSnapshot,
  snapshot,
  statusOf,
} from "./format.ts";
import { checkGithubCli, createGithubIssues, GITHUB_REPO, GithubCliError, type RunCommand, runCommand } from "./github.ts";
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
  /** Runs the GitHub CLI; replaced in tests. */
  run?: RunCommand;
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
    users: z.object({
      launch: z.number().int().min(0).nullable().describe("Expected users at launch; null when unknown."),
      oneYear: z.number().int().min(0).nullable().describe("Expected users after a year; null when unknown."),
      note: z.string(),
    }),
    budget: z.object({
      build: z
        .object({ amount: z.number().min(0), currency: z.string().length(3) })
        .nullable()
        .describe("One-off build budget, ISO currency."),
      run: z
        .object({ amount: z.number().min(0), currency: z.string().length(3), period: z.enum(["month", "year"]) })
        .nullable()
        .describe("Running budget per month or year."),
      note: z.string(),
    }),
    existingInfrastructure: z.array(z.string()),
    team: z.object({ people: z.number().int().min(0).nullable(), skills: z.array(z.string()), note: z.string() }),
    deadline: z.object({
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable()
        .describe("Launch date, YYYY-MM-DD."),
      duration: z.object({ amount: z.number().positive(), unit: z.enum(["week", "month"]) }).nullable(),
      note: z.string(),
    }),
    compliance: z.object({
      gdpr: z.boolean(),
      healthData: z.boolean(),
      paymentCards: z.boolean(),
      accessibility: z.boolean(),
      publicSector: z.boolean(),
    }),
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
    if (error instanceof GithubCliError) {
      const created = error.created.map((issue) => `- ${issue.url} ${issue.title}`).join("\n");
      return failure(created ? `${error.message}\n\nAlready created, do not create them again:\n${created}` : error.message, {
        created: error.created,
      });
    }
    if (error instanceof ContextFileError || error instanceof ZipError || error instanceof AdrError) return failure(error.message);
    throw error;
  }
}

/** The structured changes of a scenario, from the tool's flat arguments. */
function scenarioChanges(input: {
  team_delta?: number | undefined;
  build_budget_percent?: number | undefined;
  run_budget_percent?: number | undefined;
  deadline_delta?: number | undefined;
  deadline_unit: "week" | "month";
  new_constraints: string[];
}): ScenarioChange[] {
  const changes: ScenarioChange[] = [];
  if (input.team_delta) changes.push({ kind: "team", delta: input.team_delta });
  if (input.build_budget_percent) changes.push({ kind: "budget", target: "build", percent: input.build_budget_percent });
  if (input.run_budget_percent) changes.push({ kind: "budget", target: "run", percent: input.run_budget_percent });
  if (input.deadline_delta) changes.push({ kind: "deadline", delta: input.deadline_delta, unit: input.deadline_unit });
  for (const text of input.new_constraints) if (text.trim()) changes.push({ kind: "constraint", text: text.trim() });
  return changes;
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
  const run = options.run ?? runCommand;

  const server = new McpServer(
    { name: "quorumind", version: VERSION },
    {
      instructions:
        "Quorumind makes several AI models debate a software project before it is built, then an arbiter rules. " +
        "Use it before coding anything significant: quorumind_start, relay the interview questions to the user, " +
        "quorumind_answer, quorumind_review and quorumind_confirm the requirements sheet, answer the debate questions, " +
        "then read quorumind_verdict, write the plan with quorumind_handoff and record the decision with quorumind_adr. " +
        "Try variants with quorumind_scenario, compare versions with quorumind_compare, and keep track of decisions with quorumind_decisions and quorumind_approve. " +
        "Each call returns what to do next.",
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
    lines.push(renderSnapshot(snap, state.session, state));
    return text(lines.join("\n"), snap);
  };

  // A request that does not fit where the session stands: say why, and where it stands.
  const refuse = (state: SessionState, preface: string) => {
    const snap = snapshot(client, state, statusOf(state));
    return failure(`${preface}\n\n${renderSnapshot(snap, state.session, state)}`, snap);
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
          .enum(["standard", "express", "challenge", "audit"])
          .optional()
          .describe(
            "standard: the models design competing options. express: five questions and one short round, cheaper. challenge: the models only look for flaws in own_solution. " +
              "audit: the models examine a document a provider sent the user (a quote, a statement of work, an architecture or a technical proposal), given as the first of context_files, against the need that idea states: findings with quoted passages, the price checked, questions to ask the provider.",
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
        alternative: z
          .boolean()
          .optional()
          .describe(
            "Audit mode: also sketch one alternative approach from the need alone, without the document, for comparison. One more model call.",
          ),
      }),
    },
    (input, ctx) =>
      guarded(async () => {
        const mode = input.mode ?? (input.own_solution ? "challenge" : undefined);
        if (mode === "challenge" && !input.own_solution) {
          return failure("Challenge mode needs own_solution: the solution the models should challenge.");
        }
        if (mode === "audit" && !input.context_files?.length) {
          return failure(
            "Audit mode needs context_files: the document to audit first (a text or Markdown copy of the quote or proposal), then any background such as the user's own specification.",
          );
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
          // The first file is the document under audit; the others are background.
          ...(mode === "audit"
            ? { audit: { documentIds: documents.slice(0, 1).map((doc) => doc.id), alternative: input.alternative ?? false } }
            : {}),
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
        if (mode === "audit" && documents[0]) preface.push(`Under audit: ${documents[0].name}.`);
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
        const profile = profileNotice(session);
        return text(`${formatSheet(session.sheet)}\n\n${profile ? `${profile}\n\n` : ""}${next}`, {
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
        ignore_profile: z
          .boolean()
          .optional()
          .describe("True to debate without the organisation profile shown by quorumind_review (its rates and technology rules)."),
      }),
    },
    ({ session_id, edits, ignore_profile }, ctx) =>
      guarded(async () => {
        const state = await client.getSession(session_id);
        const { session } = state;
        if (state.busy || session.phase !== "review" || !session.sheet) {
          return refuse(state, "There is no requirements sheet waiting for confirmation.");
        }
        const sheet = { ...session.sheet, ...(edits ?? {}) } as RequirementsSheet;
        await client.confirmSheet(session_id, sheet, ignore_profile);
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
        return text(renderSnapshot(snap, state.session, state), snap);
      }),
  );

  server.registerTool(
    "quorumind_resume",
    {
      title: "Retry a failed session",
      description:
        "Retry the step a failed session stopped on (a provider error, the cost cap, a stop or a server restart). Then waits for the next stopping point, like quorumind_answer.",
      inputSchema: z.object({
        session_id: SessionId,
        budget_usd: z
          .number()
          .positive()
          .max(1_000)
          .optional()
          .describe("A new cost cap in US dollars, when the cap was reached and the user agrees to raise it. Self-hosted servers only."),
      }),
    },
    ({ session_id, budget_usd }, ctx) =>
      guarded(async () => {
        const state = await client.getSession(session_id);
        if (state.session.phase !== "failed") return refuse(state, "Only a failed session can be resumed.");
        await client.resume(session_id, budget_usd);
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
        if (format === "summary") return text(formatVerdictSummary(session, state), { ...structured, verdict: session.verdict });
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
    "quorumind_adr",
    {
      title: "Record the decision as an ADR in the repository",
      description:
        "Write the decision of a finished debate as an Architecture Decision Record into the repository's ADR folder: the folder named by .adr-dir, " +
        "else the first of docs/adr, docs/decisions, adr and doc/adr that exists (the one with the most records when several do), else docs/adr, created. " +
        "The record is numbered after the highest existing one, with the same number of digits (NNNN-title.md), and never replaces a file.",
      inputSchema: z.object({
        session_id: SessionId,
        repository: z
          .string()
          .min(1)
          .default(".")
          .describe("The repository root: absolute, or relative to the directory this MCP server runs in. Default: that directory."),
        name: z
          .string()
          .trim()
          .min(1)
          .max(80)
          .optional()
          .describe("A few words for the file name, e.g. authentication (gives 0007-authentication.md). Default: the project name."),
      }),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    ({ session_id, repository, name }) =>
      guarded(async () => {
        const state = await client.getSession(session_id);
        if (state.session.phase !== "complete") return refuse(state, "The ADR is written from the verdict, which is not ready.");
        const root = resolve(cwd, repository);
        if (!(await isDirectory(root))) return failure(`${root} is not a directory. Give the root of the repository.`);
        const target = await findAdrTarget(root);
        let record: { data: Buffer; name: string | null };
        try {
          record = await client.file(`/api/sessions/${encodeURIComponent(session_id)}/adr.md?number=${target.number}`);
        } catch (error) {
          if (isMissingRoute(error)) return failure("This Quorumind server cannot export an ADR yet: update it.");
          throw error;
        }
        const served = record.name?.replace(/^\d+-/, "").replace(/\.md$/i, "");
        const slug = adrSlug(name ?? served ?? state.session.sheet?.projectName ?? "decision");
        const path = await writeAdr(target, slug, record.data);
        const where = target.exists
          ? `${target.relativeDirectory}, after ${target.count} existing record${target.count === 1 ? "" : "s"}`
          : `${target.relativeDirectory}, a new folder`;
        return text(
          `Wrote ${path} (ADR ${target.number}, in ${where}).\n\n` +
            "Next: commit it with the code it decides; when a later decision replaces it, mark it superseded instead of deleting it.",
          { path, number: target.number, directory: target.directory, created: !target.exists },
        );
      }),
  );

  server.registerTool(
    "quorumind_issues",
    {
      title: "Turn the roadmap into GitHub issues",
      description:
        "Turn the roadmap of a finished debate into GitHub issues: one issue per step and one tracking issue per phase that lists them, all labelled quorumind. " +
        "print (default) returns a Bash script of `gh issue create` commands to review or run; create runs them with the GitHub CLI (gh) installed and signed in on this machine. " +
        "Quorumind never handles GitHub credentials: gh uses its own sign-in. Ask the user before creating issues.",
      inputSchema: z.object({
        session_id: SessionId,
        action: z.enum(["print", "create"]).default("print"),
        repo: z
          .string()
          .regex(GITHUB_REPO, "owner/name, e.g. octo-org/booking")
          .optional()
          .describe("The repository, as owner/name. Default: the repository of the directory this MCP server runs in."),
      }),
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    ({ session_id, action, repo }) =>
      guarded(async () => {
        const state = await client.getSession(session_id);
        if (state.session.phase !== "complete") return refuse(state, "The issues are written from the verdict, which is not ready.");
        let archive: Buffer;
        try {
          archive = await client.bytes(`/api/sessions/${encodeURIComponent(session_id)}/github-issues.zip`);
        } catch (error) {
          if (isMissingRoute(error)) return failure("This Quorumind server cannot export GitHub issues yet: update it.");
          throw error;
        }
        const entries = readZip(archive);
        const script = entries.find((entry) => entry.name === "create-issues.sh")?.data.toString("utf8");
        const manifest = entries.find((entry) => entry.name === "issues.json")?.data.toString("utf8");
        if (!script || !manifest) return failure("The GitHub issues archive has no create-issues.sh or issues.json.");
        const plan = JSON.parse(manifest) as GithubIssuePlan;
        const count = plan.phases.reduce((total, phase) => total + 1 + phase.steps.length, 0);
        const printed = [
          `${count} issues for ${plan.phases.length} phases. Save this script as create-issues.sh and run it with the GitHub CLI signed in (\`gh auth login\`):`,
          `\`bash create-issues.sh ${repo ?? "owner/repo"}\` (without a repository, it uses the one of the current directory).`,
          "",
          "```bash",
          script.trimEnd(),
          "```",
        ].join("\n");
        if (action === "print") return text(printed, { action, count, script });
        try {
          await checkGithubCli(run, cwd);
        } catch (error) {
          if (error instanceof GithubCliError) return failure(`${error.message}\n\n${printed}`, { action, count, script });
          throw error;
        }
        const created = await createGithubIssues(plan, run, { cwd, repo: repo ?? null });
        const lines = created.map((issue) => `- ${issue.url} ${issue.title}`);
        return text(`Created ${created.length} issues:\n${lines.join("\n")}`, { action, count, created });
      }),
  );

  /** Waits until the revision with this number is made, or failed, or the wait cap is reached. */
  const revisionMade = async (id: string, number: number, ctx: ServerContext) => {
    const deadline = Date.now() + waitMs;
    const pollMs = options.pollMs ?? 1_000;
    for (;;) {
      const state = await client.getSession(id);
      const { session } = state;
      if (session.revisions.some((revision) => revision.number === number)) return { state, outcome: "made" as const };
      if (session.revising?.number === number && session.revising.error) return { state, outcome: "failed" as const };
      if (Date.now() >= deadline || ctx.mcpReq.signal.aborted) return { state, outcome: "timeout" as const };
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  };

  server.registerTool(
    "quorumind_scenario",
    {
      title: "Try a what-if scenario",
      description:
        'From a finished debate, ask "what if": the arbiter rules again on the same options with changed facts, and the budget and deadline checks are computed with the changed numbers. ' +
        "Give the change in plain words (question), as structured changes (team_delta: people added, build_budget_percent / run_budget_percent: -30 for 30% less, deadline_delta with deadline_unit: -2 months for two months earlier, new_constraints), or both. " +
        "The scenario is kept beside the verdict and does not replace it. It is priced like an update of the verdict. Waits for the ruling, then returns the comparison with the version it branched from.",
      inputSchema: z.object({
        session_id: SessionId,
        title: z.string().min(1).max(120).describe('A short name, e.g. "Budget cut".'),
        question: z.string().max(4_000).optional().describe("The what-if in the user's own words."),
        team_delta: z.number().int().min(-1_000).max(1_000).optional(),
        build_budget_percent: z.number().min(-95).max(500).optional(),
        run_budget_percent: z.number().min(-95).max(500).optional(),
        deadline_delta: z.number().int().min(-104).max(104).optional(),
        deadline_unit: z.enum(["week", "month"]).default("month"),
        new_constraints: z.array(z.string().min(1).max(300)).max(5).default([]),
        based_on: z.number().int().min(1).optional().describe("The revision to branch from; the current one by default."),
      }),
    },
    (input, ctx) =>
      guarded(async () => {
        const changes = scenarioChanges(input);
        const question = input.question?.trim() || null;
        const number = await client.createScenario(input.session_id, {
          title: input.title.trim(),
          question,
          changes,
          ...(input.based_on === undefined ? {} : { basedOn: input.based_on }),
        });
        const { state, outcome } = await revisionMade(input.session_id, number, ctx);
        if (outcome === "timeout") {
          return text(`Scenario ${number} is still being ruled on. Call quorumind_scenarios later to find it.`, {
            revision: number,
            status: "working",
          });
        }
        if (outcome === "failed") {
          return failure(
            `Scenario ${number} failed: ${state.session.revising?.error?.message ?? "unknown error"}. The verdict is unchanged.`,
            {
              revision: number,
              status: "failed",
            },
          );
        }
        const made = state.session.revisions.find((revision) => revision.number === number);
        const base = made?.basedOn ?? 1;
        const comparison = await client.text(`/api/sessions/${encodeURIComponent(input.session_id)}/compare.md?a=${base}&b=${number}`);
        const ruling = made?.verdict.speech.trim();
        return text([`Scenario ${number} "${input.title}" is ruled on.`, ruling ? `\n${ruling}\n` : "", comparison].join("\n"), {
          revision: number,
          basedOn: base,
          recommendation: made?.verdict.recommendation.seat ?? null,
        });
      }),
  );

  server.registerTool(
    "quorumind_scenarios",
    {
      title: "List the what-if scenarios",
      description: "List the scenarios of a session with their changes and recommendation, and the revision the session currently shows.",
      inputSchema: z.object({ session_id: SessionId }),
      annotations: { readOnlyHint: true },
    },
    ({ session_id }) =>
      guarded(async () => {
        const { session } = await client.getSession(session_id);
        const current = currentRevision(session)?.number ?? null;
        const scenarios = scenariosOf(session).map((revision) => ({
          number: revision.number,
          title: revision.scenario?.title ?? "",
          basedOn: revision.basedOn,
          changes: (revision.scenario?.changes ?? []).map((change) => changeText(change, "en")),
          question: revision.scenario?.question ?? null,
          recommendation: revision.verdict.recommendation.seat,
          adopted: session.adopted === revision.number,
        }));
        if (scenarios.length === 0) return text("No scenario yet. Try one with quorumind_scenario.", { current, scenarios });
        const lines = scenarios.map(
          (item) =>
            `- ${item.number}. "${item.title}"${item.adopted ? " (adopted)" : ""}, from revision ${item.basedOn}: ${[...item.changes, item.question ?? ""].filter(Boolean).join("; ")}. Recommends ${item.recommendation ? `option ${item.recommendation}` : "no option"}.`,
        );
        return text([`The session shows revision ${current}.`, ...lines].join("\n"), { current, scenarios });
      }),
  );

  server.registerTool(
    "quorumind_compare",
    {
      title: "Compare two versions of the decision",
      description:
        "Two revisions or scenarios of a session side by side, in Markdown: recommendation, requirements, each option's feasibility, scores, costs and budget and deadline checks, compliance, risks. Values that differ are in bold.",
      inputSchema: z.object({
        session_id: SessionId,
        a: z.number().int().min(1).describe("The first revision's number."),
        b: z.number().int().min(1).describe("The second revision's number."),
      }),
      annotations: { readOnlyHint: true },
    },
    ({ session_id, a, b }) =>
      guarded(async () => text(await client.text(`/api/sessions/${encodeURIComponent(session_id)}/compare.md?a=${a}&b=${b}`))),
  );

  server.registerTool(
    "quorumind_decisions",
    {
      title: "The decision register",
      description:
        "List the decisions of the workspace (or of this server): each session that reached a verdict, its recommendation, its status (proposed, approved, rejected, superseded), who approved it and when to revisit it.",
      inputSchema: z.object({
        status: z.enum(["proposed", "approved", "rejected", "superseded"]).optional(),
        mine: z.boolean().default(false).describe("Only the decisions of sessions the user started."),
      }),
      annotations: { readOnlyHint: true },
    },
    ({ status, mine }) =>
      guarded(async () => {
        const decisions = await client.decisions({ ...(status ? { status } : {}), ...(mine ? { author: "me" } : {}) });
        if (decisions.length === 0) return text("No decision matches.", { decisions });
        const lines = decisions.map((item) => {
          const approval = item.approval ? `, approved by ${item.approval.name ?? "someone"} on ${item.approval.at.slice(0, 10)}` : "";
          const review = item.review.on ? `, revisit on ${item.review.on}` : "";
          const choice = item.recommendation ? `option ${item.recommendation.seat} (${item.recommendation.title})` : "no feasible option";
          return `- \`${item.sessionId}\` ${item.title}: ${choice}, ${item.status}${approval}${review}`;
        });
        return text(lines.join("\n"), { decisions });
      }),
  );

  server.registerTool(
    "quorumind_approve",
    {
      title: "Approve a decision",
      description:
        "Record in the decision register that the user approves the version of the decision the session shows (the adopted scenario, or the latest revision). " +
        "Only do this when the user explicitly says they approve. With request_only, ask the people who may approve instead (for a member who may not). " +
        "On a self-hosted server, name is the approver's name to record.",
      inputSchema: z.object({
        session_id: SessionId,
        comment: z.string().max(1_000).optional(),
        name: z.string().max(120).optional(),
        request_only: z.boolean().default(false),
      }),
    },
    ({ session_id, comment, name, request_only }) =>
      guarded(async () => {
        const decision = await client.decide(session_id, request_only ? "request" : "approve", {
          comment: comment?.trim() || null,
          name: name?.trim() || null,
        });
        const message = request_only
          ? "Approval requested: those who may approve the decision were told."
          : `Approved: revision ${decision.approval?.revision ?? decision.revision.number}${decision.approval?.name ? ` by ${decision.approval.name}` : ""}. The report and the ADR now say so.`;
        return text(message, { decision });
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
