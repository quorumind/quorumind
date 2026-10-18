import { readFileSync } from "node:fs";
import pg from "pg";

type Env = Record<string, string | undefined>;

export interface QueryResult<Row> {
  rows: Row[];
  /** Rows inserted, updated or deleted by the statement. */
  rowCount: number;
}

/** What the stores need from PostgreSQL: parameterised queries ($1, $2…), and scripts of several statements. */
export interface Queryable {
  query<Row = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<Row>>;
  exec(sql: string): Promise<void>;
}

/**
 * A PostgreSQL database: a pool of connections in production, PGlite (PostgreSQL in WebAssembly, in-process) in the
 * tests. Both run the same SQL. Inside `transaction`, every statement must go through the `tx` it is given.
 */
export interface Database extends Queryable {
  /** Runs `work` in one transaction: committed when it resolves, rolled back when it throws. */
  transaction<T>(work: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * The PostgreSQL connection string: DATABASE_URL, or the content of the file DATABASE_URL_FILE names (a Docker
 * secret), trimmed. DATABASE_URL wins when both are set. Null when neither is: the server keeps its data in SQLite.
 */
export function databaseUrl(env: Env): string | null {
  const direct = env.DATABASE_URL?.trim();
  if (direct) return direct;
  const path = env.DATABASE_URL_FILE?.trim();
  if (!path) return null;
  let value: string;
  try {
    value = readFileSync(path, "utf8").trim();
  } catch (error) {
    throw new Error(`DATABASE_URL_FILE points to ${path}, which cannot be read (${(error as Error).message}).`);
  }
  if (!value) throw new Error(`DATABASE_URL_FILE points to ${path}, which is empty.`);
  return value;
}

/** Where a connection string points, without its password: for logs and errors. */
export function describeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname}`;
  } catch {
    return "the configured server";
  }
}

export interface ConnectOptions {
  /** How many times to try reaching the server before giving up. */
  attempts?: number;
  delayMs?: number;
  log?: (message: string) => void;
}

/**
 * Opens a pool on a PostgreSQL server and waits until it answers: under Docker Swarm, the database may still be
 * starting when the app does (there is no depends_on). Every connection works in UTC.
 */
export async function connectPostgres(url: string, options: ConnectOptions = {}): Promise<Database> {
  const { attempts = 30, delayMs = 2_000, log = console.warn } = options;
  const pool = new pg.Pool({ connectionString: url, max: 10, options: "-c TimeZone=UTC" });
  // An idle connection the server closed (a restart, for instance) is replaced at the next query.
  pool.on("error", (error) => console.error(`PostgreSQL connection lost: ${error.message}`));
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query("SELECT 1");
      break;
    } catch (error) {
      const reason = (error as Error).message;
      if (attempt >= attempts) {
        await pool.end().catch(() => {});
        throw new Error(`PostgreSQL at ${describeUrl(url)} cannot be reached after ${attempts} attempts: ${reason}`);
      }
      log(`PostgreSQL at ${describeUrl(url)} is not reachable yet (${reason}). Trying again in ${delayMs / 1000} s.`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return poolDatabase(pool);
}

function clientQueryable(client: pg.Pool | pg.PoolClient): Queryable {
  return {
    async query<Row>(sql: string, params: unknown[] = []) {
      const result = await client.query(sql, params);
      return { rows: result.rows as Row[], rowCount: result.rowCount ?? 0 };
    },
    async exec(sql: string) {
      // Without parameters, pg sends a simple query: several statements are allowed.
      await client.query(sql);
    },
  };
}

function poolDatabase(pool: pg.Pool): Database {
  return {
    ...clientQueryable(pool),
    async transaction<T>(work: (tx: Queryable) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      let broken: Error | undefined;
      try {
        await client.query("BEGIN");
        const result = await work(clientQueryable(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch (rollback) {
          // A connection that cannot even roll back is dropped instead of going back to the pool.
          broken = rollback as Error;
        }
        throw error;
      } finally {
        client.release(broken);
      }
    },
    close: () => pool.end(),
  };
}
