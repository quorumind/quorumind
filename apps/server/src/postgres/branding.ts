import { type Branding, type BrandingStore, brandingKey, brandingValue, withDefaults } from "../branding.ts";
import type { Database } from "./database.ts";

/** The branding in the `settings` table of PostgreSQL, created by migrateSessions. */
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
    await this.db.query("INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [
      brandingKey(owner),
      JSON.stringify(value),
    ]);
    return value;
  }

  async delete(owner: string | null): Promise<void> {
    await this.db.query("DELETE FROM settings WHERE key = $1", [brandingKey(owner)]);
  }

  /** The database belongs to whoever opened it. */
  async close() {}
}
