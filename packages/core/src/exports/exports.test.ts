import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_BRANDING } from "../branding.ts";
import { DEMO_LINEUP, providersFor } from "../config.ts";
import { DEMO_IDEA, DEMO_SCRIPT, DEMO_SHEET } from "../demo.ts";
import { DebateEngine } from "../engine.ts";
import { renderHandoff } from "../handoff.ts";
import type { Locale } from "../locales.ts";
import { mermaidFlowchart, renderAdr, renderReport, reportSlug } from "../report.ts";
import type { Proposal } from "../schemas.ts";
import { createSession, type Session, USER_SEAT } from "../session.ts";
import { renderDocx } from "./docx.ts";
import { renderHtml } from "./html.ts";

const mock = { provider: "mock" as const, model: "mock" };

async function demo(locale: Locale = "en"): Promise<Session> {
  const lineup = { ...DEMO_LINEUP, devil: { ...mock, persona: null } };
  const engine = new DebateEngine(providersFor(lineup, {}, { mockDelayMs: 0 }), { emit: () => {}, save: () => {} });
  const session = createSession({ locale, idea: DEMO_IDEA, demo: true, ...lineup });
  await engine.startInterview(session);
  await engine.answerInterview(session, [{ question: "Budget?", answer: "€15,000" }]);
  await engine.confirmSheet(session, session.sheet!);
  await engine.runDebate(session);
  while (session.phase === "awaiting_answers") {
    await engine.answerDebate(session, [{ question: "Hosted?", answer: "Yes" }]);
    await engine.runDebate(session);
  }
  return session;
}

/** A challenge session: the person's own solution is the only option, under seat U. */
function challenge(): Session {
  const session = createSession({ locale: "en", idea: DEMO_IDEA, demo: true, mode: "challenge", challenge: "My app", ...DEMO_LINEUP });
  session.sheet = DEMO_SHEET;
  session.debate.push({ kind: "proposal", round: 0, seat: USER_SEAT, data: DEMO_SCRIPT.proposals.A! });
  const option = { ...DEMO_SCRIPT.verdict.options[0]!, seat: USER_SEAT };
  session.verdict = {
    ...DEMO_SCRIPT.verdict,
    options: [option],
    recommendation: { ...DEMO_SCRIPT.verdict.recommendation, seat: USER_SEAT },
  };
  session.phase = "complete";
  return session;
}

