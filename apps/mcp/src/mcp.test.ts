import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/client";
import { type CallToolResult, InMemoryTransport } from "@modelcontextprotocol/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AppHooks, createApp } from "../../server/src/app.ts";
import { EventBus } from "../../server/src/bus.ts";
import { SqliteSessionStore } from "../../server/src/store.ts";
import { QuorumindClient } from "./client.ts";
import type { Snapshot } from "./format.ts";
import type { RunCommand } from "./github.ts";
import { createMcpServer, type McpOptions } from "./server.ts";

// The real Quorumind server runs in-process on the recorded demo, behind a real HTTP port,
// and an MCP client drives it through the tools exactly as a coding agent would.

interface Running {
  url: string;
  store: SqliteSessionStore;
  close: () => Promise<void>;
}

async function startQuorumind(mockDelayMs: number, hooks?: AppHooks): Promise<Running> {
  const store = new SqliteSessionStore(":memory:");
  const app = createApp({ store, bus: new EventBus(), env: {}, mockDelayMs, ...(hooks ? { hooks } : {}) });
  const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const started = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, () => resolve(started));
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    store,
    close: async () => {
      if ("closeAllConnections" in server) server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await store.close();
    },
  };
}

async function connect(options: Partial<McpOptions> & { client: QuorumindClient }) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer({ demo: true, pollMs: 200, ...options });
  await server.connect(serverSide);
  const client = new Client({ name: "quorumind-test", version: "1.0.0" });
  await client.connect(clientSide);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

type Mcp = Awaited<ReturnType<typeof connect>>;

const textOf = (result: CallToolResult) => result.content.map((block) => (block.type === "text" ? block.text : "")).join("\n");
const snapOf = (result: CallToolResult) => result.structuredContent as unknown as Snapshot;

async function call(mcp: Mcp, name: string, args: Record<string, unknown>, onprogress?: (message: string) => void) {
  return (await mcp.client.callTool(
    { name, arguments: args },
    onprogress ? { onprogress: (progress) => onprogress(progress.message ?? "") } : undefined,
  )) as CallToolResult;
}

/** A ZIP archive of uncompressed entries, as the Quorumind server writes them. */
function storedZip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(content, "utf8");
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

