import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { normalizeSession, type Session } from "@quorumind/core";

export interface SessionSummary {
  id: string;
  idea: string;
  phase: string;
  mode: string;
  updatedAt: string;
}

export interface Share {
  token: string;
  public: boolean;
  createdAt: string;
}

export interface Feedback {
  sessionId: string;
  helpful: boolean | null;
  kind: "rating" | "error";
  comment: string;
  createdAt: string;
}

export type GalleryEntry = SessionSummary & { token: string; summary: string | null };

/**
 * Where sessions are kept, with their share links and feedback. SQLite by default (SqliteSessionStore, a file in
 * the data directory), PostgreSQL when DATABASE_URL is set (postgres/store.ts). Live session objects are kept in
 * memory so the engine and the HTTP handlers always share the same instance.
 *
 * Self-hosted, every session belongs to the single local user (owner null). The hosted version passes an owner id
 * to every call, and a session is only visible to its owner.
 */
export interface SessionStore {
  get(id: string, owner?: string | null): Promise<Session | null>;
  save(session: Session, owner?: string | null): Promise<void>;
  list(limit?: number, owner?: string | null): Promise<SessionSummary[]>;
  /** Every session of an owner, in full: the data export the GDPR gives a right to. */
  all(owner?: string | null): Promise<Session[]>;
  /** Deletes a session of this owner with its share link and feedback. False when there is none. */
  delete(id: string, owner?: string | null): Promise<boolean>;
  /** Deletes the sessions nobody touched for the given number of days. Returns how many. */
  purgeOlderThan(days: number, now?: number): Promise<number>;
  share(sessionId: string, isPublic: boolean): Promise<Share>;
  unshare(sessionId: string): Promise<void>;
  shareOf(sessionId: string): Promise<Share | null>;
  /** A shared session, whoever owns it: the token is the permission. */
  shared(token: string): Promise<Session | null>;
  /** Completed sessions their owners chose to make public: the gallery of examples. */
  gallery(limit?: number): Promise<GalleryEntry[]>;
  addFeedback(feedback: Feedback): Promise<void>;
  feedbackOf(sessionId: string): Promise<Feedback[]>;
  close(): Promise<void>;
}

/** The sessions in use, with their owner: one object per session, whatever reads or writes it. */
export class LiveSessions {
  private readonly sessions = new Map<string, Session>();
  private readonly owners = new Map<string, string | null>();

  /** The live session if it is in memory: null when someone else owns it, undefined when it is not loaded. */
  get(id: string, owner: string | null): Session | null | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    return this.owners.get(id) === owner ? session : null;
  }

  /** The live session, whoever owns it. */
  peek(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  /**
   * Keeps a session in memory and returns its owner. A session keeps the owner it was first saved with: the engine
   * saves without one.
   */
  keep(session: Session, owner: string | null): string | null {
    if (!this.owners.has(session.id)) this.owners.set(session.id, owner);
    this.sessions.set(session.id, session);
    return this.owners.get(session.id) ?? null;
  }

  forget(id: string) {
    this.sessions.delete(id);
    this.owners.delete(id);
  }
}

/** Sessions are stored as JSON documents in SQLite, in a file of the data directory. */
export class SqliteSessionStore implements SessionStore {
  readonly db: DatabaseSync;
  private readonly live = new LiveSessions();

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS shares (
        token TEXT PRIMARY KEY,
        session_id TEXT NOT NULL UNIQUE,
        public INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        helpful INTEGER,
        kind TEXT NOT NULL,
        comment TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    const columns = this.db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
    if (!columns.some((column) => column.name === "owner_id")) this.db.exec("ALTER TABLE sessions ADD COLUMN owner_id TEXT");
  }

  async get(id: string, owner: string | null = null): Promise<Session | null> {
    const cached = this.live.get(id, owner);
    if (cached !== undefined) return cached;
    const row = this.db.prepare("SELECT data, owner_id FROM sessions WHERE id = ?").get(id) as
      | { data: string; owner_id: string | null }
      | undefined;
    if (!row || row.owner_id !== owner) return null;
    const session = normalizeSession(JSON.parse(row.data) as Session);
    this.live.keep(session, owner);
    return session;
  }

  async save(session: Session, owner: string | null = null): Promise<void> {
    const ownerId = this.live.keep(session, owner);
    this.db
      .prepare(
        "INSERT INTO sessions (id, data, updated_at, owner_id) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
      )
      .run(session.id, JSON.stringify(session), session.updatedAt, ownerId);
  }

  async list(limit = 50, owner: string | null = null): Promise<SessionSummary[]> {
    const rows = this.db.prepare("SELECT data FROM sessions WHERE owner_id IS ? ORDER BY updated_at DESC LIMIT ?").all(owner, limit) as {
      data: string;
    }[];
    return rows.map((row) => summarize(normalizeSession(JSON.parse(row.data) as Session)));
  }

