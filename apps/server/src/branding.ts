import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type Branding, DEFAULT_BRANDING } from "@quorumind/core";

export type { Branding };

/**
 * The white-label branding of the exports. Self-hosted, there is one branding (owner null); the hosted version
 * keeps one per account.
 */
export interface BrandingStore {
  get(owner?: string | null): Promise<Branding>;
  /** Stores branding that was already validated by the caller. */
  set(owner: string | null, branding: Branding): Promise<Branding>;
  /** Forgets an account's branding, when the account is deleted. */
  delete(owner: string | null): Promise<void>;
  close(): Promise<void>;
}

/**
 * The branding in a key-value `settings` table of SQLite. It lives in the sessions' SQLite file: pass that
 * database, or its path to open a second connection on it.
 */
export class SqliteBrandingStore implements BrandingStore {
  private readonly db: DatabaseSync;
  private readonly owned: boolean;

  constructor(source: DatabaseSync | string) {
    if (typeof source === "string") {
      if (source !== ":memory:") mkdirSync(dirname(source), { recursive: true });
      this.db = new DatabaseSync(source);
      this.owned = true;
      // Another connection (the session store) writes to the same file.
      this.db.exec("PRAGMA busy_timeout = 2000");
    } else {
      this.db = source;
      this.owned = false;
    }
    this.db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  }

  async get(owner: string | null = null): Promise<Branding> {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(brandingKey(owner)) as { value: string } | undefined;
    if (!row) return { ...DEFAULT_BRANDING };
    try {
      return withDefaults(JSON.parse(row.value));
    } catch {
      return { ...DEFAULT_BRANDING };
    }
  }

  async set(owner: string | null, branding: Branding): Promise<Branding> {
    const value = brandingValue(branding);
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(brandingKey(owner), JSON.stringify(value));
    return value;
  }

  async delete(owner: string | null): Promise<void> {
    this.db.prepare("DELETE FROM settings WHERE key = ?").run(brandingKey(owner));
  }

  async close() {
    if (this.owned) this.db.close();
  }
}

export const brandingKey = (owner: string | null) => (owner === null ? "branding" : `branding:${owner}`);

/** Only the known fields are stored. */
export const brandingValue = (branding: Branding): Branding => ({
  name: branding.name,
  logoDataUrl: branding.logoDataUrl,
  accent: branding.accent,
});

export const withDefaults = (stored: unknown): Branding =>
  stored && typeof stored === "object" ? { ...DEFAULT_BRANDING, ...(stored as Partial<Branding>) } : { ...DEFAULT_BRANDING };