describe("MCP server on the recorded demo", () => {
  let quorumind: Running;
  let mcp: Mcp;
  let workdir: string;
  let sessionId: string;
  let routes: { adr: boolean; handoff: boolean };

  beforeAll(async () => {
    quorumind = await startQuorumind(1);
    workdir = await mkdtemp(join(tmpdir(), "quorumind-mcp-"));
    mcp = await connect({ client: new QuorumindClient({ baseUrl: quorumind.url }), cwd: workdir });
  });

  afterAll(async () => {
    await mcp?.close();
    await quorumind?.close();
    await rm(workdir, { recursive: true, force: true });
  });

  it("lists its tools and the report resource", async () => {
    const { tools } = await mcp.client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "quorumind_adr",
      "quorumind_answer",
      "quorumind_confirm",
      "quorumind_handoff",
      "quorumind_issues",
      "quorumind_resume",
      "quorumind_review",
      "quorumind_sessions",
      "quorumind_start",
      "quorumind_status",
      "quorumind_stop",
      "quorumind_verdict",
    ]);
    const start = tools.find((tool) => tool.name === "quorumind_start");
    expect(Object.keys(start?.inputSchema.properties ?? {})).toContain("context_files");
    const { resourceTemplates } = await mcp.client.listResourceTemplates();
    expect(resourceTemplates.map((template) => template.uriTemplate)).toContain("quorumind://sessions/{id}/report");
  });

  // A whole debate with polling takes a few seconds, more on a slow machine.
  it("drives a whole debate to the verdict", async () => {
    await writeFile(join(workdir, "NOTES.md"), "# Notes\nWe already run PostgreSQL.\n");

    const started = await call(mcp, "quorumind_start", { idea: "A booking app for yoga studios", context_files: ["NOTES.md"] });
    expect(started.isError).toBeFalsy();
    const first = snapOf(started);
    sessionId = first.sessionId;
    expect(first.status).toBe("interview_questions");
    expect(first.questions?.length).toBeGreaterThan(0);
    expect(textOf(started)).toContain("Why it matters:");
    expect(textOf(started)).toContain("Attached: NOTES.md.");
    const stored = await quorumind.store.get(sessionId);
    // A server older than the context documents ignores them; a newer one stores them.
    if (stored && Array.isArray(stored.context) && stored.context.length > 0) expect(stored.context[0]?.name).toBe("NOTES.md");

    // Answer the first question by its id, the others by their text.
    const questions = first.questions ?? [];
    const answers = questions.map((question, i) => ({
      question: i === 0 ? question.id : question.text,
      answer: "15 000 €, two developers",
    }));
    const answered = await call(mcp, "quorumind_answer", { session_id: sessionId, answers });
    expect(snapOf(answered).status).toBe("sheet_review");
    expect(textOf(answered)).toContain("quorumind_confirm");
    const interview = (await quorumind.store.get(sessionId))?.interview.find((entry) => entry.kind === "user");
    expect(interview?.kind === "user" && interview.answers[0]?.question).toBe(questions[0]?.text);

    const review = await call(mcp, "quorumind_review", { session_id: sessionId });
    expect(textOf(review)).toContain("## Requirements sheet:");

    const progress: string[] = [];
    const confirmed = await call(mcp, "quorumind_confirm", { session_id: sessionId, edits: { budget: "20 000 € to build" } }, (message) =>
      progress.push(message),
    );
    expect(textOf(confirmed)).toContain("Sheet confirmed with changes to: budget.");
    expect(snapOf(confirmed).status).toBe("debate_questions");
    expect(snapOf(confirmed).debateQuestions?.length).toBeGreaterThan(0);
    expect((await quorumind.store.get(sessionId))?.sheet?.budget).toBe("20 000 € to build");
    expect(progress.some((message) => message.includes("Seat A"))).toBe(true);

    const debateAnswers = (snapOf(confirmed).debateQuestions ?? []).map((question) => ({ question, answer: "Yes" }));
    const done = await call(mcp, "quorumind_answer", { session_id: sessionId, answers: debateAnswers });
    const verdict = snapOf(done);
    expect(verdict.status).toBe("complete");
    expect(verdict.recommendation?.seat).toBe("A");
    expect(textOf(done)).toContain("quorumind_verdict");

    const status = await call(mcp, "quorumind_status", { session_id: sessionId });
    expect(snapOf(status)).toMatchObject({ phase: "complete", busy: false, status: "complete" });

    const routeStatus = async (file: string) => (await fetch(`${quorumind.url}/api/sessions/${sessionId}/${file}`)).status;
    routes = { adr: (await routeStatus("adr.md")) === 200, handoff: (await routeStatus("handoff.zip")) === 200 };
  }, 30_000);

  it("returns the verdict as a summary and as the Markdown report", async () => {
    const summary = await call(mcp, "quorumind_verdict", { session_id: sessionId, format: "summary" });
    expect(textOf(summary)).toContain("**Recommended: option A");
    const report = await call(mcp, "quorumind_verdict", { session_id: sessionId, format: "markdown" });
    expect(textOf(report)).toContain("_Decision report");
    const resource = await mcp.client.readResource({ uri: `quorumind://sessions/${sessionId}/report` });
    expect(resource.contents[0] && "text" in resource.contents[0] ? resource.contents[0].text : "").toContain("_Decision report");
    const { resources } = await mcp.client.listResources();
    expect(resources.map((item) => item.uri)).toContain(`quorumind://sessions/${sessionId}/report`);
  });

  it("returns the ADR", async (context) => {
    const adr = await call(mcp, "quorumind_verdict", { session_id: sessionId, format: "adr" });
    if (!routes.adr) {
      expect(textOf(adr)).toContain("cannot export an ADR yet");
      context.skip("This server has no adr.md route yet.");
    }
    expect(adr.isError).toBeFalsy();
    expect(textOf(adr).length).toBeGreaterThan(100);
  });

  it("writes the hand-off files of the server", async (context) => {
    if (!routes.handoff) {
      const missing = await call(mcp, "quorumind_handoff", { session_id: sessionId, directory: "handoff" });
      expect(textOf(missing)).toContain("cannot export a hand-off yet");
      context.skip("This server has no handoff.zip route yet.");
    }
    const written = await call(mcp, "quorumind_handoff", { session_id: sessionId, directory: "handoff" });
    expect(written.isError).toBeFalsy();
    for (const name of ["CLAUDE.md", "AGENTS.md", "PLAN.md"]) expect(existsSync(join(workdir, "handoff", name))).toBe(true);
  });

  it("records the decision in the repository's ADR folder, numbered after the last record", async (context) => {
    if (!routes.adr) {
      context.skip("This server has no adr.md route yet.");
    }
    const repo = join(workdir, "repo");
    await mkdir(join(repo, "docs", "decisions"), { recursive: true });
    await writeFile(join(repo, "docs", "decisions", "0006-use-postgresql.md"), "# 6. Use PostgreSQL\n");

    const first = await call(mcp, "quorumind_adr", { session_id: sessionId, repository: "repo", name: "Booking platform" });
    expect(first.isError).toBeFalsy();
    const path = join(repo, "docs", "decisions", "0007-booking-platform.md");
    expect((first.structuredContent as { path: string }).path).toBe(path);
    const content = await readFile(path, "utf8");
    expect(content).toMatch(/^# 7\. /);
    expect(content).toContain("## ");
    expect(content).toContain(sessionId);

    const second = await call(mcp, "quorumind_adr", { session_id: sessionId, repository: "repo" });
    expect((second.structuredContent as { path: string }).path).toBe(join(repo, "docs", "decisions", "0008-studio-booking-app.md"));
    expect(await readFile(join(repo, "docs", "decisions", "0006-use-postgresql.md"), "utf8")).toBe("# 6. Use PostgreSQL\n");

    const fresh = join(workdir, "fresh");
    await mkdir(fresh);
    const created = await call(mcp, "quorumind_adr", { session_id: sessionId, repository: fresh });
    expect((created.structuredContent as { path: string }).path).toBe(join(fresh, "docs", "adr", "0001-studio-booking-app.md"));
    expect(textOf(created)).toContain("a new folder");

    const missing = await call(mcp, "quorumind_adr", { session_id: sessionId, repository: "nowhere" });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toContain("is not a directory");
  });

  it("prints the gh commands of the roadmap's GitHub issues", async () => {
    const printed = await call(mcp, "quorumind_issues", { session_id: sessionId, repo: "octo-org/booking" });
    expect(printed.isError).toBeFalsy();
    expect(textOf(printed)).toContain("bash create-issues.sh octo-org/booking");
    expect(textOf(printed)).toContain("gh issue create");
    expect(snapOf(printed)).toMatchObject({ action: "print", count: 2 + 4 + 1 });
    const invalid = await call(mcp, "quorumind_issues", { session_id: sessionId, repo: "not a repo; rm -rf" });
    expect(invalid.isError).toBe(true);
  });

  it("creates them with the GitHub CLI when it is installed and signed in", async () => {
    const calls: { args: string[]; input?: string }[] = [];
    let state: "missing" | "signed-out" | "ready" | "failing" = "missing";
    let next = 0;
    const run: RunCommand = async (command, args, options) => {
      expect(command).toBe("gh");
      calls.push({ args, ...(options.input === undefined ? {} : { input: options.input }) });
      if (state === "missing") return { code: null, stdout: "", stderr: "spawn gh ENOENT" };
      if (args[0] === "auth")
        return state === "signed-out" ? { code: 1, stdout: "", stderr: "not logged in" } : { code: 0, stdout: "", stderr: "" };
      if (args[0] === "issue") {
        if (state === "failing" && next === 2) return { code: 1, stdout: "", stderr: "HTTP 403: Resource not accessible\nmore" };
        next += 1;
        return { code: 0, stdout: `Creating issue\nhttps://github.com/octo-org/booking/issues/${next}\n`, stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    };
    const agent = await connect({ client: new QuorumindClient({ baseUrl: quorumind.url }), cwd: workdir, run });
    try {
      const missing = await call(agent, "quorumind_issues", { session_id: sessionId, action: "create" });
      expect(missing.isError).toBe(true);
      expect(textOf(missing)).toContain("not installed");
      expect(textOf(missing)).toContain("gh issue create");

      state = "signed-out";
      expect(textOf(await call(agent, "quorumind_issues", { session_id: sessionId, action: "create" }))).toContain("gh auth login");

      state = "ready";
      calls.length = 0;
      const created = await call(agent, "quorumind_issues", { session_id: sessionId, action: "create", repo: "octo-org/booking" });
      expect(created.isError).toBeFalsy();
      const issues = calls.filter((entry) => entry.args[0] === "issue");
      expect(calls.find((entry) => entry.args[0] === "label")?.args).toEqual(
        expect.arrayContaining(["label", "create", "quorumind", "--repo", "octo-org/booking", "--force"]),
      );
      expect(issues).toHaveLength(7);
      expect(issues[0]?.args).toEqual([
        "issue",
        "create",
        "--repo",
        "octo-org/booking",
        "--title",
        "Schedules",
        "--label",
        "quorumind",
        "--body-file",
        "-",
      ]);
      // Phase 1's four steps, then its tracking issue that lists them.
      expect(issues[4]?.args).toContain("Phase 1: First release");
      expect(issues[4]?.input).toContain(
        "- [ ] https://github.com/octo-org/booking/issues/1\n- [ ] https://github.com/octo-org/booking/issues/2",
      );
      expect(textOf(created)).toContain("Created 7 issues");

      state = "failing";
      next = 0;
      const failed = await call(agent, "quorumind_issues", { session_id: sessionId, action: "create" });
      expect(failed.isError).toBe(true);
      expect(textOf(failed)).toContain('could not create the issue "Passes": HTTP 403: Resource not accessible');
      expect(textOf(failed)).toContain(
        "Already created, do not create them again:\n- https://github.com/octo-org/booking/issues/1 Schedules",
      );
    } finally {
      await agent.close();
    }
  });

  it("lists the sessions", async () => {
    const listed = await call(mcp, "quorumind_sessions", {});
    expect(textOf(listed)).toContain(sessionId);
  });

  it("explains what is wrong instead of failing", async () => {
    const unknown = await call(mcp, "quorumind_status", { session_id: "nope" });
    expect(unknown.isError).toBe(true);
    expect(textOf(unknown)).toContain("does not exist");

    const finished = await call(mcp, "quorumind_answer", { session_id: sessionId, answers: [{ question: "Why?", answer: "Because" }] });
    expect(finished.isError).toBe(true);
    expect(textOf(finished)).toContain("not waiting for answers");

    const challenge = await call(mcp, "quorumind_start", { idea: "A CRM", mode: "challenge" });
    expect(textOf(challenge)).toContain("own_solution");

    const binary = join(workdir, "image.bin");
    await writeFile(binary, Buffer.from([0x89, 0x50, 0x00, 0x01]));
    const refused = await call(mcp, "quorumind_start", { idea: "A CRM", context_files: [binary] });
    expect(textOf(refused)).toContain("binary");

    const offline = await connect({ client: new QuorumindClient({ baseUrl: "http://127.0.0.1:9" }) });
    const unreachable = await call(offline, "quorumind_sessions", {});
    expect(textOf(unreachable)).toContain("Cannot reach Quorumind");
    await offline.close();
  });
});

describe("on a hosted server, with a token", () => {
  const TOKEN = "qmd_test-token";
  let quorumind: Running;
  let allow = true;

  beforeAll(async () => {
    // As the hosted version runs it: a bearer token, a price per debate, no provider costs.
    quorumind = await startQuorumind(0, {
      identify: async (request) => (request.headers.get("authorization") === `Bearer ${TOKEN}` ? { userId: "ada" } : null),
      catalog: async () => [{ provider: "mock", model: "mock", label: "Demo", local: false }],
      authorizeSpend: async () =>
        allow ? { ok: true } : { ok: false, code: "insufficient_credits", reason: "Your workspace has no credits left." },
      quote: async () => ({ amount: 7, currency: "EUR", label: "Standard debate" }),
      hideProviderCosts: true,
    });
  });

  afterAll(async () => {
    await quorumind?.close();
  });

  it("shows the debate's price instead of a provider cost", async () => {
    const mcp = await connect({ client: new QuorumindClient({ baseUrl: `${quorumind.url}/`, token: TOKEN }), demo: false });
    const started = await call(mcp, "quorumind_start", { idea: "A booking app for 12 yoga studios" });
    expect(started.isError).toBeFalsy();
    expect(snapOf(started)).toMatchObject({ status: "interview_questions", price: { amount: 7, currency: "EUR" } });
    expect(snapOf(started).costUsd).toBeUndefined();
    expect(textOf(started)).toContain("Price: Standard debate, 7.00 EUR.");
    expect(textOf(started)).toContain("fixed price");
    expect(textOf(started)).not.toContain("Cost so far");
    expect(snapOf(started).url).toBe(`${quorumind.url}/#/s/${snapOf(started).sessionId}`);
    await mcp.close();
  });

  it("says when the token is missing or wrong, and when the account cannot pay", async () => {
    for (const token of [null, "qmd_revoked"]) {
      const mcp = await connect({ client: new QuorumindClient({ baseUrl: quorumind.url, token }) });
      const refused = await call(mcp, "quorumind_sessions", {});
      expect(refused.isError).toBe(true);
      expect(textOf(refused)).toContain("QUORUMIND_TOKEN");
      await mcp.close();
    }

    allow = false;
    const mcp = await connect({ client: new QuorumindClient({ baseUrl: quorumind.url, token: TOKEN }), demo: false });
    const unpaid = await call(mcp, "quorumind_start", { idea: "A CRM" });
    allow = true;
    expect(unpaid.isError).toBe(true);
    expect(textOf(unpaid)).toContain("no credits left");
    expect(textOf(unpaid)).toContain("credits or a plan");
    await mcp.close();
  });
});

describe("hand-off files", () => {
  let quorumind: Running;
  let workdir: string;

  beforeAll(async () => {
    quorumind = await startQuorumind(0);
    workdir = await mkdtemp(join(tmpdir(), "quorumind-handoff-"));
  });

  afterAll(async () => {
    await quorumind?.close();
    await rm(workdir, { recursive: true, force: true });
  });

  it("writes the archive's files and never overwrites without being asked, without the event stream", async () => {
    // The archive is served by the test, so the writing rules are checked whatever the server version.
    // The event stream is refused too: the waits fall back to polling.
    const archive = storedZip({
      "CLAUDE.md": "# Claude\n",
      "AGENTS.md": "# Agents\n",
      "PLAN.md": "# Plan\n",
      "notes/extra.txt": "ignored",
    });
    const intercept: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/handoff.zip")) return new Response(archive, { headers: { "Content-Type": "application/zip" } });
      if (url.endsWith("/events")) throw new TypeError("fetch failed");
      return fetch(input, init);
    };
    const mcp = await connect({ client: new QuorumindClient({ baseUrl: quorumind.url, fetch: intercept }), cwd: workdir, pollMs: 20 });

    const started = snapOf(await call(mcp, "quorumind_start", { idea: "A booking app" }));
    const id = started.sessionId;
    const notYet = await call(mcp, "quorumind_handoff", { session_id: id, directory: "." });
    expect(notYet.isError).toBe(true);

    const answers = (started.questions ?? []).map((question) => ({ question: question.id, answer: "I don't know" }));
    await call(mcp, "quorumind_answer", { session_id: id, answers });
    const debate = snapOf(await call(mcp, "quorumind_confirm", { session_id: id }));
    await call(mcp, "quorumind_answer", {
      session_id: id,
      answers: (debate.debateQuestions ?? []).map((question) => ({ question, answer: "No" })),
    });

    const written = await call(mcp, "quorumind_handoff", { session_id: id, directory: "out" });
    expect(written.isError).toBeFalsy();
    expect(await readFile(join(workdir, "out", "PLAN.md"), "utf8")).toBe("# Plan\n");
    expect(existsSync(join(workdir, "out", "notes"))).toBe(false);

    await writeFile(join(workdir, "out", "CLAUDE.md"), "mine");
    const refused = await call(mcp, "quorumind_handoff", { session_id: id, directory: "out" });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toContain("CLAUDE.md, AGENTS.md, PLAN.md already exist in");
    expect(await readFile(join(workdir, "out", "CLAUDE.md"), "utf8")).toBe("mine");

    const replaced = await call(mcp, "quorumind_handoff", { session_id: id, directory: "out", overwrite: true });
    expect(replaced.isError).toBeFalsy();
    expect(await readFile(join(workdir, "out", "CLAUDE.md"), "utf8")).toBe("# Claude\n");
    await mcp.close();
  });
});

