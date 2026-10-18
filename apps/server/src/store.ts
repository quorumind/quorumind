import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isWorking, markInterrupted, normalizeSession, type Questionnaire, type Session } from "@quorumind/core";
import type { ShareMode } from "./share.ts";

export interface InterruptOptions {
  staleBefore?: Date;
  skip?: (sessionId: string) => boolean;
}

export interface SessionSummary {
  id: string;
  idea: string;
  phase: string;
  mode: string;
  updatedAt: string;
}

export interface Share {
  token: string;
  /** Listed in the public gallery. */
  public: boolean;
  createdAt: string;
  /** client: the decision deliverable only; full: the whole session, without its costs or attached documents. */
  mode: ShareMode;
  /** When the link stops working; null when it never does. */
  expiresAt: string | null;
  /** The link asks for a password. */
  hasPassword: boolean;
}

/** A share link with what only the server reads: the hash of its password. */
export interface StoredShare extends Share {
  passwordHash: string | null;
}

/** What creating or changing a share link sets: a field left out keeps its value, or its default on a new link. */
export interface ShareSettings {
  public?: boolean;
  mode?: ShareMode;
  expiresAt?: string | null;
  passwordHash?: string | null;
}

export interface Feedback {
  sessionId: string;
  helpful: boolean | null;
  kind: "rating" | "error";
  comment: string;
  createdAt: string;
}

export type GalleryEntry = SessionSummary & { token: string; summary: string | null };

/** A questionnaire as the server keeps it: with the hash of its password instead of whether it has one. */
export type StoredQuestionnaire = Omit<Questionnaire, "hasPassword"> & { passwordHash: string | null };

/** What submitting a questionnaire records. */
export interface Submission {
  answers: Questionnaire["answers"];
  submittedAt: string;
  submittedBy: NonNullable<Questionnaire["submittedBy"]>;
}

/** A questionnaire as the agency sees it: never with its password hash. */
export function publicQuestionnaire({ passwordHash, ...questionnaire }: StoredQuestionnaire): Questionnaire {
  return { ...questionnaire, hasPassword: passwordHash !== null };
}

/** Who a session belongs to, and who else may read it. */
export interface Placement {
  /** Who started it: null for the single local user of a self-hosted server. */
  owner: string | null;
  /** The group it was started in and is shared with (a workspace of the hosted version); null when it is not shared. */
  workspace: string | null;
  /** Hidden from everyone but its owner, even within its workspace. */
  private: boolean;
}

export type StoredSession = Placement & { session: Session };

export type HistoryEntry = SessionSummary & Placement;

/** Where a new session is shared. A session keeps the workspace it was first saved with. */
export interface NewPlacement {
  workspace: string | null;
  private?: boolean;
}

/**
 * Where sessions are kept, with their share links and feedback. SQLite by default (SqliteSessionStore, a file in
 * the data directory), PostgreSQL when DATABASE_URL is set (postgres/store.ts). Live session objects are kept in
 * memory so the engine and the HTTP handlers always share the same instance.
 *
 * Self-hosted, every session belongs to the single local user (owner null). The hosted version passes an owner id
 * to every call, and a session is only visible to its owner, or to the members of the workspace it was started in
 * (find and history: the app decides who may read it).
 */
