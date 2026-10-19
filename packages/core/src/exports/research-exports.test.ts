import { describe, expect, it } from "vitest";
import { DEFAULT_BRANDING } from "../branding.ts";
import { clientDeliverable, clientProposal, renderClientReport } from "../deliverable.ts";
import { renderReport } from "../report.ts";
import { RESEARCH_LABELS } from "../research-labels.ts";
import { renderDocx, renderProposalDocx } from "./docx.ts";
import { renderHtml } from "./html.ts";
import { renderProposalHtml } from "./proposal-html.ts";
import { readZip, revisedDemo } from "./testing.ts";

describe("exports with web research", () => {
  it("the Markdown report numbers the sources, with the day each page was read, and cites them from the claims", async () => {
    const session = await revisedDemo("en", { research: true });
    const report = renderReport(session);
    expect(report).toContain("## Sources");
    expect(report).toContain(
      "4. [Regulation (EU) 2016/679 (General Data Protection Regulation)](<https://eur-lex.europa.eu/eli/reg/2016/679/oj>)",
    );
    expect(report).toContain("retrieved on June 15, 2026");
    expect(report).toContain("PostgreSQL 18, which option A runs on, is supported until November 2030 [2] _(verified)_");
    expect(report).toContain(RESEARCH_LABELS.en.claimsNote);
  });

  it("the HTML report links every source safely and its claims to them", async () => {
    const session = await revisedDemo("fr", { research: true });
    const html = renderHtml(session, DEFAULT_BRANDING, { print: false });
    expect(html).toContain('<li id="source-1"><a href="https://stripe.com/fr/pricing" target="_blank" rel="noopener noreferrer">');
    expect(html).toContain('<sup class="refs">[<a href="#source-2">2</a>]</sup>');
    expect(html).toContain(`<h2>${RESEARCH_LABELS.fr.sources}</h2>`);
    expect(html).toContain("consultée le 15 juin 2026");
  });

  it("the Word report lists the facts and their sources", async () => {
    const xml = readZip(await renderDocx(await revisedDemo("en", { research: true }), DEFAULT_BRANDING), "word/document.xml");
    expect(xml).toContain("Web research");
    expect(xml).toContain("https://www.postgresql.org/support/versioning/");
    expect(xml).toContain("[2]");
  });

  it("the client deliverable and the client proposal carry the facts and their public sources", async () => {
    const session = await revisedDemo("en", { research: true });
    const deliverable = clientDeliverable(session);
    expect(deliverable.research?.sources.map((source) => source.url)).toContain("https://stripe.com/fr/pricing");
    const markdown = renderClientReport(deliverable);
    expect(markdown).toContain("## Web research");
    expect(markdown).toContain("1. [Stripe pricing (France)](<https://stripe.com/fr/pricing>)");

    const proposal = clientProposal(session);
    expect(renderProposalHtml(proposal, DEFAULT_BRANDING, { print: false })).toContain('rel="noopener noreferrer"');
    const xml = readZip(await renderProposalDocx(proposal, DEFAULT_BRANDING), "word/document.xml");
    expect(xml).toContain("https://nodejs.org/en/about/previous-releases");
  });

  it("without research, the documents have no sources and say so in the method box", async () => {
    const session = await revisedDemo("en");
    expect(renderReport(session)).not.toContain("## Sources");
    expect(renderReport(session)).toContain(RESEARCH_LABELS.en.methodOff);
    expect(renderHtml(session, DEFAULT_BRANDING, { print: false })).not.toContain('class="sources"');
    expect(clientDeliverable(session).research).toBeNull();
  });
});