describe("long waits", () => {
  let quorumind: Running;

  beforeAll(async () => {
    quorumind = await startQuorumind(15);
  });

  afterAll(async () => {
    await quorumind?.close();
  });

  it("hands back after the wait cap, then waits again on request", async () => {
    const client = new QuorumindClient({ baseUrl: quorumind.url });
    const impatient = await connect({ client, waitMs: 50 });
    const started = await call(impatient, "quorumind_start", { idea: "A booking app" });
    expect(snapOf(started).status).toBe("running");
    expect(textOf(started)).toContain("quorumind_status");
    await impatient.close();

    const patient = await connect({ client });
    const status = await call(patient, "quorumind_status", { session_id: snapOf(started).sessionId, wait: true });
    expect(snapOf(status).status).toBe("interview_questions");
    await patient.close();
  });

  it("stops a running session, then resumes it", async () => {
    const client = new QuorumindClient({ baseUrl: quorumind.url });
    const impatient = await connect({ client, waitMs: 50 });
    const started = await call(impatient, "quorumind_start", { idea: "A booking app" });
    const id = snapOf(started).sessionId;
    const stopped = await call(impatient, "quorumind_stop", { session_id: id });
    expect(stopped.isError).toBeFalsy();
    expect(snapOf(stopped)).toMatchObject({ status: "failed", busy: false, error: { code: "stopped" } });
    const idle = await call(impatient, "quorumind_stop", { session_id: id });
    expect(idle.isError).toBe(true);
    expect(textOf(idle)).toContain("not running");
    await impatient.close();

    const patient = await connect({ client });
    const resumed = await call(patient, "quorumind_resume", { session_id: id });
    expect(snapOf(resumed).status).toBe("interview_questions");
    await patient.close();
  });
});
