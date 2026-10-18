import { join } from "node:path";
import { type BrandingStore, SqliteBrandingStore } from "./branding.ts";
import { PostgresBrandingStore } from "./postgres/branding.ts";
import { connectPostgres, databaseUrl, describeUrl } from "./postgres/database.ts";
import { migrateSessions, PostgresSessionStore } from "./postgres/store.ts";
import { type SessionStore, SqliteSessionStore } from "./store.ts";

type Env = Record<string, string | undefined>;

export interface Storage {
  store: SessionStore;
  brandingStore: BrandingStore;
  /** Where the data is, for the start-up log. */
  description: string;
  close(): Promise<void>;
}

/**
 * The stores of a self-hosted server. By default a SQLite file in the data directory, with nothing to set up. With
 * DATABASE_URL (or DATABASE_URL_FILE), a PostgreSQL database instead: the server waits for it to answer, then
 * brings its tables up to date before serving.
 */
export async function openStorage(env: Env, dataDir: string): Promise<Storage> {
  const url = databaseUrl(env);
  if (url) {
    const db = await connectPostgres(url);
    try {
      await migrateSessions(db);
    } catch (error) {
      await db.close();
      throw error;
    }
    const store = new PostgresSessionStore(db);
    return {
      store,
      brandingStore: new PostgresBrandingStore(db),
      description: `PostgreSQL at ${describeUrl(url)}`,
      async close() {
        await store.close();
        await db.close();
      },
    };
  }
  const path = join(dataDir, "quorumind.db");
  const store = new SqliteSessionStore(path);
  const brandingStore = new SqliteBrandingStore(store.db);
  return {
    store,
    brandingStore,
    description: `SQLite at ${path}`,
    async close() {
      await brandingStore.close();
      await store.close();
    },
  };
}