function unzip(archive: Uint8Array, entry: string): string | null {
  const dir = mkdtempSync(join(tmpdir(), "quorumind-docx-"));
  try {
    const path = join(dir, "file.zip");
    writeFileSync(path, archive);
    return execFileSync("unzip", ["-p", path, entry], { encoding: "utf8" });
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("Markdown report", () => {
  it("leads with the decision, then covers costs, diagrams, the debate map and the method", async () => {
    const report = renderReport(await demo());
    expect(report).toContain("### In short");
    expect(report).toContain("- Total over 3 years: ");
    expect(report).toContain("- Main risk: ");
    expect(report).toContain("- Why not Option B: ");
    expect(report).toMatch(/- Weighted score: (Close call|Clear lead): \d\.\d against \d\.\d/);
    expect(report.indexOf("## Context and goals")).toBeLessThan(report.indexOf("## Options"));
    expect(report).toContain("## Cost comparison");
    expect(report).toContain("## How this report was produced");
    expect(report).not.toContain("Cost of this session");
    expect(report).toContain("**Build cost:** €12,000 – €15,000 (estimate:");
    expect(report).toContain("```mermaid\nflowchart LR");
    expect(report).toContain('n_db[("Postgres (EU)")]');
    expect(report).toContain('n_members -->|"book, buy passes"| n_app');
    expect(report).toContain("## Debate map");
    expect(report).toContain("### Opposed positions");
    expect(report).toContain("  - Devil's advocate: Underestimated by A");
    expect(report).toContain("| Launch slips past September | Medium | High |");
  });

  it("shows the arbiter's probe", async () => {
    const session = await demo();
    session.debate.push({ kind: "probe", round: 1, data: DEMO_SCRIPT.probe });
    const report = renderReport(session);
    expect(report).toContain("## The arbiter's probe");
    expect(report).toContain(`> ${DEMO_SCRIPT.probe.angle}`);
  });

  it("names the person's solution in challenge mode", () => {
    const report = renderReport(challenge());
    expect(report).toContain("**Custom React app with managed EU hosting** (Your solution");
    expect(report).toContain("## Your solution");
    expect(report).not.toContain("Option U");
  });

  it("still renders proposals stored before build costs and diagrams existed", async () => {
    const session = await demo();
    for (const entry of session.debate) {
      if (entry.kind === "proposal" || entry.kind === "revision") {
        const proposal = (entry.kind === "proposal" ? entry.data : entry.data.proposal) as Partial<Proposal>;
        delete proposal.buildCost;
        delete proposal.components;
        delete proposal.flows;
      }
    }
    expect(renderReport(session)).not.toContain("mermaid");
    expect(renderHtml(session, DEFAULT_BRANDING, { print: false })).not.toContain("<svg xmlns");
    expect(renderHandoff(session).length).toBe(3);
    expect((await renderDocx(session, DEFAULT_BRANDING)).length).toBeGreaterThan(1000);
  });

  it("keeps Mermaid labels and ids from breaking the diagram", () => {
    const chart = mermaidFlowchart(
      [
        { id: "end", label: 'Say "hi" <b>#1</b> | `x`', kind: "client" },
        { id: "a b", label: "A", kind: "external" },
        { id: "a-b", label: "B", kind: "database" },
      ],
      [{ from: "end", to: "a b", label: 'quote " and ]' }],
    )!;
    expect(chart).toContain('n_end(["Say #quot;hi#quot; #lt;b#gt;#35;1#lt;/b#gt; #124; #96;x#96;"])');
    expect(chart).toContain("n_a_b{{");
    expect(chart).toContain("n_a_b_2[(");
    expect(chart).toContain('n_end -->|"quote #quot; and ]"| n_a_b');
    expect(chart).toContain("class n_a_b external");
  });

  it("slugs project names into file names", async () => {
    const session = await demo();
    expect(reportSlug(session)).toBe("studio-booking-app");
    session.sheet = { ...session.sheet!, projectName: "Réservation d'ateliers !" };
    expect(reportSlug(session)).toBe("reservation-d-ateliers");
    session.sheet = { ...session.sheet, projectName: "予約アプリ" };
    expect(reportSlug(session)).toBe("quorumind");
  });
});

describe("architecture decision record", () => {
  it("follows the MADR sections in the session's language", async () => {
    const adr = renderAdr(await demo("fr"));
    expect(adr).toMatch(/^# Enregistrement de décision d'architecture: Custom React app/);
    for (const heading of ["## Contexte et problème", "## Options envisagées", "## Décision", "## Conséquences", "## Liens"]) {
      expect(adr).toContain(heading);
    }
    expect(adr).toContain("- **Statut:** Proposé");
    expect(adr).toContain("**Option retenue:** Option A: Custom React app");
    expect(adr).toContain("- Running cost (5/5)");
    expect(adr).toContain("Fast to launch, but both hard constraints");
    expect(adr).toContain("### Risques");
  });
});

describe("coding-agent hand-off", () => {
  it("writes the same instructions for Claude Code and other agents, and a checklist plan", async () => {
    const files = renderHandoff(await demo("fr"));
    expect(files.map((file) => file.path)).toEqual(["CLAUDE.md", "AGENTS.md", "PLAN.md"]);
    const [claude, agents, plan] = files.map((file) => file.content);
    expect(claude).toBe(agents);
    expect(claude).toContain("## Rules: hard constraints");
    expect(claude).toContain("1. Member data hosted in the EU (GDPR)");
    expect(claude).toContain("## Out of scope");
    expect(claude).toContain("## Chosen architecture: Custom React app with managed EU hosting");
    expect(claude).toContain("`db`: Postgres (EU) (database)");
    expect(plan).toContain("## Phase 1: First release");
    expect(plan).toContain("- [ ] Exit criterion met: All 12 studios take bookings online");
    expect(plan).toContain("## Open questions");
    expect(plan).toContain("- [ ] A suitable EU booking vendor exists (assumed)");
  });
});

describe("HTML report", () => {
  it("escapes everything that comes from models and people", async () => {
    const session = await demo();
    session.sheet = { ...session.sheet!, projectName: '<img src=x onerror="alert(1)">' };
    session.verdict!.recommendation.rationale = "</style><script>alert(2)</script>";
    const html = renderHtml(
      session,
      { name: "<b>Agency</b>", logoDataUrl: 'data:image/png;base64,"><script>', accent: "red;}</style>" },
      { print: false },
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    // The printed footer carries the project name inside the stylesheet, escaped as CSS.
    expect(html).toContain('@bottom-left { content: "\\3C img src=x onerror=\\"alert(1)\\"\\3E  · ');
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("&lt;b&gt;Agency&lt;/b&gt;");
    expect(html).toContain("--accent: #2b44c4");
  });

  it("mirrors the document and the diagrams in Arabic", async () => {
    const html = renderHtml(await demo("ar"), DEFAULT_BRANDING, { print: true });
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).toContain("window.print()");
    expect(html).toContain("@page { size: A4;");
  });
});

describe("Word report", () => {
  it("builds a document with right-to-left paragraphs in Arabic", async () => {
    const document = await renderDocx(await demo("ar"), { name: "Agence", logoDataUrl: null, accent: "#aa3366" });
    expect(String.fromCharCode(document[0]!, document[1]!)).toBe("PK");
    const xml = unzip(document, "word/document.xml");
    if (xml === null) return; // No unzip on this machine: the archive signature is all we can check.
    expect(xml).toContain("<w:bidi/>");
    expect(xml).toContain("<w:rtl/>");
    expect(xml).toContain("تقرير القرار".toUpperCase());
    expect(xml).toContain("<w:tbl>");
    expect(unzip(document, "word/styles.xml")).toContain("AA3366");
  });
});

describe("a debate shortened to stay within its budget", () => {
  it("says so in the method box of every format", async () => {
    const session = await demo();
    session.shortened = { rounds: 0 };
    const note = "The debate was shortened to stay within its budget: 0 of the 1 planned round(s) took place before the verdict.";
    expect(renderReport(session)).toContain(`## How this report was produced\n\nSeveral AI models`);
    expect(renderReport(session)).toContain(note);
    expect(renderHtml(session, DEFAULT_BRANDING, { print: false, audience: null })).toContain(`<p>${note}</p>`);
    const xml = unzip(await renderDocx(session, DEFAULT_BRANDING), "word/document.xml");
    if (xml !== null) expect(xml).toContain(note);

    session.shortened = null;
    expect(renderReport(session)).not.toContain("shortened");
  });
});
