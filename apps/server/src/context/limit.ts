import { ContextError } from "./errors.ts";

export interface ImportLimits {
  /** Imports one caller may start per window. */
  perWindow: number;
  windowMs: number;
  /** Imports one caller may run at the same time: each one fetches or parses a document. */
  concurrent: number;
}

export const IMPORT_LIMITS: ImportLimits = { perWindow: 30, windowMs: 10 * 60_000, concurrent: 3 };

/**
 * Throttles document imports per caller, in memory: a sliding window of start times and a count of
 * imports still running. Enough for one server process; the hosted version can add its own limits.
 */
export class ImportLimiter {
  private readonly limits: ImportLimits;
  private readonly now: () => number;
  private readonly starts = new Map<string, number[]>();
  private readonly running = new Map<string, number>();

  constructor(limits: ImportLimits = IMPORT_LIMITS, now: () => number = Date.now) {
    this.limits = limits;
    this.now = now;
  }

  /** Runs one import for this caller, or refuses it with "too_many_imports". */
  async run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const now = this.now();
    const recent = (this.starts.get(key) ?? []).filter((time) => now - time < this.limits.windowMs);
    const running = this.running.get(key) ?? 0;
    if (recent.length >= this.limits.perWindow || running >= this.limits.concurrent) {
      this.starts.set(key, recent);
      throw new ContextError("too_many_imports", "Too many documents imported in a short time. Wait a few minutes and try again.");
    }
    recent.push(now);
    this.starts.set(key, recent);
    this.running.set(key, running + 1);
    try {
      return await work();
    } finally {
      const left = (this.running.get(key) ?? 1) - 1;
      if (left > 0) this.running.set(key, left);
      else this.running.delete(key);
      this.prune(now);
    }
  }

  /** Forgets callers whose window has passed, so the maps do not grow with every visitor. */
  private prune(now: number) {
    if (this.starts.size < 1_000) return;
    for (const [key, times] of this.starts) {
      if (!this.running.has(key) && times.every((time) => now - time >= this.limits.windowMs)) this.starts.delete(key);
    }
  }
}
