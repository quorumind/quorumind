import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BrandingStore, SqliteBrandingStore } from "./branding.ts";
import { PostgresBrandingStore } from "./postgres/branding.ts";
import type { Database } from "./postgres/database.ts";
import { clonePglite, pgliteDatabase } from "./postgres/pglite.ts";
import { migrateSessions, PostgresSessionStore } from "./postgres/store.ts";
import { type SessionStore, SqliteSessionStore } from "./store.ts";

export interface TestStorage {
  store: SessionStore;
  brandingStore: BrandingStore;
  /** The PostgreSQL database under the stores; null on SQLite. */
  db: Database | null;
  /** Another store on the same database, with nothing in memory: what a restarted server would read. */
  reopen(): SessionStore;
  close(): Promise<void>;
}

export interface Backend {
  name: "SQLite" | "PostgreSQL";
  open(): Promise<TestStorage>;
}

// One migrated database per test worker; each test works on a copy of it.
let template: Promise<Database> | null = null;

/** A new, migrated PostgreSQL database, in-process (PGlite). */
export async function testDatabase(): Promise<Database> {
  template ??= pgliteDatabase().then(async (db) => {
    await migrateSessions(db);
    return db;
  });
  return clonePglite(await template);
}

/** The storage backends the store tests run on: SQLite in a temporary file, and PostgreSQL in-process. */
export const BACKENDS: Backend[] = [
  {
    name: "SQLite",
    async open() {
      const dir = mkdtempSync(join(tmpdir(), "quorumind-test-"));
      const path = join(dir, "quorumind.db");
      const store = new SqliteSessionStore(path);
      const others: SqliteSessionStore[] = [];
      return {
        store,
        brandingStore: new SqliteBrandingStore(store.db),
        db: null,
        reopen() {
          const other = new SqliteSessionStore(path);
          others.push(other);
          return other;
        },
        async close() {
          for (const other of others) await other.close();
          await store.close();
          rmSync(dir, { recursive: true, force: true });
        },
      };
    },
  },
  {
    name: "PostgreSQL",
    async open() {
      const db = await testDatabase();
      const store = new PostgresSessionStore(db);
      const stores = [store];
      return {
        store,
        brandingStore: new PostgresBrandingStore(db),
        db,
        reopen() {
          const other = new PostgresSessionStore(db);
          stores.push(other);
          return other;
        },
        async close() {
          for (const store of stores) await store.close();
          await db.close();
        },
      };
    },
  },
];
