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

  /** Counts one attempt, failed or not: false, and nothing counted, when this key already used up its attempts. */
  hit(key: string): boolean {
    if (!this.allows(key)) return false;
    this.fail(key);
    return true;
  }

  fail(key: string) {
    const recent = this.recent(key);
    recent.push(this.now());
    this.failures.set(key, recent);
    if (this.failures.size > 10_000) this.prune();
  }

  /** Gives back the latest attempt of this key, one that turned out to be right. */
  refund(key: string) {
    const recent = this.recent(key);
    recent.pop();
    if (recent.length > 0) this.failures.set(key, recent);
    else this.failures.delete(key);
  }

  private recent(key: string): number[] {
    const now = this.now();
    return (this.failures.get(key) ?? []).filter((time) => now - time < this.limits.windowMs);
  }

  private prune() {
    for (const key of this.failures.keys()) if (this.recent(key).length === 0) this.failures.delete(key);
  }
}

/**
 * The password of a protected link (a share link or a questionnaire), checked within the limits per link and per
 * caller. Each attempt counts before the password is checked: guesses sent at the same time all count, where counting
 * the failures once known let every concurrent guess through. A right password gives its attempt back, so a link
 * opened by many people is not locked by their visits.
 */
export class PasswordAttempts {
  private readonly link: AttemptLimiter;
  private readonly caller: AttemptLimiter;

  constructor(limits: { link: AttemptLimits; caller: AttemptLimits } = SHARE_ATTEMPT_LIMITS, now: () => number = Date.now) {
    this.link = new AttemptLimiter(limits.link, now);
    this.caller = new AttemptLimiter(limits.caller, now);
  }

  /** "limited" when the link or the caller used up its attempts for now, nothing checked. */
  async check(link: string, caller: string, password: string, hash: string): Promise<"right" | "wrong" | "limited"> {
    const callerKey = `${link}:${caller}`;
    if (!this.link.allows(link) || !this.caller.allows(callerKey)) return "limited";
    this.link.fail(link);
    this.caller.fail(callerKey);
    if (!(await verifyPassword(password, hash))) return "wrong";
    this.link.refund(link);
    this.caller.refund(callerKey);
    return "right";
  }
}
