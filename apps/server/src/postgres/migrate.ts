import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "./database.ts";

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/**
 * The migrations in a directory: files named NNNN_what.sql, applied in the order of their number. A published
 * migration is never edited: a change to the schema is a new file.
 */
export function loadMigrations(dir: string): Migration[] {
  const migrations = readdirSync(dir)
    .map((file) => ({ file, match: /^(\d{4})_([a-z0-9_]+)\.sql$/.exec(file) }))
    .filter((entry): entry is { file: string; match: RegExpExecArray } => entry.match !== null)
    .map(({ file, match }) => ({ version: Number(match[1]), name: match[2] ?? file, sql: readFileSync(join(dir, file), "utf8") }))
    .sort((a, b) => a.version - b.version);
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1)
      throw new Error(`Migration ${migration.version} in ${dir} is out of sequence: expected ${index + 1}.`);
  });
  return migrations;
}

/**
 * Applies the migrations of a component (the open source server, the hosted version…) that the database does not
 * have yet, in one transaction: all of them or none. An advisory lock makes servers starting at the same time (the
 * old and new container of a rolling update) wait for each other instead of migrating twice. Returns the versions
 * applied.
 */
export async function migrate(db: Database, component: string, migrations: Migration[]): Promise<number[]> {
  return db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('quorumind:migrations'))");
    await tx.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      component text NOT NULL,
      version integer NOT NULL,
      name text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (component, version)
    )`);
    const { rows } = await tx.query<{ version: number }>("SELECT version FROM schema_migrations WHERE component = $1", [component]);
    const applied = new Set(rows.map((row) => Number(row.version)));
    const done: number[] = [];
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      await tx.exec(migration.sql);
      await tx.query("INSERT INTO schema_migrations (component, version, name) VALUES ($1, $2, $3)", [
        component,
        migration.version,
        migration.name,
      ]);
      done.push(migration.version);
    }
    return done;
  });
}