  async all(owner: string | null = null): Promise<Session[]> {
    const rows = this.db.prepare("SELECT data FROM sessions WHERE owner_id IS ? ORDER BY updated_at").all(owner) as { data: string }[];
    return rows.map((row) => normalizeSession(JSON.parse(row.data) as Session));
  }

  async delete(id: string, owner: string | null = null): Promise<boolean> {
    if (!(await this.get(id, owner))) return false;
    this.remove(id);
    return true;
  }

  private remove(id: string) {
    this.live.forget(id);
    this.db.prepare("DELETE FROM shares WHERE session_id = ?").run(id);
    this.db.prepare("DELETE FROM feedback WHERE session_id = ?").run(id);
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }

  async purgeOlderThan(days: number, now = Date.now()): Promise<number> {
    const cutoff = new Date(now - days * 86_400_000).toISOString();
    const rows = this.db.prepare("SELECT id FROM sessions WHERE updated_at < ?").all(cutoff) as { id: string }[];
    for (const { id } of rows) this.remove(id);
    return rows.length;
  }

  async share(sessionId: string, isPublic: boolean): Promise<Share> {
    const existing = await this.shareOf(sessionId);
    if (existing) {
      this.db.prepare("UPDATE shares SET public = ? WHERE token = ?").run(isPublic ? 1 : 0, existing.token);
      return { ...existing, public: isPublic };
    }
    const share = { token: randomToken(), public: isPublic, createdAt: new Date().toISOString() };
    this.db
      .prepare("INSERT INTO shares (token, session_id, public, created_at) VALUES (?, ?, ?, ?)")
      .run(share.token, sessionId, isPublic ? 1 : 0, share.createdAt);
    return share;
  }

  async unshare(sessionId: string): Promise<void> {
    this.db.prepare("DELETE FROM shares WHERE session_id = ?").run(sessionId);
  }

  async shareOf(sessionId: string): Promise<Share | null> {
    const row = this.db.prepare("SELECT token, public, created_at FROM shares WHERE session_id = ?").get(sessionId) as
      | { token: string; public: number; created_at: string }
      | undefined;
    return row ? { token: row.token, public: row.public === 1, createdAt: row.created_at } : null;
  }

  async shared(token: string): Promise<Session | null> {
    const row = this.db
      .prepare("SELECT sessions.data AS data FROM shares JOIN sessions ON sessions.id = shares.session_id WHERE shares.token = ?")
      .get(token) as { data: string } | undefined;
    if (!row) return null;
    const stored = normalizeSession(JSON.parse(row.data) as Session);
    return this.live.peek(stored.id) ?? stored;
  }

  async gallery(limit = 50): Promise<GalleryEntry[]> {
    const rows = this.db
      .prepare(
        "SELECT shares.token AS token, sessions.data AS data FROM shares JOIN sessions ON sessions.id = shares.session_id WHERE shares.public = 1 ORDER BY sessions.updated_at DESC LIMIT ?",
      )
      .all(limit) as { token: string; data: string }[];
    return galleryOf(rows.map((row) => ({ token: row.token, session: normalizeSession(JSON.parse(row.data) as Session) })));
  }

  async addFeedback(feedback: Feedback): Promise<void> {
    this.db
      .prepare("INSERT INTO feedback (session_id, helpful, kind, comment, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(
        feedback.sessionId,
        feedback.helpful === null ? null : feedback.helpful ? 1 : 0,
        feedback.kind,
        feedback.comment,
        feedback.createdAt,
      );
  }

  async feedbackOf(sessionId: string): Promise<Feedback[]> {
    const rows = this.db
      .prepare("SELECT helpful, kind, comment, created_at FROM feedback WHERE session_id = ? ORDER BY id")
      .all(sessionId) as { helpful: number | null; kind: Feedback["kind"]; comment: string; created_at: string }[];
    return rows.map((row) => ({
      sessionId,
      helpful: row.helpful === null ? null : row.helpful === 1,
      kind: row.kind,
      comment: row.comment,
      createdAt: row.created_at,
    }));
  }

  async close() {
    this.db.close();
  }
}

export function summarize(session: Session): SessionSummary {
  return {
    id: session.id,
    idea: session.sheet?.projectName ?? session.idea,
    phase: session.phase,
    mode: session.mode,
    updatedAt: session.updatedAt,
  };
}

/** The gallery shows completed sessions only, with their summary. */
export function galleryOf(rows: { token: string; session: Session }[]): GalleryEntry[] {
  return rows
    .filter(({ session }) => session.phase === "complete")
    .map(({ token, session }) => ({ ...summarize(session), token, summary: session.sheet?.summary ?? null }));
}

export function randomToken(): string {
  const bytes = new Uint8Array(18);
  globalThis.crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}
