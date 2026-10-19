-- The decision register: one row per session that reached a verdict, written with the session each time it is saved
-- (the decision itself, its approval and its review, lives in the session's document). The row says who may read it,
-- as the session does, and when its review comes, for the reminders. The sessions ruled on before are added by the
-- server when it starts (SessionStore.indexDecisions).

CREATE TABLE decisions (
  session_id text PRIMARY KEY REFERENCES sessions (id) ON DELETE CASCADE,
  owner_id text,
  workspace_id text,
  private boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('proposed', 'approved', 'rejected', 'superseded')),
  -- When the debate reached its verdict, and when the decision last changed
  decided_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  -- The day to revisit it, and the one a reminder was last sent for
  review_on date,
  reminded_for date,
  -- The register's row as the lists show it (RegisterEntry)
  entry jsonb NOT NULL
);
-- The register of a workspace, and of an owner, latest first
CREATE INDEX decisions_workspace ON decisions (workspace_id, updated_at DESC);
CREATE INDEX decisions_owner ON decisions (owner_id, updated_at DESC);
-- The reminders of the day
CREATE INDEX decisions_review ON decisions (review_on) WHERE review_on IS NOT NULL;