export interface SessionStore {
  get(id: string, owner?: string | null): Promise<Session | null>;
  /** A session with its placement, whoever owns it. */
  find(id: string): Promise<StoredSession | null>;
  save(session: Session, owner?: string | null, placement?: NewPlacement): Promise<void>;
  list(limit?: number, owner?: string | null): Promise<SessionSummary[]>;
  /**
   * The history a member sees in a workspace, latest first: its sessions but the private ones of others, and the
   * member's own sessions started outside any workspace. `mine` keeps the member's own sessions only.
   */
  history(limit: number, scope: { owner: string; workspace: string | null; mine?: boolean }): Promise<HistoryEntry[]>;
  /** Hides a session from its workspace, or shares it with it again. */
  setPrivate(id: string, isPrivate: boolean): Promise<void>;
  /** Every session of an owner, in full: the data export the GDPR gives a right to. */
  all(owner?: string | null): Promise<Session[]>;
  /** Deletes a session of this owner with its share link and feedback. False when there is none. */
  delete(id: string, owner?: string | null): Promise<boolean>;
  /**
   * Fails the sessions a stopped server left working (isWorking), with the code "interrupted", so they can be
   * resumed. Called once at start-up, before serving: no session has a worker yet. Returns how many.
   * `staleBefore` limits it to sessions not saved since that time, and `skip` leaves out those still running here:
   * for a host whose previous process may still be finishing its work while the new one starts.
   */
  markInterrupted(now?: Date, options?: InterruptOptions): Promise<number>;
  /** Deletes the sessions nobody touched for the given number of days. Returns how many. */
  purgeOlderThan(days: number, now?: number): Promise<number>;
  /** Creates the share link of a session (one per session) or changes it. A new link is a client one, private. */
  share(sessionId: string, settings: ShareSettings): Promise<Share>;
  unshare(sessionId: string): Promise<void>;
  shareOf(sessionId: string): Promise<Share | null>;
  /** A shared session, whoever owns it, with its link: the token is the permission, the caller checks the rest. */
  shared(token: string): Promise<{ session: Session; share: StoredShare } | null>;
  /** Completed sessions their owners chose to make public, not private, behind no password and not expired: the gallery. */
  gallery(limit?: number): Promise<GalleryEntry[]>;
  addFeedback(feedback: Feedback): Promise<void>;
  feedbackOf(sessionId: string): Promise<Feedback[]>;
  /** The questionnaires sent about a session, oldest first. */
  questionnairesOf(sessionId: string): Promise<StoredQuestionnaire[]>;
  /** A questionnaire by its id, or by the token of its link: the token is the permission, the caller checks the rest. */
  questionnaire(key: { id: string } | { token: string }): Promise<StoredQuestionnaire | null>;
  /** Creates a questionnaire, or stores its new values. */
  saveQuestionnaire(questionnaire: StoredQuestionnaire): Promise<void>;
  /** Records the answers of an open questionnaire, once: false when it was submitted meanwhile, or is gone. */
  submitQuestionnaire(id: string, submission: Submission): Promise<boolean>;
  deleteQuestionnaire(id: string): Promise<void>;
  close(): Promise<void>;
}

/** The sessions in use, with their placement: one object per session, whatever reads or writes it. */
export class LiveSessions {
  private readonly sessions = new Map<string, Session>();
  private readonly placements = new Map<string, Placement>();

  /** The live session if it is in memory: null when someone else owns it, undefined when it is not loaded. */
  get(id: string, owner: string | null): Session | null | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    return this.placements.get(id)?.owner === owner ? session : null;
  }

  /** The live session, whoever owns it. */
  peek(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  /** The live session with its placement, or undefined when it is not loaded. */
  find(id: string): StoredSession | undefined {
    const session = this.sessions.get(id);
    const placement = this.placements.get(id);
    return session && placement ? { ...placement, session } : undefined;
  }

  /**
   * Keeps a session in memory and returns its placement. A session keeps the owner and workspace it was first saved
   * with: the engine saves without them.
   */
  keep(session: Session, placement: Placement): Placement {
    if (!this.placements.has(session.id)) this.placements.set(session.id, placement);
    this.sessions.set(session.id, session);
    return this.placements.get(session.id) ?? placement;
  }

  setPrivate(id: string, isPrivate: boolean) {
    const placement = this.placements.get(id);
    if (placement) this.placements.set(id, { ...placement, private: isPrivate });
  }

  forget(id: string) {
    this.sessions.delete(id);
    this.placements.delete(id);
  }
}

