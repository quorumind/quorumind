import type { IncomingMessage } from "node:http";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { User } from "../app.ts";
import { clientAddress, trustedProxies } from "../caller.ts";
import { invalidRequest } from "../errors.ts";
import { ContextError } from "./errors.ts";
import { extractFile, MAX_FILE_BYTES } from "./file.ts";
import { fetchGithub, parseGithubUrl } from "./github.ts";
import { ImportLimiter } from "./limit.ts";
import { type ImportedDocument, makeDocument } from "./text.ts";
import { allowPrivateFromEnv, type FetchOptions, fetchUrl } from "./url.ts";

/** Pasted text accepted: the document keeps the first MAX_CONTEXT_CHARS characters of it. */
export const MAX_PASTE_CHARS = 1_000_000;

/** Request body limits of the import routes. Multipart adds a little to the file itself. */
export const CONTEXT_BODY_LIMITS = {
  file: MAX_FILE_BYTES + 64 * 1024,
  url: 16 * 1024,
  text: 4 * 1024 * 1024,
} as const;

export interface ContextRouteOptions {
  env?: Record<string, string | undefined>;
  limiter?: ImportLimiter;
  /** Network seams, replaced in tests. */
  fetchOptions?: FetchOptions;
  githubFetch?: typeof fetch;
}

type Env = { Variables: { user: User | null }; Bindings: { incoming?: IncomingMessage } };

const UrlBody = z.object({ url: z.string().trim().min(1).max(2_000) });
const TextBody = z.object({ name: z.string().max(500).default(""), text: z.string().max(MAX_PASTE_CHARS) });

const tooLarge = (c: Context) => c.json({ error: "too_large", message: "The document is too large." }, 413);

/**
 * Import of context documents: an uploaded file, a web page or GitHub repository, or pasted text.
 * Each route answers { document } with the text the session will carry.
 */
export function contextRoutes(options: ContextRouteOptions = {}) {
  const env = options.env ?? process.env;
  const fetchOptions: FetchOptions = { allowPrivate: allowPrivateFromEnv(env), ...options.fetchOptions };
  const limiter = options.limiter ?? new ImportLimiter();
  const app = new Hono<Env>();

  // The signed-in account when there is one, else the client's address: behind a reverse proxy, the one the proxy
  // forwards when QUORUMIND_TRUST_PROXY says how many there are (otherwise every visitor shares the proxy's budget).
  const hops = trustedProxies(env);
  const callerOf = (c: Context<Env>) => c.get("user")?.userId ?? clientAddress(c, hops);
  const done = async (c: Context<Env>, work: () => Promise<ImportedDocument>) => c.json({ document: await limiter.run(callerOf(c), work) });

  app.post("/api/context/file", bodyLimit({ maxSize: CONTEXT_BODY_LIMITS.file, onError: tooLarge }), async (c) => {
    let file: unknown;
    try {
      file = (await c.req.parseBody()).file;
    } catch {
      return c.json({ error: "invalid_request", message: "Send the file as multipart/form-data." }, 400);
    }
    if (!(file instanceof File)) return c.json({ error: "invalid_request", message: 'Attach the file in the "file" field.' }, 400);
    if (file.size > MAX_FILE_BYTES) throw new ContextError("too_large", "The file is larger than 10 MB.");
    return done(c, async () => extractFile(file.name, file.type, new Uint8Array(await file.arrayBuffer())));
  });

  // A web page, a PDF on the web, or a GitHub repository: github.com addresses go through the GitHub API.
  app.post("/api/context/url", bodyLimit({ maxSize: CONTEXT_BODY_LIMITS.url, onError: tooLarge }), async (c) => {
    const { url } = UrlBody.parse(await c.req.json());
    return done(c, () =>
      parseGithubUrl(url)
        ? fetchGithub(url, { token: env.GITHUB_TOKEN || undefined, ...(options.githubFetch ? { fetch: options.githubFetch } : {}) })
        : fetchUrl(url, fetchOptions),
    );
  });

  app.post("/api/context/text", bodyLimit({ maxSize: CONTEXT_BODY_LIMITS.text, onError: tooLarge }), async (c) => {
    const { name, text } = TextBody.parse(await c.req.json());
    return done(c, async () => makeDocument({ kind: "text", name, raw: text, fallbackName: "Text" }));
  });

  app.onError((error, c) => {
    if (error instanceof ContextError) return c.json({ error: error.code, message: error.message }, error.status);
    if (error instanceof z.ZodError) return c.json(invalidRequest(error), 400);
    if (error instanceof SyntaxError) return c.json({ error: "invalid_request", message: "The body is not valid JSON." }, 400);
    console.error(error);
    return c.json({ error: "internal_error", message: "Something went wrong on the server." }, 500);
  });

  return app;
}
