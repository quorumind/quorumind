import { describe, expect, it } from "vitest";
import { clientProposal } from "../deliverable.ts";
import { questionnaireFacts, questionsFromVerdict } from "../questionnaire.ts";
import { renderProposalDocx, renderQuestionnaireDocx } from "./docx.ts";
import { renderProposalHtml } from "./proposal-html.ts";
import { readZip, revisedDemo as revised, styled } from "./testing.ts";

const AGENCY = { name: "Atelier Nord", logoDataUrl: null, accent: "#aa3366" };

describe("client proposal", () => {
  it("is built from an allowlist: no transcript, critiques, models, provider costs or internal notes", async () => {
    const session = await revised();
    session.revisions[1]!.inputs.note = "Internal: the client is price sensitive";
    const proposal = clientProposal(session, { client: "Studio Collective" });
    const text = JSON.stringify(proposal);
    for (const secret of [
      "Internal: the client",
      session.revisions[1]!.critiques[0]?.data.critiques[0]?.argument ?? "unreachable",
      '"mock"',
      "costUsd",
      "usage",
      "devil",
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(proposal.client).toBe("Studio Collective");
    expect(proposal.revision?.number).toBe(2);
    expect(proposal.solution?.seat).toBe("A");
    expect(proposal.solution?.monthlyCost).toMatchObject({ low: 140, high: 220 });
    expect(proposal.alternatives.map((item) => item.seat)).toEqual(["B"]);
    expect(proposal.openQuestions).toEqual([]);
    expect(proposal.exclusions).toEqual(expect.arrayContaining([...session.sheet!.outOfScope, ...proposal.costing!.exclusions]));
    expect(proposal.costing?.packages.length).toBeGreaterThan(0);
    expect(proposal.solution?.buildCost).toEqual({ ...proposal.costing?.total, currency: "EUR" });
  });

  it("is a Word document with a cover page, real headings, lists and tables, and no image of text", async () => {
    const session = await revised();
    session.revisions[1]!.verdict.openQuestions = ["Who signs off the first release?"];
    const document = await renderProposalDocx(clientProposal(session, { client: "Studio Collective" }), AGENCY);
    const xml = readZip(document, "word/document.xml");
    expect(styled(xml, "Title")).toEqual([session.sheet!.projectName]);
    expect(styled(xml, "Heading1")).toEqual([
      "Your project as we understand it",
      "Recommended solution",
      "Costing",
      "Alternatives considered",
      "Risks and mitigations",
      "Roadmap",
      "Assumptions and exclusions",
      "Points to confirm together",
    ]);
    expect(styled(xml, "Heading2")).toEqual(expect.arrayContaining(["Goals", "Scope", "Assumptions", "Not included"]));
    expect(xml).toContain('<w:br w:type="page"/>');
    expect(xml).toContain("Prepared for: </w:t>");
    expect(xml).toContain("Studio Collective");
    expect(xml).toContain("Atelier Nord");
    expect(xml).toMatch(/Revision 2 · \w+ \d+, \d{4}/);
    expect(xml.match(/<w:tbl>/g)).toHaveLength(2);
    expect(xml).toContain("<w:numPr>");
    expect(xml).not.toContain("<w:drawing>");
    for (const internal of ["Devil", "Proposer", "Debate map", "mock", "How this report was produced", "Option A"]) {
      expect(xml).not.toContain(internal);
    }
    const styles = readZip(document, "word/styles.xml");
    expect(styles).toContain("AA3366");
    expect(readZip(document, "word/footer1.xml")).toContain("Atelier Nord · Revision 2");
  });

  it("puts the agency's logo on the cover with a text alternative", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwHwQZGBgAJ+wE/MCzNd0AAAAASUVORK5CYII=",
      "base64",
    );
    const branding = { ...AGENCY, logoDataUrl: `data:image/png;base64,${png.toString("base64")}` };
    const xml = readZip(await renderProposalDocx(clientProposal(await revised()), branding), "word/document.xml");
    expect(xml).toContain("<w:drawing>");
    expect(xml).toContain('descr="Atelier Nord"');
  });

  it("shows the recommended solution's work packages, days and amounts, never the day rates", async () => {
    const session = await revised();
    const proposal = clientProposal(session);
    const costing = proposal.costing!;
    const xml = readZip(await renderProposalDocx(proposal, AGENCY), "word/document.xml");
    expect(xml).toContain("Person-days");
    for (const item of costing.packages) expect(xml).toContain(item.name);
    const html = renderProposalHtml(proposal, AGENCY, { print: false });
    expect(html).toContain("<h2>Costing</h2>");
    expect(html).toContain(costing.packages[0]!.name);
    for (const text of [xml, html]) {
      expect(text).not.toContain("Day rate");
      expect(text).not.toContain("dailyRate");
    }
    // An option without work packages has no costing section.
    const without = renderProposalHtml({ ...proposal, costing: null }, AGENCY, { print: false });
    expect(without).not.toContain("<h2>Costing</h2>");
  });

  it("is a printable page in the agency's colors, right to left in Arabic, with every text escaped", async () => {
    const session = await revised("ar");
    session.sheet!.projectName = "<script>alert(1)</script>";
    const html = renderProposalHtml(clientProposal(session, { client: "Fatima & Co" }), AGENCY, { print: true });
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).toContain("--accent: #aa3366;");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("Fatima &amp; Co");
    expect(html).toContain("window.print()");
    expect(html).toContain("<h2>الحل الموصى به</h2>");
  });
});

describe("questionnaire document", () => {
  it("leaves room to answer each question in a table", async () => {
    const session = await revised();
    const questions = [
      ...questionsFromVerdict(session.revisions[0]!.verdict),
      { id: "extra", text: "Who approves the budget?", why: "We need one decision maker.", origin: "agency" as const },
    ];
    const document = await renderQuestionnaireDocx(
      {
        locale: "en",
        project: session.sheet!.projectName,
        client: "Studio Collective",
        message: null,
        questions,
        answers: [],
        status: "open",
        submittedAt: null,
        expiresAt: "2026-11-18T10:00:00.000Z",
      },
      AGENCY,
      { url: "https://app.example.com/#/q/token" },
    );
    const xml = readZip(document, "word/document.xml");
    expect(styled(xml, "Title")).toEqual([`Questions about ${session.sheet!.projectName}`]);
    expect(styled(xml, "Heading2")).toEqual(["Question 1", "Question 2"]);
    expect(xml.match(/<w:tbl>/g)).toHaveLength(2);
    expect(xml).toContain("Why we ask: We need one decision maker.");
    expect(xml).toContain("Please reply by November 18, 2026.");
    expect(xml).toContain("https://app.example.com/#/q/token");
  });

  it("turns answers into the facts of a revision, skipping the unanswered", () => {
    const questions = [
      { id: "a", text: "Budget?", why: null, origin: "agency" as const },
      { id: "b", text: "Deadline?", why: null, origin: "agency" as const },
      { id: "c", text: "Users?", why: null, origin: "agency" as const },
    ];
    const facts = questionnaireFacts({
      questions,
      answers: [
        { questionId: "a", answer: " €20k ", comment: null },
        { questionId: "b", answer: "", comment: "  " },
        { questionId: "c", answer: "", comment: "We do not know yet" },
      ],
    });
    expect(facts).toEqual([
      { question: "Budget?", answer: "€20k", comment: null },
      { question: "Users?", answer: "", comment: "We do not know yet" },
    ]);
  });
});
