-- Sessions shared within a workspace (the hosted version's teams). Existing sessions keep their owner only: no
-- workspace, so they stay visible to their owner alone.

-- The workspace a session was started in, and whose members can read it; null when it is not shared
ALTER TABLE sessions ADD COLUMN workspace_id text;
-- Hidden from everyone but its owner, even within its workspace
ALTER TABLE sessions ADD COLUMN private boolean NOT NULL DEFAULT false;
-- The history of a workspace, latest first
CREATE INDEX sessions_workspace ON sessions (workspace_id, updated_at DESC);