/** A placement as the app saves it: owner and workspace of a new session, not private unless asked. */
export const placementOf = (owner: string | null, placement: NewPlacement | undefined): Placement => ({
  owner,
  workspace: placement?.workspace ?? null,
  private: placement?.private ?? false,
});

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
      CREATE TABLE IF NOT EXISTS questionnaires (
        id TEXT PRIMARY KEY,
        token TEXT NOT NULL UNIQUE,
        session_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        password_hash TEXT,
        client TEXT,
        message TEXT,
        questions TEXT NOT NULL,
        answers TEXT NOT NULL,
        status TEXT NOT NULL,
        submitted_at TEXT,
        submitted_by TEXT,
        revision INTEGER NOT NULL,
        applied_revision INTEGER
      );
      CREATE INDEX IF NOT EXISTS questionnaires_session ON questionnaires (session_id, created_at);
    `);
    const columns = this.db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
    if (!columns.some((column) => column.name === "owner_id")) this.db.exec("ALTER TABLE sessions ADD COLUMN owner_id TEXT");
    // Sessions shared within a workspace (hosted version); existing ones keep their owner only.
    if (!columns.some((column) => column.name === "workspace_id")) this.db.exec("ALTER TABLE sessions ADD COLUMN workspace_id TEXT");
    if (!columns.some((column) => column.name === "private"))
      this.db.exec("ALTER TABLE sessions ADD COLUMN private INTEGER NOT NULL DEFAULT 0");
    this.db.exec("CREATE INDEX IF NOT EXISTS sessions_workspace ON sessions (workspace_id, updated_at)");
    // Share options: the links made before keep showing the whole session, with no expiry and no password.
    const shareColumns = (this.db.prepare("PRAGMA table_info(shares)").all() as { name: string }[]).map((column) => column.name);
    if (!shareColumns.includes("mode")) this.db.exec("ALTER TABLE shares ADD COLUMN mode TEXT NOT NULL DEFAULT 'full'");
    if (!shareColumns.includes("expires_at")) this.db.exec("ALTER TABLE shares ADD COLUMN expires_at TEXT");
    if (!shareColumns.includes("password_hash")) this.db.exec("ALTER TABLE shares ADD COLUMN password_hash TEXT");
    // Verdict revisions (version 1 of this file): a session ruled on before them keeps its verdict as revision 1.
    if ((this.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version < 1) {
      this.db.exec(`
        UPDATE sessions SET data = json_set(data, '$.revisions', json_array(json_object(
          'number', 1, 'createdAt', json_extract(data, '$.updatedAt'), 'reason', 'debate',
          'inputs', json_object('facts', json_array(), 'note', NULL, 'questionnaireId', NULL), 'basedOn', NULL,
          'verdict', json(json_extract(data, '$.verdict')), 'costs', json_array(), 'critiques', json_array(), 'by', NULL)))
        WHERE json_type(data, '$.revisions') IS NULL AND json_type(data, '$.verdict') = 'object';
        PRAGMA user_version = 1;
      `);
    }
  }

  async get(id: string, owner: string | null = null): Promise<Session | null> {
    const found = await this.find(id);
    return found && found.owner === owner ? found.session : null;
  }

  async find(id: string): Promise<StoredSession | null> {
    const cached = this.live.find(id);
    if (cached) return cached;
    const row = this.db.prepare("SELECT data, owner_id, workspace_id, private FROM sessions WHERE id = ?").get(id) as SqliteRow | undefined;
    if (!row) return null;
    const session = normalizeSession(JSON.parse(row.data) as Session);
    return { ...this.live.keep(session, sqlitePlacement(row)), session };
  }

  async save(session: Session, owner: string | null = null, placement?: NewPlacement): Promise<void> {
    const kept = this.live.keep(session, placementOf(owner, placement));
    this.db
      .prepare(
        "INSERT INTO sessions (id, data, updated_at, owner_id, workspace_id, private) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
      )
      .run(session.id, JSON.stringify(session), session.updatedAt, kept.owner, kept.workspace, kept.private ? 1 : 0);
  }

  async list(limit = 50, owner: string | null = null): Promise<SessionSummary[]> {
    const rows = this.db.prepare("SELECT data FROM sessions WHERE owner_id IS ? ORDER BY updated_at DESC LIMIT ?").all(owner, limit) as {
      data: string;
    }[];
    return rows.map((row) => summarize(normalizeSession(JSON.parse(row.data) as Session)));
  }

  async history(limit: number, scope: { owner: string; workspace: string | null; mine?: boolean }): Promise<HistoryEntry[]> {
    const where = scope.mine
      ? "owner_id = :owner AND (workspace_id = :workspace OR workspace_id IS NULL)"
      : "(workspace_id = :workspace AND (private = 0 OR owner_id = :owner)) OR (workspace_id IS NULL AND owner_id = :owner)";
    const rows = this.db
      .prepare(`SELECT data, owner_id, workspace_id, private FROM sessions WHERE ${where} ORDER BY updated_at DESC LIMIT :limit`)
      .all({ owner: scope.owner, workspace: scope.workspace, limit }) as SqliteRow[];
    return rows.map((row) => ({ ...summarize(normalizeSession(JSON.parse(row.data) as Session)), ...sqlitePlacement(row) }));
  }

  async setPrivate(id: string, isPrivate: boolean): Promise<void> {
    this.db.prepare("UPDATE sessions SET private = ? WHERE id = ?").run(isPrivate ? 1 : 0, id);
    this.live.setPrivate(id, isPrivate);
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
    this.db.prepare("DELETE FROM questionnaires WHERE session_id = ?").run(id);
    this.db.prepare("DELETE FROM feedback WHERE session_id = ?").run(id);
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }

  async markInterrupted(now = new Date(), options: InterruptOptions = {}): Promise<number> {
    const stale = options.staleBefore?.toISOString() ?? "9999";
    const rows = this.db
      .prepare(
        "SELECT data FROM sessions WHERE (json_extract(data, '$.phase') IN ('interview', 'debating') OR json_type(data, '$.revising') = 'object') AND updated_at < ?",
      )
      .all(stale) as { data: string }[];
    const update = this.db.prepare("UPDATE sessions SET data = ?, updated_at = ? WHERE id = ?");
    let count = 0;
    for (const row of rows) {
      const session = normalizeSession(JSON.parse(row.data) as Session);
      if (!isWorking(session) || options.skip?.(session.id)) continue;
      markInterrupted(session, now);
      update.run(JSON.stringify(session), session.updatedAt, session.id);
      this.live.forget(session.id);
      count++;
    }
    return count;
  }

  async purgeOlderThan(days: number, now = Date.now()): Promise<number> {
    const cutoff = new Date(now - days * 86_400_000).toISOString();
    const rows = this.db.prepare("SELECT id FROM sessions WHERE updated_at < ?").all(cutoff) as { id: string }[];
    for (const { id } of rows) this.remove(id);
    return rows.length;
  }

  async share(sessionId: string, settings: ShareSettings): Promise<Share> {
    const existing = this.storedShareOf(sessionId);
    const next = applyShareSettings(existing, settings);
    if (existing) {
      this.db
        .prepare("UPDATE shares SET public = ?, mode = ?, expires_at = ?, password_hash = ? WHERE token = ?")
        .run(next.public ? 1 : 0, next.mode, next.expiresAt, next.passwordHash, next.token);
    } else {
      this.db
        .prepare("INSERT INTO shares (token, session_id, public, created_at, mode, expires_at, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(next.token, sessionId, next.public ? 1 : 0, next.createdAt, next.mode, next.expiresAt, next.passwordHash);
    }
    return publicShare(next);
  }

  private storedShareOf(sessionId: string): StoredShare | null {
    const row = this.db.prepare(`SELECT ${SHARE_COLUMNS} FROM shares WHERE session_id = ?`).get(sessionId) as ShareRow | undefined;
    return row ? sqliteShare(row) : null;
  }

  async unshare(sessionId: string): Promise<void> {
    this.db.prepare("DELETE FROM shares WHERE session_id = ?").run(sessionId);
  }

  async shareOf(sessionId: string): Promise<Share | null> {
    const share = this.storedShareOf(sessionId);
    return share ? publicShare(share) : null;
  }

  async shared(token: string): Promise<{ session: Session; share: StoredShare } | null> {
    const row = this.db
      .prepare(
        `SELECT sessions.data AS data, ${SHARE_COLUMNS} FROM shares JOIN sessions ON sessions.id = shares.session_id WHERE shares.token = ?`,
      )
      .get(token) as (ShareRow & { data: string }) | undefined;
    if (!row) return null;
    const stored = normalizeSession(JSON.parse(row.data) as Session);
    return { session: this.live.peek(stored.id) ?? stored, share: sqliteShare(row) };
  }

  async gallery(limit = 50): Promise<GalleryEntry[]> {
    const rows = this.db
      .prepare(
        `SELECT shares.token AS token, sessions.data AS data FROM shares JOIN sessions ON sessions.id = shares.session_id
         WHERE shares.public = 1 AND sessions.private = 0 AND shares.password_hash IS NULL AND (shares.expires_at IS NULL OR shares.expires_at > ?)
         ORDER BY sessions.updated_at DESC LIMIT ?`,
      )
      .all(new Date().toISOString(), limit) as { token: string; data: string }[];
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

  async questionnairesOf(sessionId: string): Promise<StoredQuestionnaire[]> {
    const rows = this.db
      .prepare("SELECT * FROM questionnaires WHERE session_id = ? ORDER BY created_at, id")
      .all(sessionId) as unknown as QuestionnaireRow[];
    return rows.map(sqliteQuestionnaire);
  }

  async questionnaire(key: { id: string } | { token: string }): Promise<StoredQuestionnaire | null> {
    const row = (
      "id" in key
        ? this.db.prepare("SELECT * FROM questionnaires WHERE id = ?").get(key.id)
        : this.db.prepare("SELECT * FROM questionnaires WHERE token = ?").get(key.token)
    ) as QuestionnaireRow | undefined;
    return row ? sqliteQuestionnaire(row) : null;
  }

  async saveQuestionnaire(q: StoredQuestionnaire): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO questionnaires (id, token, session_id, created_at, updated_at, expires_at, password_hash, client, message, questions,
           answers, status, submitted_at, submitted_by, revision, applied_revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, expires_at = excluded.expires_at,
           password_hash = excluded.password_hash, client = excluded.client, message = excluded.message, questions = excluded.questions,
           answers = excluded.answers, status = excluded.status, submitted_at = excluded.submitted_at, submitted_by = excluded.submitted_by,
           revision = excluded.revision, applied_revision = excluded.applied_revision`,
      )
      .run(
        q.id,
        q.token,
        q.sessionId,
        q.createdAt,
        q.updatedAt,
        q.expiresAt,
        q.passwordHash,
        q.client,
        q.message,
        JSON.stringify(q.questions),
        JSON.stringify(q.answers),
        q.status,
        q.submittedAt,
        q.submittedBy,
        q.revision,
        q.appliedRevision,
      );
  }

  async submitQuestionnaire(id: string, submission: Submission): Promise<boolean> {
    const result = this.db
      .prepare(
        `UPDATE questionnaires SET status = 'submitted', answers = ?, submitted_at = ?, submitted_by = ?, updated_at = ?, applied_revision = NULL
         WHERE id = ? AND status = 'open'`,
      )
      .run(JSON.stringify(submission.answers), submission.submittedAt, submission.submittedBy, submission.submittedAt, id);
    return Number(result.changes) === 1;
  }

  async deleteQuestionnaire(id: string): Promise<void> {
    this.db.prepare("DELETE FROM questionnaires WHERE id = ?").run(id);
  }

  async close() {
    this.db.close();
  }
}

