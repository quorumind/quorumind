import { createHash } from "node:crypto";
import {
  Audience,
  BRAND_NAME_MAX,
  isAccent,
  LOGO_MAX_DATA_URL,
  normalizeSession,
  PRINT_SCRIPT,
  parseLogo,
  renderAdr,
  renderHandoff,
  renderHtml,
  reportSlug,
  type Session,
  zipFiles,
} from "@quorumind/core";
import { renderDocx } from "@quorumind/core/docx";
import { type Context, Hono } from "hono";
import { z } from "zod";
import type { User } from "./app.ts";
import type { BrandingStore } from "./branding.ts";

export interface ExportDeps {
  /** The session when it exists and belongs to this user. */
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
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  markdown: "text/markdown; charset=utf-8",
  zip: "application/zip",
};

/** Downloads of a session's decision (HTML/PDF, Word, ADR, coding-agent hand-off) and the branding settings. */
export function exportRoutes(deps: ExportDeps) {
  const app = new Hono<{ Variables: { user: User | null } }>();

  type Ctx = Context<{ Variables: { user: User | null } }>;
  const notFound = (c: Ctx) => c.json({ error: "not_found", message: "This session does not exist." }, 404);
  const noVerdict = (c: Ctx) => c.json({ error: "invalid_state", message: "The verdict is not ready yet." }, 409);
  const load = async (c: Ctx) => {
    const session = await deps.getSession(c.req.param("id") ?? "", c.get("user"));
    return session ? normalizeSession(session) : null;
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
    if (audience && !audience.success) return c.json({ error: "invalid_request", message: "Unknown audience." }, 400);
    if (audience?.success && !session.briefs[audience.data]) {
      return c.json({ error: "invalid_state", message: "This reader version has not been written yet." }, 409);
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

  app.get("/api/sessions/:id/adr.md", async (c) => {
    const session = await load(c);
    if (!session) return notFound(c);
    if (!session.verdict) return noVerdict(c);
    attachment(c, MIME.markdown, `0001-${reportSlug(session)}.md`);
    return c.body(renderAdr(session));
  });

  app.get("/api/sessions/:id/handoff.zip", async (c) => {
    const session = await load(c);
    if (!session) return notFound(c);
    if (!session.verdict) return noVerdict(c);
    attachment(c, MIME.zip, `${reportSlug(session)}-handoff.zip`);
    return c.body(zipFiles(renderHandoff(session), new Date(session.updatedAt)) as Uint8Array<ArrayBuffer>);
  });

  app.get("/api/branding", async (c) => c.json({ branding: await branding(c) }));

  app.put("/api/branding", async (c) => {
    const body = await c.req.json().catch(() => undefined);
    if (body === undefined) return c.json({ error: "invalid_request", message: "The body is not valid JSON." }, 400);
    const parsed = BrandingInput.safeParse(body);
    if (!parsed.success) return c.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    return c.json({ branding: await deps.branding.set(deps.ownerOf(c.get("user")), parsed.data) });
  });

  return app;
}
