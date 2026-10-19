import { createHash } from "node:crypto";
import {
  Audience,
  BRAND_NAME_MAX,
  clientProposal,
  currentView,
  isAccent,
  LOGO_MAX_DATA_URL,
  normalizeSession,
  PRINT_SCRIPT,
  parseLogo,
  QUESTIONNAIRE_LIMITS,
  renderAdr,
  renderComparison,
  renderComparisonHtml,
  renderGithubIssues,
  renderHandoff,
  renderHtml,
  renderJiraCsv,
  renderLinearCsv,
  renderProposalHtml,
  reportSlug,
  type Session,
  sessionAtRevision,
  trackerFileName,
  zipFiles,
} from "@quorumind/core";
import { renderDocx, renderProposalDocx } from "@quorumind/core/docx";
import { type Context, Hono } from "hono";
import { z } from "zod";
import type { User } from "./app.ts";
import type { BrandingStore } from "./branding.ts";
import { invalidRequest } from "./errors.ts";

export interface ExportDeps {
  /** The session when it exists and this user may read it. */
  getSession(id: string, user: User | null): Promise<Session | null>;
  /** Whose branding to use: each account of the hosted version has its own. */
  ownerOf(user: User | null): string | null;
  branding: BrandingStore;
}

const BrandingInput = z.object({
  name: z
    .string()
    .trim()
    .max(BRAND_NAME_MAX)
    .nullable()
    .transform((value) => value || null),
  logoDataUrl: z
    .string()
    .max(LOGO_MAX_DATA_URL, "The logo must be at most 200 KB once encoded.")
    .nullable()
    .refine((value) => value === null || parseLogo(value) !== null, "The logo must be a PNG, JPEG or SVG image."),
  accent: z
    .string()
    .nullable()
    .refine((value) => value === null || isAccent(value), "The accent must be a color like #2b44c4.")
    .transform((value) => value?.toLowerCase() ?? null),
});

// The report page runs no script but the print call; inline styles and data: images only.
const scriptHash = createHash("sha256").update(PRINT_SCRIPT).digest("base64");
const REPORT_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  `script-src 'sha256-${scriptHash}'`,
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const MIME = {
  csv: "text/csv; charset=utf-8",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  markdown: "text/markdown; charset=utf-8",
  zip: "application/zip",
};

/** ?number=7 numbers an ADR as the seventh of its repository. */
const AdrNumber = z.coerce.number().int().min(1).max(99_999);

/**
 * Downloads of a session's decision (HTML/PDF, Word, ADR, coding-agent hand-off, the roadmap for Jira, Linear and
 * GitHub issues) and the branding settings.
 */
