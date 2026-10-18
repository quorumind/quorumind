import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type Branding, DEFAULT_BRANDING, type OrgProfile } from "@quorumind/core";
import { storedProfile } from "./profile.ts";

export type { Branding };

/**
 * The settings of an owner: the white-label branding of the exports, and the organisation profile the debates
 * follow. Self-hosted, there is one of each (owner null); the hosted version keeps a branding per account (its
 * profiles belong to workspaces, through AppHooks.profile). SQLite by default (SqliteBrandingStore), PostgreSQL when
 * DATABASE_URL is set (postgres/branding.ts).
 */
export interface BrandingStore {
  get(owner?: string | null): Promise<Branding>;
  /** Stores branding that was already validated by the caller. */
  set(owner: string | null, branding: Branding): Promise<Branding>;
  /** The organisation profile, with when it was saved; null when none was. */
  profile(owner?: string | null): Promise<OrgProfile | null>;
  /** Stores a profile that was already validated by the caller, or removes it (null). */
  setProfile(owner: string | null, profile: OrgProfile | null): Promise<OrgProfile | null>;
  /** Forgets an account's branding and profile, when the account is deleted. */
  delete(owner: string | null): Promise<void>;
  close(): Promise<void>;
}

/**
 * The settings in a key-value `settings` table of SQLite, with the time each was saved. It lives in the sessions'
 * SQLite file: pass that database, or its path to open a second connection on it.
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
    // Settings stored before their time was recorded have none.
    const columns = this.db.prepare("PRAGMA table_info(settings)").all() as { name: string }[];
    if (!columns.some((column) => column.name === "updated_at")) this.db.exec("ALTER TABLE settings ADD COLUMN updated_at TEXT");
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
    this.write(brandingKey(owner), value, new Date().toISOString());
    return value;
  }

  async profile(owner: string | null = null): Promise<OrgProfile | null> {
    const row = this.db.prepare("SELECT value, updated_at FROM settings WHERE key = ?").get(profileKey(owner)) as
      | { value: string; updated_at: string | null }
      | undefined;
    if (!row) return null;
    try {
      return storedProfile(JSON.parse(row.value), row.updated_at);
    } catch {
      return null;
    }
  }

  async setProfile(owner: string | null, profile: OrgProfile | null): Promise<OrgProfile | null> {
    if (!profile) {
      this.db.prepare("DELETE FROM settings WHERE key = ?").run(profileKey(owner));
      return null;
    }
    const { updatedAt, ...value } = profile;
    const at = updatedAt ?? new Date().toISOString();
    this.write(profileKey(owner), value, at);
    return { ...profile, updatedAt: at };
  }

  async delete(owner: string | null): Promise<void> {
    this.db.prepare("DELETE FROM settings WHERE key IN (?, ?)").run(brandingKey(owner), profileKey(owner));
  }

  private write(key: string, value: unknown, updatedAt: string) {
    this.db
      .prepare(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      )
      .run(key, JSON.stringify(value), updatedAt);
  }

  async close() {
    if (this.owned) this.db.close();
  }
}

export const brandingKey = (owner: string | null) => (owner === null ? "branding" : `branding:${owner}`);
export const profileKey = (owner: string | null) => (owner === null ? "profile" : `profile:${owner}`);

/** Only the known fields are stored. */
export const brandingValue = (branding: Branding): Branding => ({
  name: branding.name,
  logoDataUrl: branding.logoDataUrl,
  accent: branding.accent,
});

export const withDefaults = (stored: unknown): Branding =>
  stored && typeof stored === "object" ? { ...DEFAULT_BRANDING, ...(stored as Partial<Branding>) } : { ...DEFAULT_BRANDING };