type QuestionnaireRow = Record<string, unknown> & { questions: string; answers: string };

const sqliteQuestionnaire = (row: QuestionnaireRow): StoredQuestionnaire =>
  questionnaireOf({ ...row, questions: JSON.parse(row.questions), answers: JSON.parse(row.answers) });

/** A questionnaire from the columns of either database, its JSON already parsed. */
export function questionnaireOf(row: Record<string, unknown>): StoredQuestionnaire {
  const text = (value: unknown) => (value == null ? null : String(value));
  const time = (value: unknown) => (value instanceof Date ? value.toISOString() : String(value));
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    token: String(row.token),
    createdAt: time(row.created_at),
    updatedAt: time(row.updated_at),
    expiresAt: time(row.expires_at),
    passwordHash: text(row.password_hash),
    client: text(row.client),
    message: text(row.message),
    questions: row.questions as StoredQuestionnaire["questions"],
    answers: row.answers as StoredQuestionnaire["answers"],
    status: row.status === "submitted" ? "submitted" : "open",
    submittedAt: row.submitted_at == null ? null : time(row.submitted_at),
    submittedBy: row.submitted_by === "client" || row.submitted_by === "agency" ? row.submitted_by : null,
    revision: Number(row.revision),
    appliedRevision: row.applied_revision == null ? null : Number(row.applied_revision),
  };
}