export function exportRoutes(deps: ExportDeps) {
  const app = new Hono<{ Variables: { user: User | null } }>();

  type Ctx = Context<{ Variables: { user: User | null } }>;
  const notFound = (c: Ctx) => c.json({ error: "not_found", message: "This session does not exist." }, 404);
  const noVerdict = (c: Ctx) => c.json({ error: "wrong_phase", message: "The verdict is not ready yet." }, 409);
  // ?revision=N: the session as it stood at an earlier revision of its verdict, or at one of its scenarios; without
  // it, as its current revision shows it.
  const load = async (c: Ctx) => {
    const session = await loadSession(c);
    const revision = c.req.query("revision");
    if (!session) return null;
    return revision ? sessionAtRevision(session, Number(revision)) : currentView(session);
  };
  const loadSession = async (c: Ctx) => {
    const found = await deps.getSession(c.req.param("id") ?? "", c.get("user"));
    return found ? normalizeSession(found) : null;
  };
  const branding = (c: Ctx) => deps.branding.get(deps.ownerOf(c.get("user")));
  const attachment = (c: Ctx, type: string, name: string) => {
    c.header("Content-Type", type);
    c.header("Content-Disposition", `attachment; filename="${name}"`);
    c.header("Cache-Control", "no-store");
  };

  app.get("/api/sessions/:id/report.html", async (c) => {
    const session = await load(c);
    if (!session) return notFound(c);
    const print = c.req.query("print") === "1";
    // ?audience=cto|executive|client: the verdict rewritten for that reader, once it was generated in the app.
    const requested = c.req.query("audience");
    const audience = requested ? Audience.safeParse(requested) : null;
    if (audience && !audience.success) return c.json(invalidRequest(audience.error), 400);
    if (audience?.success && !session.briefs[audience.data]) {
      return c.json({ error: "brief_missing", message: "This reader version has not been written yet." }, 409);
    }
    c.header("Content-Security-Policy", REPORT_CSP);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Cache-Control", "no-store");
    return c.html(renderHtml(session, await branding(c), { print, audience: audience?.success ? audience.data : null }));
  });

  app.get("/api/sessions/:id/report.docx", async (c) => {
    const session = await load(c);
    if (!session) return notFound(c);
    const document = await renderDocx(session, await branding(c));
    attachment(c, MIME.docx, `${reportSlug(session)}-report.docx`);
    return c.body(document as Uint8Array<ArrayBuffer>);
  });

  // The client proposal, to edit and send: Word, or a printable page (?print=1 for the PDF). ?client= names who it
  // is prepared for.
  const proposalOf = (c: Ctx, session: Session) =>
    clientProposal(session, { client: (c.req.query("client") ?? "").trim().slice(0, QUESTIONNAIRE_LIMITS.client) || null });

  app.get("/api/sessions/:id/proposal.docx", async (c) => {
    const session = await load(c);
    if (!session) return notFound(c);
    if (!session.verdict || session.phase !== "complete") return noVerdict(c);
    const document = await renderProposalDocx(proposalOf(c, session), await branding(c));
    attachment(c, MIME.docx, `${reportSlug(session)}-proposal.docx`);
    return c.body(document as Uint8Array<ArrayBuffer>);
  });

  app.get("/api/sessions/:id/proposal.html", async (c) => {
    const session = await load(c);
    if (!session) return notFound(c);
    if (!session.verdict || session.phase !== "complete") return noVerdict(c);
    c.header("Content-Security-Policy", REPORT_CSP);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Cache-Control", "no-store");
    return c.html(renderProposalHtml(proposalOf(c, session), await branding(c), { print: c.req.query("print") === "1" }));
  });

  app.get("/api/sessions/:id/adr.md", async (c) => {
    const session = await load(c);
    if (!session) return notFound(c);
    if (!session.verdict) return noVerdict(c);
    const raw = c.req.query("number");
    const number = raw === undefined ? null : AdrNumber.safeParse(raw);
    if (number && !number.success)
      return c.json({ error: "invalid_request", message: "The ADR number must be a whole number from 1." }, 400);
    const value = number?.success ? number.data : null;
    attachment(c, MIME.markdown, `${String(value ?? 1).padStart(4, "0")}-${reportSlug(session)}.md`);
    return c.body(renderAdr(session, { number: value }));
  });

  // The roadmap for issue trackers: epics and stories for Jira, issues for Linear, issues for GitHub.
  app.get("/api/sessions/:id/jira.csv", async (c) => {
    const session = await load(c);
    if (!session) return notFound(c);
    if (!session.verdict) return noVerdict(c);
    attachment(c, MIME.csv, trackerFileName(session, "jira"));
    return c.body(renderJiraCsv(session));
  });

  app.get("/api/sessions/:id/linear.csv", async (c) => {
    const session = await load(c);
    if (!session) return notFound(c);
    if (!session.verdict) return noVerdict(c);
    attachment(c, MIME.csv, trackerFileName(session, "linear"));
    return c.body(renderLinearCsv(session));
  });

  app.get("/api/sessions/:id/github-issues.zip", async (c) => {
    const session = await load(c);
    if (!session) return notFound(c);
    if (!session.verdict) return noVerdict(c);
    attachment(c, MIME.zip, trackerFileName(session, "github"));
    return c.body(zipFiles(renderGithubIssues(session), new Date(session.updatedAt)) as Uint8Array<ArrayBuffer>);
  });

  app.get("/api/sessions/:id/handoff.zip", async (c) => {
    const session = await load(c);
    if (!session) return notFound(c);
    if (!session.verdict) return noVerdict(c);
    attachment(c, MIME.zip, `${reportSlug(session)}-handoff.zip`);
    return c.body(zipFiles(renderHandoff(session), new Date(session.updatedAt)) as Uint8Array<ArrayBuffer>);
  });

  // Two versions side by side (?a=1&b=3): Markdown, or a printable page (?print=1 for the PDF).
  const ComparedPair = z.object({ a: z.coerce.number().int().min(1), b: z.coerce.number().int().min(1) });
  const missingRevision = (c: Ctx) => c.json({ error: "not_found", message: "There is no such revision." }, 404);

  app.get("/api/sessions/:id/compare.md", async (c) => {
    const session = await loadSession(c);
    if (!session) return notFound(c);
    const pair = ComparedPair.safeParse(c.req.query());
    if (!pair.success) return c.json(invalidRequest(pair.error), 400);
    const markdown = renderComparison(session, pair.data.a, pair.data.b);
    if (!markdown) return missingRevision(c);
    attachment(c, MIME.markdown, `${reportSlug(session)}-comparison-${pair.data.a}-${pair.data.b}.md`);
    return c.body(markdown);
  });

  app.get("/api/sessions/:id/compare.html", async (c) => {
    const session = await loadSession(c);
    if (!session) return notFound(c);
    const pair = ComparedPair.safeParse(c.req.query());
    if (!pair.success) return c.json(invalidRequest(pair.error), 400);
    const page = renderComparisonHtml(session, pair.data.a, pair.data.b, await branding(c), { print: c.req.query("print") === "1" });
    if (!page) return missingRevision(c);
    c.header("Content-Security-Policy", REPORT_CSP);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Cache-Control", "no-store");
    return c.html(page);
  });

  app.get("/api/branding", async (c) => c.json({ branding: await branding(c) }));

  app.put("/api/branding", async (c) => {
    const body = await c.req.json().catch(() => undefined);
    if (body === undefined) return c.json({ error: "invalid_request", message: "The body is not valid JSON." }, 400);
    const parsed = BrandingInput.safeParse(body);
    if (!parsed.success) return c.json(invalidRequest(parsed.error), 400);
    return c.json({ branding: await deps.branding.set(deps.ownerOf(c.get("user")), parsed.data) });
  });

  return app;
}
