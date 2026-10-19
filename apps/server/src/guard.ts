import type { Context, MiddlewareHandler } from "hono";

// A self-hosted server without sign-in trusts whoever reaches it, which SECURITY.md keeps to the machine (localhost)
// or to a network the owner controls. Two attacks reach such a server from the browser of its owner anyway:
// - cross-site requests: any page can POST to http://127.0.0.1:8787 with a "simple" request (a form, or a fetch in
//   no-cors mode with text/plain), which needs no CORS preflight, to start debates on the owner's API keys;
// - DNS rebinding: a page whose host name later resolves to 127.0.0.1 becomes same-origin with the server and can read
//   everything it serves (GET /api/export).
// The guard refuses requests for a host name the server does not answer for, state-changing requests from another
// site, and bodies that are neither JSON nor, for the file upload, multipart.

type Env = Record<string, string | undefined>;

/** The host names a self-hosted server answers for, or null when the owner allowed any (QUORUMIND_ALLOWED_HOSTS=*). */
export function allowedHosts(env: Env, publicUrl: string | null): Set<string> | null {
  const listed = (env.QUORUMIND_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (listed.includes("*")) return null;
  const hosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  for (const entry of [...listed, publicUrl ?? ""]) {
    const host = hostOf(entry);
    if (host) hosts.add(host);
  }
  return hosts;
}

/** The host name of a URL or of a host[:port] entry, lower case, IPv6 in brackets as URLs write it. */
function hostOf(entry: string): string | null {
  if (!entry) return null;
  try {
    return new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(entry) ? entry : `http://${entry}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Routes that take a multipart upload rather than JSON. */
const MULTIPART_ROUTES = new Set(["/api/context/file"]);

const refuse = (c: Context, status: 403 | 415, error: string, message: string) => c.json({ error, message }, status);

/** The protection of a server without sign-in (AppHooks.identify unset). */
export function localGuard(env: Env, publicUrl: string | null): MiddlewareHandler {
  const hosts = allowedHosts(env, publicUrl);
  const known = (host: string | null) => host !== null && (hosts === null || hosts.has(host));
  return async (c, next) => {
    const url = new URL(c.req.url);
    if (!known(url.hostname.toLowerCase())) {
      return refuse(c, 403, "forbidden_host", `This server does not answer for ${url.hostname}: add it to QUORUMIND_ALLOWED_HOSTS.`);
    }
    if (SAFE_METHODS.has(c.req.method)) return next();
    // Browsers send Origin with every cross-origin request that changes something; older ones may send Referer only.
    const origin = c.req.header("origin");
    const sameSite = (value: string) => {
      let from: URL;
      try {
        from = new URL(value);
      } catch {
        return false;
      }
      // Its own address, or a host name it answers for (the development server runs on another port).
      return from.host === url.host || (hosts?.has(from.hostname.toLowerCase()) ?? false);
    };
    const crossSite =
      origin !== undefined
        ? origin === "null" || !sameSite(origin)
        : c.req.header("sec-fetch-site") === "cross-site" ||
          (c.req.header("referer") !== undefined && !sameSite(c.req.header("referer") ?? ""));
    if (crossSite) return refuse(c, 403, "cross_site", "This request comes from another site.");
    const type = (c.req.header("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    const hasBody = Number(c.req.header("content-length") ?? 0) > 0 || c.req.header("transfer-encoding") !== undefined;
    const expected = MULTIPART_ROUTES.has(c.req.path) ? "multipart/form-data" : "application/json";
    if (type ? type !== expected : hasBody) {
      return refuse(c, 415, "unsupported_media_type", `Send the body as ${expected}.`);
    }
    return next();
  };
}

/** Headers every response of the self-hosted server carries: no framing (clickjacking), no type sniffing. */
export const securityHeaders: MiddlewareHandler = async (c, next) => {
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Content-Security-Policy", "frame-ancestors 'none'");
  c.header("Referrer-Policy", "same-origin");
  await next();
};
