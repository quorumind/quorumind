import type { PGliteInterface } from "@electric-sql/pglite";
import type { Database, Queryable } from "./database.ts";

/**
 * PostgreSQL in-process, compiled to WebAssembly (PGlite): the tests run the PostgreSQL stores on it, with no server
 * to start. One connection only: its transactions run one after the other. @electric-sql/pglite is a development
 * dependency, loaded only when this is called.
 *
 * @param dataDir where to keep the database; in memory when not given.
 */
export async function pgliteDatabase(dataDir?: string): Promise<Database> {
  const { PGlite } = await import("@electric-sql/pglite");
  return wrapPglite(await PGlite.create(dataDir));
}

/** A copy of a PGlite database, schema and data included: much faster than creating and migrating a new one. */
export async function clonePglite(source: Database): Promise<Database> {
  const instance = instances.get(source);
  if (!instance) throw new Error("Only a database opened with pgliteDatabase can be cloned.");
  return wrapPglite(await instance.clone());
}

const instances = new WeakMap<Database, PGliteInterface>();

async function wrapPglite(instance: PGliteInterface): Promise<Database> {
  // PGlite takes the host's time zone; the PostgreSQL servers are set to UTC.
  await instance.exec("SET TIME ZONE 'UTC'");
  const queryable = (target: Pick<PGliteInterface, "query" | "exec">): Queryable => ({
    async query<Row>(sql: string, params: unknown[] = []) {
      const result = await target.query<Row>(sql, params);
      return { rows: result.rows, rowCount: result.affectedRows ?? 0 };
    },
    async exec(sql: string) {
      await target.exec(sql);
    },
  });
  const database: Database = {
    ...queryable(instance),
    transaction: (work) => instance.transaction((tx) => work(queryable(tx))),
    close: () => instance.close(),
  };
  instances.set(database, instance);
  return database;
}
