import type { IncomingMessage } from "node:http";
import type { Context } from "hono";

type Env = Record<string, string | undefined>;

/**
 * How many reverse proxies in front of the server add the address they received to X-Forwarded-For
 * (QUORUMIND_TRUST_PROXY): 0, the default, trusts none and reads the address of the connection.
 */
export function trustedProxies(env: Env): number {
  const hops = Number(env.QUORUMIND_TRUST_PROXY ?? 0);
  return Number.isInteger(hops) && hops > 0 ? Math.min(hops, 16) : 0;
}

/**
 * The address of the client, which the per-caller limits count by. Without trusted proxies, the address of the
 * connection: behind a reverse proxy, that is the proxy's, and every visitor would share one budget. With `hops`
 * trusted proxies, the address the farthest of them received the request from: X-Forwarded-For is read from the right,
 * one entry per trusted proxy, and whatever a client wrote further left is ignored.
 */
export function clientAddress(c: Context, hops: number): string {
  const socket = (c.env as { incoming?: IncomingMessage } | undefined)?.incoming?.socket.remoteAddress ?? "local";
  if (hops === 0) return socket;
  const forwarded = (c.req.header("x-forwarded-for") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  // Nearest first: the proxy that connected, then the address each trusted proxy appended.
  const chain = [socket, ...forwarded.reverse()];
  return chain[Math.min(hops, chain.length - 1)] ?? socket;
}
