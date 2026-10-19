import { fileURLToPath } from "node:url";
import type { RegisterEntry } from "@quorumind/core";
import { isWorking, markInterrupted, normalizeSession, type Session } from "@quorumind/core";
import {
  applyShareSettings,
  type CacheLimits,
  DECISION_LIST_LIMIT,
  type DecisionQuery,
  decisionRow,
  type Feedback,
  type GalleryEntry,
  galleryOf,
  type HistoryEntry,
  type InterruptOptions,
  LiveSessions,
  MissingSession,
  type NewPlacement,
  type Placement,
  placementOf,
  publicShare,
  questionnaireOf,
  type SessionStore,
  type SessionSummary,
  type Share,
  type ShareSettings,
  type StoredDecision,
  type StoredQuestionnaire,
  type StoredSession,
  type StoredShare,
  type Submission,
  storable,
  storedJson,
  summarize,
} from "../store.ts";
import type { Database, Queryable } from "./database.ts";
import { loadMigrations, migrate } from "./migrate.ts";

/** Creates or updates the tables of the sessions, the share links, the feedback and the settings. */
export function migrateSessions(db: Database): Promise<number[]> {
  return migrate(db, "quorumind", loadMigrations(fileURLToPath(new URL("./migrations/", import.meta.url))));
}

export const iso = (value: unknown): string => (value instanceof Date ? value.toISOString() : String(value));

/** A foreign key refused the row: its session does not exist. */
const isMissingSession = (error: unknown) => (error as { code?: unknown } | null)?.code === "23503";

const SHARE_COLUMNS = "shares.token, shares.public, shares.created_at, shares.mode, shares.expires_at, shares.password_hash";

const toShare = (row: Record<string, unknown>): StoredShare => ({
  token: String(row.token),
  public: row.public === true,
  createdAt: iso(row.created_at),
  mode: row.mode === "client" ? "client" : "full",
  expiresAt: row.expires_at == null ? null : iso(row.expires_at),
  hasPassword: row.password_hash != null,
  passwordHash: row.password_hash == null ? null : String(row.password_hash),
});

type PlacedRow = { data: Session; owner_id: string | null; workspace_id: string | null; private: boolean };

const placed = (row: Omit<PlacedRow, "data">): Placement => ({
  owner: row.owner_id,
  workspace: row.workspace_id,
  private: row.private === true,
});

/** The sessions of an owner, in a form the owner index serves (IS NOT DISTINCT FROM would not use it). */
const ownedBy = (owner: string | null) =>
  owner === null ? { where: "owner_id IS NULL", params: [] as unknown[] } : { where: "owner_id = $1", params: [owner] as unknown[] };

/**
 * Sessions as jsonb documents in PostgreSQL, on a database migrated with migrateSessions. Writes to one session are
 * applied in the order they were made, even though they run concurrently on several connections.
 */
export class PostgresSessionStore implements SessionStore {
  private readonly db: Database;
  private readonly live: LiveSessions;
  private readonly writes = new Map<string, Promise<void>>();

