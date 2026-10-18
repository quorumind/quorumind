import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type Branding, DEFAULT_BRANDING } from "@quorumind/core";

export type { Branding };

/**
 * The white-label branding of the exports, stored in a key-value `settings` table. It lives in the
 * sessions' SQLite file: pass that database, or its path to open a second connection on it.
 * Self-hosted, there is one branding (owner null); the hosted version keeps one per account.
 */
export class BrandingStore {
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

  get(owner: string | null = null): Branding {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(keyOf(owner)) as { value: string } | undefined;
    if (!row) return { ...DEFAULT_BRANDING };
    try {
      return { ...DEFAULT_BRANDING, ...(JSON.parse(row.value) as Partial<Branding>) };
    } catch {
      return { ...DEFAULT_BRANDING };
    }
  }

  /** Stores branding that was already validated by the caller. */
  set(owner: string | null, branding: Branding): Branding {
    const value: Branding = { name: branding.name, logoDataUrl: branding.logoDataUrl, accent: branding.accent };
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(keyOf(owner), JSON.stringify(value));
    return value;
  }

  /** Forgets an account's branding, when the account is deleted. */
  delete(owner: string | null): void {
    this.db.prepare("DELETE FROM settings WHERE key = ?").run(keyOf(owner));
  }

  close() {
    if (this.owned) this.db.close();
  }
}

const keyOf = (owner: string | null) => (owner === null ? "branding" : `branding:${owner}`);
