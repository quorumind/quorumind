import { inflateRawSync } from "node:zlib";
import { DEMO_LINEUP, providersFor } from "../config.ts";
import { DEMO_IDEA } from "../demo.ts";
import { DebateEngine } from "../engine.ts";
import type { Locale } from "../locales.ts";
import { MockProvider } from "../providers/mock.ts";
import { createSession, type Session } from "../session.ts";

// Helpers of the export tests: open the XML inside a Word document, and a demo session whose verdict was revised once.

/** Reads one entry of a ZIP archive (a .docx), stored or deflated: enough to open the XML Word reads. */
export function readZip(archive: Uint8Array, name: string): string {
  const bytes = Buffer.from(archive);
  let end = bytes.length - 22;
  while (end >= 0 && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("Not a ZIP archive");
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    const method = bytes.readUInt16LE(offset + 10);
    const size = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extra = bytes.readUInt16LE(offset + 30);
    const comment = bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42);
    const entry = bytes.toString("utf8", offset + 46, offset + 46 + nameLength);
    if (entry === name) {
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      const data = bytes.subarray(start, start + size);
      return (method === 8 ? inflateRawSync(data) : data).toString("utf8");
    }
    offset += 46 + nameLength + extra + comment;
  }
  throw new Error(`No ${name} in the archive`);
}

/** The text of every paragraph of a Word document whose style is `style` (Heading1, Title…). */
export function styled(xml: string, style: string): string[] {
  return [...xml.matchAll(/<w:p>(.*?)<\/w:p>/gs)]
    .filter(([paragraph]) => paragraph.includes(`<w:pStyle w:val="${style}"/>`))
    .map(([paragraph]) => [...paragraph.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((match) => match[1]).join(""));
}

/**
 * The demo debate to its verdict, then revised once with the answer to its open question. With `research`, the debate
 * first replays the demo's recorded web research.
 */
export async function revisedDemo(locale: Locale = "en", options: { research?: boolean } = {}): Promise<Session> {
  const lineup = { ...DEMO_LINEUP, devil: { provider: "mock" as const, model: "mock", persona: null } };
  const engine = new DebateEngine(
    {
      ...providersFor({ ...lineup, demo: Boolean(options.research) }, {}, { mockDelayMs: 0 }),
      devil: new MockProvider({ chunkDelayMs: 0 }),
    },
    { emit: () => {}, save: () => {} },
  );
  const session = createSession({
    locale,
    idea: DEMO_IDEA,
    demo: true,
    ...lineup,
    webResearch: options.research ? { maxQueries: 6, budgetUsd: null } : null,
  });
  await engine.startInterview(session);
  await engine.answerInterview(session, [{ question: "Budget?", answer: "€15,000" }]);
  await engine.confirmSheet(session, session.sheet as NonNullable<Session["sheet"]>);
  await engine.runDebate(session);
  while (session.phase === "awaiting_answers") {
    await engine.answerDebate(session, [{ question: "Hosted?", answer: "Yes" }]);
    await engine.runDebate(session);
  }
  await engine.beginRevision(session, {
    reason: "client_answers",
    inputs: {
      facts: [{ question: "Which SMS provider meets the cost assumption?", answer: "Brevo at €0.04", comment: null }],
      note: null,
      questionnaireId: "q",
    },
    by: null,
  });
  await engine.runRevision(session);
  return session;
}
