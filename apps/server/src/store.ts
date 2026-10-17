import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Session } from "@quorumind/core";

/**
 * Sessions are stored as JSON documents in SQLite. Live session objects are kept in memory
 * so the engine and the HTTP handlers always share the same instance.
 */
export class SessionStore {
  private readonly db: DatabaseSync;
  private readonly live = new Map<string, Session>();

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
  }

  get(id: string): Session | null {
    const cached = this.live.get(id);
    if (cached) return cached;
    const row = this.db.prepare("SELECT data FROM sessions WHERE id = ?").get(id) as { data: string } | undefined;
    if (!row) return null;
    const session = JSON.parse(row.data) as Session;
    this.live.set(id, session);
    return session;
  }

  save(session: Session): void {
    this.live.set(session.id, session);
    this.db
      .prepare(
        "INSERT INTO sessions (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
      )
      .run(session.id, JSON.stringify(session), session.updatedAt);
  }

  list(limit = 50): { id: string; idea: string; phase: string; updatedAt: string }[] {
    const rows = this.db.prepare("SELECT data FROM sessions ORDER BY updated_at DESC LIMIT ?").all(limit) as { data: string }[];
    return rows.map((row) => {
      const session = JSON.parse(row.data) as Session;
      return { id: session.id, idea: session.sheet?.projectName ?? session.idea, phase: session.phase, updatedAt: session.updatedAt };
    });
  }

  close() {
    this.db.close();
  }
}
