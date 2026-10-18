import type { OrgProfile } from "@quorumind/core";
import { type Branding, type BrandingStore, brandingKey, brandingValue, profileKey, withDefaults } from "../branding.ts";
import { storedProfile } from "../profile.ts";
import type { Database } from "./database.ts";
import { iso } from "./store.ts";

/** The settings (branding and organisation profile) in the `settings` table of PostgreSQL, created by migrateSessions. */
export class PostgresBrandingStore implements BrandingStore {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async get(owner: string | null = null): Promise<Branding> {
    const { rows } = await this.db.query<{ value: unknown }>("SELECT value FROM settings WHERE key = $1", [brandingKey(owner)]);
    return withDefaults(rows[0]?.value);
  }

  async set(owner: string | null, branding: Branding): Promise<Branding> {
    const value = brandingValue(branding);
    await this.write(brandingKey(owner), value, new Date().toISOString());
    return value;
  }

  async profile(owner: string | null = null): Promise<OrgProfile | null> {
    const { rows } = await this.db.query<{ value: unknown; updated_at: unknown }>("SELECT value, updated_at FROM settings WHERE key = $1", [
      profileKey(owner),
    ]);
    const row = rows[0];
    return row ? storedProfile(row.value, row.updated_at == null ? null : iso(row.updated_at)) : null;
  }

  async setProfile(owner: string | null, profile: OrgProfile | null): Promise<OrgProfile | null> {
    if (!profile) {
      await this.db.query("DELETE FROM settings WHERE key = $1", [profileKey(owner)]);
      return null;
    }
    const { updatedAt, ...value } = profile;
    const at = updatedAt ?? new Date().toISOString();
    await this.write(profileKey(owner), value, at);
    return { ...profile, updatedAt: at };
  }

  async delete(owner: string | null): Promise<void> {
    await this.db.query("DELETE FROM settings WHERE key = ANY($1)", [[brandingKey(owner), profileKey(owner)]]);
  }

  /** The database belongs to whoever opened it. */
  async close() {}

  private async write(key: string, value: unknown, updatedAt: string) {
    await this.db.query(
      "INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      [key, JSON.stringify(value), updatedAt],
    );
  }
}