type SqliteRow = { data: string; owner_id: string | null; workspace_id: string | null; private: number };

const sqlitePlacement = (row: SqliteRow): Placement => ({ owner: row.owner_id, workspace: row.workspace_id, private: row.private === 1 });

const SHARE_COLUMNS = "shares.token, shares.public, shares.created_at, shares.mode, shares.expires_at, shares.password_hash";

interface ShareRow {
  token: string;
  public: number;
  created_at: string;
  mode: string;
  expires_at: string | null;
  password_hash: string | null;
}

const sqliteShare = (row: ShareRow): StoredShare => ({
  token: row.token,
  public: row.public === 1,
  createdAt: row.created_at,
  mode: row.mode === "client" ? "client" : "full",
  expiresAt: row.expires_at,
  hasPassword: row.password_hash !== null,
  passwordHash: row.password_hash,
});

/** The link as it is after the change: a new one is private, a client one, with no expiry and no password. */
export function applyShareSettings(existing: StoredShare | null, settings: ShareSettings): StoredShare {
  const passwordHash = settings.passwordHash !== undefined ? settings.passwordHash : (existing?.passwordHash ?? null);
  return {
    token: existing?.token ?? randomToken(),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    public: settings.public ?? existing?.public ?? false,
    mode: settings.mode ?? existing?.mode ?? "client",
    expiresAt: settings.expiresAt !== undefined ? settings.expiresAt : (existing?.expiresAt ?? null),
    hasPassword: passwordHash !== null,
    passwordHash,
  };
}

/** A share link as the owner sees it: never with its password hash. */
export function publicShare({ passwordHash: _hash, ...share }: StoredShare): Share {
  return share;
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
