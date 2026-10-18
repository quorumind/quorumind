import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BrandingStore, SqliteBrandingStore } from "./branding.ts";
import { type SessionStore, SqliteSessionStore } from "./store.ts";

export interface TestStorage {
  store: SessionStore;
  brandingStore: BrandingStore;
  /** Another store on the same database, with nothing in memory: what a restarted server would read. */
  reopen(): SessionStore;
  close(): Promise<void>;
}

export interface Backend {
  name: "SQLite";
  open(): Promise<TestStorage>;
}

/** The storage backends the store tests run on: SQLite in a temporary file. */
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
];
