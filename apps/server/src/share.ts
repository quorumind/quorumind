import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// A share link can ask for a password. The password is kept as a scrypt hash; once given, the visitor gets an access
// token for a few hours, so the page and its Markdown download do not ask again. The token is signed with the hash:
// it needs no state on the server, works on every instance, and changing the password revokes it.

/** What a share link shows: the decision deliverable only (client), or the whole session (full). */
export type ShareMode = "client" | "full";
export const SHARE_MODES: readonly ShareMode[] = ["client", "full"];

/** How long a new share link works: the default for new links is 30 days. */
export const SHARE_EXPIRIES = { "7d": 7, "30d": 30, never: null } as const;
export type ShareExpiry = keyof typeof SHARE_EXPIRIES;

export const SHARE_PASSWORD = { min: 4, max: 200 } as const;

const SCRYPT = { N: 16_384, r: 8, p: 1, keyLength: 32 } as const;
const ACCESS_HOURS = 12;

function derive(password: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, SCRYPT.keyLength, { N, r, p, maxmem: 64 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/** The hash kept for a share password: scrypt$N$r$p$salt$key, base64url. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [scheme, N, r, p, salt, key] = hash.split("$");
  if (scheme !== "scrypt" || !N || !r || !p || !salt || !key) return false;
  const expected = Buffer.from(key, "base64url");
  const actual = await derive(password, Buffer.from(salt, "base64url"), Number(N), Number(r), Number(p));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const sign = (token: string, hash: string, expires: number) => createHmac("sha256", hash).update(`${token}.${expires}`).digest("base64url");

/** An access token to a protected share link, valid for a few hours. */
export function accessToken(token: string, hash: string, now = Date.now()): { access: string; expiresAt: string } {
  const expires = now + ACCESS_HOURS * 3_600_000;
  return { access: `${expires}.${sign(token, hash, expires)}`, expiresAt: new Date(expires).toISOString() };
}

export function validAccess(access: string | undefined, token: string, hash: string, now = Date.now()): boolean {
  const [expires, signature] = (access ?? "").split(".");
  const until = Number(expires);
  if (!signature || !Number.isFinite(until) || until <= now) return false;
  const expected = Buffer.from(sign(token, hash, until));
  const actual = Buffer.from(signature);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export interface AttemptLimits {
  /** Wrong passwords accepted per key in a window. */
  perWindow: number;
  windowMs: number;
}

/** Password attempts on a share link: per link, and per caller, so guessing takes days rather than seconds. */
export const SHARE_ATTEMPT_LIMITS = {
  link: { perWindow: 20, windowMs: 15 * 60_000 },
  caller: { perWindow: 10, windowMs: 15 * 60_000 },
} as const satisfies Record<string, AttemptLimits>;

/** Counts failed attempts in a sliding window, in memory: enough for one server process. */
export class AttemptLimiter {
  private readonly limits: AttemptLimits;
  private readonly now: () => number;
  private readonly failures = new Map<string, number[]>();

  constructor(limits: AttemptLimits, now: () => number = Date.now) {
    this.limits = limits;
    this.now = now;
  }

  /** False when this key used up its attempts for now. */
  allows(key: string): boolean {
    return this.recent(key).length < this.limits.perWindow;
  }

  fail(key: string) {
    const recent = this.recent(key);
    recent.push(this.now());
    this.failures.set(key, recent);
    if (this.failures.size > 10_000) this.prune();
  }

  private recent(key: string): number[] {
    const now = this.now();
    return (this.failures.get(key) ?? []).filter((time) => now - time < this.limits.windowMs);
  }

  private prune() {
    for (const key of this.failures.keys()) if (this.recent(key).length === 0) this.failures.delete(key);
  }
}
