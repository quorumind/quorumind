import { fileURLToPath } from "node:url";
import { normalizeSession, type Session } from "@quorumind/core";
import {
  type Feedback,
  type GalleryEntry,
  galleryOf,
  type HistoryEntry,
  LiveSessions,
  type NewPlacement,
  type Placement,
  placementOf,
  randomToken,
  type SessionStore,
  type SessionSummary,
  type Share,
  type StoredSession,
  summarize,
} from "../store.ts";
import type { Database } from "./database.ts";
import { loadMigrations, migrate } from "./migrate.ts";

/** Creates or updates the tables of the sessions, the share links, the feedback and the settings. */
export function migrateSessions(db: Database): Promise<number[]> {
  return migrate(db, "quorumind", loadMigrations(fileURLToPath(new URL("./migrations/", import.meta.url))));
}

export const iso = (value: unknown): string => (value instanceof Date ? value.toISOString() : String(value));

/** PostgreSQL refuses the NUL character in text and JSON; an imported document may hold one. */
const withoutNul = (_key: string, value: unknown) =>
  typeof value === "string" && value.includes("\0") ? value.replaceAll("\0", "") : value;

const toShare = (row: Record<string, unknown>): Share => ({
  token: String(row.token),
  public: row.public === true,
  createdAt: iso(row.created_at),
});

type PlacedRow = { data: Session; owner_id: string | null; workspace_id: string | null; private: boolean };

const placed = (row: PlacedRow): Placement => ({ owner: row.owner_id, workspace: row.workspace_id, private: row.private === true });

/** The sessions of an owner, in a form the owner index serves (IS NOT DISTINCT FROM would not use it). */
const ownedBy = (owner: string | null) =>
  owner === null ? { where: "owner_id IS NULL", params: [] as unknown[] } : { where: "owner_id = $1", params: [owner] as unknown[] };

/**
 * Sessions as jsonb documents in PostgreSQL, on a database migrated with migrateSessions. Writes to one session are
 * applied in the order they were made, even though they run concurrently on several connections.
 */
export class PostgresSessionStore implements SessionStore {
  private readonly db: Database;
  private readonly live = new LiveSessions();
  private readonly writes = new Map<string, Promise<void>>();

  constructor(db: Database) {
    this.db = db;
  }

  /** Runs the writes of a session one after the other. */
  private serialized(id: string, work: () => Promise<void>): Promise<void> {
    const next = (this.writes.get(id) ?? Promise.resolve()).catch(() => {}).then(work);
    this.writes.set(id, next);
    const settle = () => {
      if (this.writes.get(id) === next) this.writes.delete(id);
    };
    next.then(settle, settle);
    return next;
  }

  async get(id: string, owner: string | null = null): Promise<Session | null> {
    const found = await this.find(id);
    return found && found.owner === owner ? found.session : null;
  }

  async find(id: string): Promise<StoredSession | null> {
    const cached = this.live.find(id);
    if (cached) return cached;
    const { rows } = await this.db.query<PlacedRow>("SELECT data, owner_id, workspace_id, private FROM sessions WHERE id = $1", [id]);
    const row = rows[0];
    // Loaded or saved by another request in the meantime: that object is the live one.
    const loaded = this.live.find(id);
    if (loaded) return loaded;
    if (!row) return null;
    const session = normalizeSession(row.data);
    return { ...this.live.keep(session, placed(row)), session };
  }

