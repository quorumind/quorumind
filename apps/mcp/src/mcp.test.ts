import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/client";
import { type CallToolResult, InMemoryTransport } from "@modelcontextprotocol/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../server/src/app.ts";
import { EventBus } from "../../server/src/bus.ts";
import { SessionStore } from "../../server/src/store.ts";
import { QuorumindClient } from "./client.ts";
import type { Snapshot } from "./format.ts";
import { createMcpServer, type McpOptions } from "./server.ts";

// The real Quorumind server runs in-process on the recorded demo, behind a real HTTP port,
// and an MCP client drives it through the tools exactly as a coding agent would.

interface Running {
  url: string;
  store: SessionStore;
  close: () => Promise<void>;
}

async function startQuorumind(mockDelayMs: number): Promise<Running> {
  const store = new SessionStore(":memory:");
  const app = createApp({ store, bus: new EventBus(), env: {}, mockDelayMs });
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
      store.close();
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
      "quorumind_answer",
      "quorumind_confirm",
      "quorumind_handoff",
      "quorumind_resume",
      "quorumind_review",
      "quorumind_sessions",
      "quorumind_start",
      "quorumind_status",
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
    const stored = quorumind.store.get(sessionId);
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
    const interview = quorumind.store.get(sessionId)?.interview.find((entry) => entry.kind === "user");
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
    expect(quorumind.store.get(sessionId)?.sheet?.budget).toBe("20 000 € to build");
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
    expect(textOf(report)).toContain("# Decision report");
    const resource = await mcp.client.readResource({ uri: `quorumind://sessions/${sessionId}/report` });
    expect(resource.contents[0] && "text" in resource.contents[0] ? resource.contents[0].text : "").toContain("# Decision report");
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
});