  /** `cache` bounds the sessions kept in memory (CACHE_LIMITS by default). */
  constructor(db: Database, options: { cache?: CacheLimits } = {}) {
    this.db = db;
    this.live = new LiveSessions(options.cache);
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

  /** A session as the database has it, without keeping it in memory. */
  private async read(id: string): Promise<StoredSession | null> {
    const { rows } = await this.db.query<PlacedRow>("SELECT data, owner_id, workspace_id, private FROM sessions WHERE id = $1", [id]);
    const row = rows[0];
    return row ? { ...placed(row), session: normalizeSession(row.data) } : null;
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
    this.live.stored(session, placed(row));
    return { ...placed(row), session };
  }

  /**
   * Writes a session. A session keeps the owner and workspace it was first saved with: the engine saves without them.
   * The save of a session deleted meanwhile does nothing: an object read or written before only updates its row, and
   * the sessions deleted here are remembered. A first write that fails leaves nothing in memory.
   */
  save(session: Session, owner: string | null = null, placement?: NewPlacement): Promise<void> {
    const { id, createdAt, updatedAt } = session;
    if (this.live.isDeleted(id)) return Promise.resolve();
    const wanted = placementOf(owner, placement);
    const update = this.live.wasStored(session);
    // Kept at once, so that every request reads this object while the write waits its turn.
    this.live.keep(session, this.live.placementOf(id) ?? wanted);
    // The session as it is now: the engine goes on changing the object while the write waits its turn.
    const data = storedJson(session);
    const decision = decisionRow(session);
    return this.serialized(id, async () => {
      if (this.live.isDeleted(id)) return;
      let row: Omit<PlacedRow, "data"> | undefined;
      try {
        row = await this.db.transaction(async (tx) => {
          const { rows } = update
            ? await tx.query<Omit<PlacedRow, "data">>(
                "UPDATE sessions SET data = $2, updated_at = $3 WHERE id = $1 RETURNING owner_id, workspace_id, private",
                [id, data, updatedAt],
              )
            : await tx.query<Omit<PlacedRow, "data">>(
                `INSERT INTO sessions (id, owner_id, workspace_id, private, data, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)
                 ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at RETURNING owner_id, workspace_id, private`,
                [id, wanted.owner, wanted.workspace, wanted.private, data, createdAt, updatedAt],
              );
          const saved = rows[0];
          if (saved) await this.indexDecision(tx, id, placed(saved), decision);
          return saved;
        });
      } catch (error) {
        this.live.forgetUnstored(session);
        throw error;
      }
      // Deleted by another process.
      if (!row) this.live.forget(id, true);
      else this.live.written(session, placed(row));
    });
  }

  /** Keeps a session's row of the register up to date: one once it has a verdict, none before. */
  private async indexDecision(db: Queryable, id: string, placement: Placement, row: ReturnType<typeof decisionRow>) {
    if (!row) {
      await db.query("DELETE FROM decisions WHERE session_id = $1", [id]);
      return;
    }
    await db.query(
      `INSERT INTO decisions (session_id, owner_id, workspace_id, private, status, decided_at, updated_at, review_on, reminded_for, entry)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (session_id) DO UPDATE SET status = excluded.status, decided_at = excluded.decided_at, updated_at = excluded.updated_at,
         review_on = excluded.review_on, entry = excluded.entry,
         -- A reminder taken for this date stays taken: a save of an object read before it does not give it back.
         reminded_for = CASE WHEN excluded.review_on IS NOT DISTINCT FROM decisions.review_on
           THEN coalesce(excluded.reminded_for, decisions.reminded_for) ELSE excluded.reminded_for END`,
      [
        id,
        placement.owner,
        placement.workspace,
        placement.private,
        row.entry.status,
        row.entry.decidedAt,
        row.entry.updatedAt,
        row.reviewOn,
        row.remindedFor,
        storedJson(row.entry),
      ],
    );
  }

  async decisions(query: DecisionQuery): Promise<StoredDecision[]> {
    const params: unknown[] = [];
    const param = (value: unknown) => `$${params.push(value)}`;
    const ownedBy = (owner: string | null) => (owner === null ? "owner_id IS NULL" : `owner_id = ${param(owner)}`);
    const where: string[] = [];
    if (query.workspace === undefined) where.push(ownedBy(query.owner));
    else {
      const owner = param(query.owner);
      where.push(
        `((workspace_id = ${param(query.workspace)} AND (NOT private OR owner_id = ${owner})) OR (workspace_id IS NULL AND owner_id = ${owner}))`,
      );
    }
    if (query.status) where.push(`status = ${param(query.status)}`);
    if (query.author !== undefined) where.push(ownedBy(query.author));
    // Days as the verdict's own date says them, in UTC.
    if (query.from) where.push(`(decided_at AT TIME ZONE 'UTC')::date >= ${param(query.from)}::date`);
    if (query.to) where.push(`(decided_at AT TIME ZONE 'UTC')::date <= ${param(query.to)}::date`);
    const limit = param(query.limit ?? DECISION_LIST_LIMIT);
    const { rows } = await this.db.query<{ entry: RegisterEntry; owner_id: string | null; workspace_id: string | null; private: boolean }>(
      `SELECT entry, owner_id, workspace_id, private FROM decisions WHERE ${where.join(" AND ")} ORDER BY updated_at DESC LIMIT ${limit}`,
      params,
    );
    return rows.map((row) => ({ ...row.entry, owner: row.owner_id, workspace: row.workspace_id, private: row.private === true }));
  }

  async dueReviews(today: string): Promise<string[]> {
    const { rows } = await this.db.query<{ session_id: string }>(
      `SELECT session_id FROM decisions WHERE review_on IS NOT NULL AND review_on <= $1::date
       AND (reminded_for IS NULL OR reminded_for <> review_on) AND status IN ('proposed', 'approved') ORDER BY review_on`,
      [today],
    );
    return rows.map((row) => row.session_id);
  }

  async claimReminder(sessionId: string, reviewOn: string): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `UPDATE decisions SET reminded_for = review_on
       WHERE session_id = $1 AND review_on = $2::date AND (reminded_for IS NULL OR reminded_for <> review_on)`,
      [sessionId, reviewOn],
    );
    return rowCount === 1;
  }

  async releaseReminder(sessionId: string, reviewOn: string): Promise<void> {
    await this.db.query("UPDATE decisions SET reminded_for = NULL WHERE session_id = $1 AND reminded_for = $2::date", [
      sessionId,
      reviewOn,
    ]);
  }

  async indexDecisions(): Promise<number> {
    const { rows } = await this.db.query<{ id: string }>(
      "SELECT id FROM sessions WHERE data->>'phase' = 'complete' AND NOT EXISTS (SELECT 1 FROM decisions WHERE session_id = sessions.id)",
    );
    let count = 0;
    for (const { id } of rows) {
      // Read without being kept in memory: a batch over every completed session.
      const found = this.live.find(id) ?? (await this.read(id));
      const row = found ? decisionRow(found.session) : null;
      if (!found || !row) continue;
      await this.serialized(id, () => this.indexDecision(this.db, id, found, row));
      count++;
    }
    return count;
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
      await this.db.query("UPDATE decisions SET private = $2 WHERE session_id = $1", [id, isPrivate]);
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
    this.live.forget(id, true);
    // Its share link and feedback go with it (ON DELETE CASCADE).
    await this.serialized(id, async () => {
      await this.db.query("DELETE FROM sessions WHERE id = $1", [id]);
    });
    return true;
  }

  async markInterrupted(now = new Date(), options: InterruptOptions = {}): Promise<number> {
    const { rows } = await this.db.query<{ data: Session }>(
      `SELECT data FROM sessions WHERE (data->>'phase' IN ('interview', 'debating') OR jsonb_typeof(data->'revising') = 'object')
       AND ($1::timestamptz IS NULL OR updated_at < $1)`,
      [options.staleBefore?.toISOString() ?? null],
    );
    let count = 0;
    for (const row of rows) {
      const session = normalizeSession(row.data);
      if (!isWorking(session) || options.skip?.(session.id)) continue;
      markInterrupted(session, now);
      const data = storedJson(session);
      await this.serialized(session.id, async () => {
        await this.db.query("UPDATE sessions SET data = $1, updated_at = $2 WHERE id = $3", [data, session.updatedAt, session.id]);
      });
      this.live.forget(session.id);
      count++;
    }
    return count;
  }

  async purgeOlderThan(days: number, now = Date.now()): Promise<number> {
    const cutoff = new Date(now - days * 86_400_000).toISOString();
    const { rows } = await this.db.query<{ id: string }>("DELETE FROM sessions WHERE updated_at < $1 RETURNING id", [cutoff]);
    for (const { id } of rows) this.live.forget(id, true);
    return rows.length;
  }

  async share(sessionId: string, settings: ShareSettings): Promise<Share> {
    // One link per session: a second call changes it and keeps its token.
    const next = applyShareSettings(await this.storedShareOf(sessionId), settings);
    const { rows } = await this.refusingOrphans(sessionId, () =>
      this.db.query(
        `INSERT INTO shares (token, session_id, public, created_at, mode, expires_at, password_hash) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (session_id) DO UPDATE
       SET public = excluded.public, mode = excluded.mode, expires_at = excluded.expires_at, password_hash = excluded.password_hash
       RETURNING ${SHARE_COLUMNS.replaceAll("shares.", "")}`,
        [next.token, sessionId, next.public, next.createdAt, next.mode, next.expiresAt, next.passwordHash],
      ),
    );
    return publicShare(toShare(rows[0] as Record<string, unknown>));
  }

  private async storedShareOf(sessionId: string): Promise<StoredShare | null> {
    const { rows } = await this.db.query(`SELECT ${SHARE_COLUMNS} FROM shares WHERE session_id = $1`, [sessionId]);
    return rows[0] ? toShare(rows[0]) : null;
  }

  async unshare(sessionId: string): Promise<void> {
    await this.db.query("DELETE FROM shares WHERE session_id = $1", [sessionId]);
  }

  async shareOf(sessionId: string): Promise<Share | null> {
    const share = await this.storedShareOf(sessionId);
    return share ? publicShare(share) : null;
  }

  async shared(token: string): Promise<{ session: Session; share: StoredShare } | null> {
    const { rows } = await this.db.query<{ data: Session } & Record<string, unknown>>(
      `SELECT sessions.data, ${SHARE_COLUMNS} FROM shares JOIN sessions ON sessions.id = shares.session_id WHERE shares.token = $1`,
      [token],
    );
    const row = rows[0];
    if (!row) return null;
    const stored = normalizeSession(row.data);
    return { session: this.live.peek(stored.id) ?? stored, share: toShare(row) };
  }

  async gallery(limit = 50): Promise<GalleryEntry[]> {
    const { rows } = await this.db.query<{ token: string; data: Session }>(
      `SELECT shares.token, sessions.data FROM shares JOIN sessions ON sessions.id = shares.session_id
       WHERE shares.public AND NOT sessions.private AND shares.password_hash IS NULL AND (shares.expires_at IS NULL OR shares.expires_at > $1)
       ORDER BY sessions.updated_at DESC LIMIT $2`,
      [new Date().toISOString(), limit],
    );
    return galleryOf(rows.map((row) => ({ token: row.token, session: normalizeSession(row.data) })));
  }

  /** A foreign key that refuses the row of a session that does not exist answers MissingSession, as on SQLite. */
  private async refusingOrphans<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (isMissingSession(error)) throw new MissingSession(sessionId);
      throw error;
    }
  }

  async addFeedback(feedback: Feedback): Promise<void> {
    await this.refusingOrphans(feedback.sessionId, () =>
      this.db.query("INSERT INTO feedback (session_id, helpful, kind, comment, created_at) VALUES ($1, $2, $3, $4, $5)", [
        feedback.sessionId,
        feedback.helpful,
        feedback.kind,
        storable(feedback.comment),
        feedback.createdAt,
      ]),
    );
  }

  async feedbackOf(sessionId: string): Promise<Feedback[]> {
    const { rows } = await this.db.query<{ helpful: boolean | null; kind: Feedback["kind"]; comment: string; created_at: unknown }>(
      "SELECT helpful, kind, comment, created_at FROM feedback WHERE session_id = $1 ORDER BY id",
      [sessionId],
    );
    return rows.map((row) => ({ sessionId, helpful: row.helpful, kind: row.kind, comment: row.comment, createdAt: iso(row.created_at) }));
  }

  async questionnairesOf(sessionId: string): Promise<StoredQuestionnaire[]> {
    const { rows } = await this.db.query("SELECT * FROM questionnaires WHERE session_id = $1 ORDER BY created_at, id", [sessionId]);
    return rows.map(questionnaireOf);
  }

  async questionnaire(key: { id: string } | { token: string }): Promise<StoredQuestionnaire | null> {
    const { rows } =
      "id" in key
        ? await this.db.query("SELECT * FROM questionnaires WHERE id = $1", [key.id])
        : await this.db.query("SELECT * FROM questionnaires WHERE token = $1", [key.token]);
    return rows[0] ? questionnaireOf(rows[0]) : null;
  }

  async saveQuestionnaire(q: StoredQuestionnaire): Promise<void> {
    await this.refusingOrphans(q.sessionId, () =>
      this.db.query(
        `INSERT INTO questionnaires (id, token, session_id, created_at, updated_at, expires_at, password_hash, client, message, questions,
         answers, status, submitted_at, submitted_by, revision, applied_revision)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT (id) DO UPDATE SET updated_at = excluded.updated_at, expires_at = excluded.expires_at,
         password_hash = excluded.password_hash, client = excluded.client, message = excluded.message, questions = excluded.questions,
         answers = excluded.answers, status = excluded.status, submitted_at = excluded.submitted_at, submitted_by = excluded.submitted_by,
         revision = excluded.revision, applied_revision = excluded.applied_revision`,
        [
          q.id,
          q.token,
          q.sessionId,
          q.createdAt,
          q.updatedAt,
          q.expiresAt,
          q.passwordHash,
          q.client,
          q.message,
          storedJson(q.questions),
          storedJson(q.answers),
          q.status,
          q.submittedAt,
          q.submittedBy,
          q.revision,
          q.appliedRevision,
        ].map((value) => (typeof value === "string" ? storable(value) : value)),
      ),
    );
  }

  async submitQuestionnaire(id: string, submission: Submission): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `UPDATE questionnaires SET status = 'submitted', answers = $2, submitted_at = $3, submitted_by = $4, updated_at = $3, applied_revision = NULL
       WHERE id = $1 AND status = 'open'`,
      [id, storedJson(submission.answers), submission.submittedAt, submission.submittedBy],
    );
    return rowCount === 1;
  }

  async deleteQuestionnaire(id: string): Promise<void> {
    await this.db.query("DELETE FROM questionnaires WHERE id = $1", [id]);
  }

  /** The database belongs to whoever opened it: closing the store waits for its pending writes only. */
  async close() {
    await Promise.allSettled([...this.writes.values()]);
  }
}