  save(session: Session, owner: string | null = null, placement?: NewPlacement): Promise<void> {
    const kept = this.live.keep(session, placementOf(owner, placement));
    // The session as it is now: the engine goes on changing the object while the write waits its turn.
    const data = JSON.stringify(session, withoutNul);
    const { id, createdAt, updatedAt } = session;
    return this.serialized(id, async () => {
      await this.db.query(
        `INSERT INTO sessions (id, owner_id, workspace_id, private, data, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
        [id, kept.owner, kept.workspace, kept.private, data, createdAt, updatedAt],
      );
    });
  }

  async list(limit = 50, owner: string | null = null): Promise<SessionSummary[]> {
    const { where, params } = ownedBy(owner);
    const { rows } = await this.db.query<{ data: Session }>(
      `SELECT data FROM sessions WHERE ${where} ORDER BY updated_at DESC LIMIT $${params.length + 1}`,
      [...params, limit],
    );
    return rows.map((row) => summarize(normalizeSession(row.data)));
  }

  async history(limit: number, scope: { owner: string; workspace: string | null; mine?: boolean }): Promise<HistoryEntry[]> {
    const where = scope.mine
      ? "owner_id = $1 AND (workspace_id = $2 OR workspace_id IS NULL)"
      : "(workspace_id = $2 AND (NOT private OR owner_id = $1)) OR (workspace_id IS NULL AND owner_id = $1)";
    const { rows } = await this.db.query<PlacedRow>(
      `SELECT data, owner_id, workspace_id, private FROM sessions WHERE ${where} ORDER BY updated_at DESC LIMIT $3`,
      [scope.owner, scope.workspace, limit],
    );
    return rows.map((row) => ({ ...summarize(normalizeSession(row.data)), ...placed(row) }));
  }

  async setPrivate(id: string, isPrivate: boolean): Promise<void> {
    await this.serialized(id, async () => {
      await this.db.query("UPDATE sessions SET private = $2 WHERE id = $1", [id, isPrivate]);
    });
    this.live.setPrivate(id, isPrivate);
  }

  async all(owner: string | null = null): Promise<Session[]> {
    const { where, params } = ownedBy(owner);
    const { rows } = await this.db.query<{ data: Session }>(`SELECT data FROM sessions WHERE ${where} ORDER BY updated_at`, params);
    return rows.map((row) => normalizeSession(row.data));
  }

  async delete(id: string, owner: string | null = null): Promise<boolean> {
    if (!(await this.get(id, owner))) return false;
    this.live.forget(id);
    // Its share link and feedback go with it (ON DELETE CASCADE).
    await this.serialized(id, async () => {
      await this.db.query("DELETE FROM sessions WHERE id = $1", [id]);
    });
    return true;
  }

  async purgeOlderThan(days: number, now = Date.now()): Promise<number> {
    const cutoff = new Date(now - days * 86_400_000).toISOString();
    const { rows } = await this.db.query<{ id: string }>("DELETE FROM sessions WHERE updated_at < $1 RETURNING id", [cutoff]);
    for (const { id } of rows) this.live.forget(id);
    return rows.length;
  }

  async share(sessionId: string, isPublic: boolean): Promise<Share> {
    // One link per session: a second call only changes whether it is public.
    const { rows } = await this.db.query(
      `INSERT INTO shares (token, session_id, public, created_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (session_id) DO UPDATE SET public = excluded.public
       RETURNING token, public, created_at`,
      [randomToken(), sessionId, isPublic, new Date().toISOString()],
    );
    return toShare(rows[0] as Record<string, unknown>);
  }

  async unshare(sessionId: string): Promise<void> {
    await this.db.query("DELETE FROM shares WHERE session_id = $1", [sessionId]);
  }

  async shareOf(sessionId: string): Promise<Share | null> {
    const { rows } = await this.db.query("SELECT token, public, created_at FROM shares WHERE session_id = $1", [sessionId]);
    return rows[0] ? toShare(rows[0]) : null;
  }

  async shared(token: string): Promise<Session | null> {
    const { rows } = await this.db.query<{ data: Session }>(
      "SELECT sessions.data FROM shares JOIN sessions ON sessions.id = shares.session_id WHERE shares.token = $1",
      [token],
    );
    if (!rows[0]) return null;
    const stored = normalizeSession(rows[0].data);
    return this.live.peek(stored.id) ?? stored;
  }

  async gallery(limit = 50): Promise<GalleryEntry[]> {
    const { rows } = await this.db.query<{ token: string; data: Session }>(
      `SELECT shares.token, sessions.data FROM shares JOIN sessions ON sessions.id = shares.session_id
       WHERE shares.public ORDER BY sessions.updated_at DESC LIMIT $1`,
      [limit],
    );
    return galleryOf(rows.map((row) => ({ token: row.token, session: normalizeSession(row.data) })));
  }

  async addFeedback(feedback: Feedback): Promise<void> {
    await this.db.query("INSERT INTO feedback (session_id, helpful, kind, comment, created_at) VALUES ($1, $2, $3, $4, $5)", [
      feedback.sessionId,
      feedback.helpful,
      feedback.kind,
      feedback.comment.replaceAll("\0", ""),
      feedback.createdAt,
    ]);
  }

  async feedbackOf(sessionId: string): Promise<Feedback[]> {
    const { rows } = await this.db.query<{ helpful: boolean | null; kind: Feedback["kind"]; comment: string; created_at: unknown }>(
      "SELECT helpful, kind, comment, created_at FROM feedback WHERE session_id = $1 ORDER BY id",
      [sessionId],
    );
    return rows.map((row) => ({ sessionId, helpful: row.helpful, kind: row.kind, comment: row.comment, createdAt: iso(row.created_at) }));
  }

  /** The database belongs to whoever opened it: closing the store waits for its pending writes only. */
  async close() {
    await Promise.allSettled([...this.writes.values()]);
  }
}
