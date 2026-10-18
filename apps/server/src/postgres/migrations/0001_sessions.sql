-- The sessions of the debate app, the links they are shared through, the feedback they got, and the settings
-- (the branding of the exports).

CREATE TABLE sessions (
  id text PRIMARY KEY,
  -- Null on a self-hosted server (its single local user); the account id in the hosted version
  owner_id text,
  -- The whole session, as the engine works on it
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
-- The history of an owner, latest first
CREATE INDEX sessions_owner ON sessions (owner_id, updated_at DESC);
-- The retention purge, and the gallery's order
CREATE INDEX sessions_updated ON sessions (updated_at);

CREATE TABLE shares (
  token text PRIMARY KEY,
  session_id text NOT NULL UNIQUE REFERENCES sessions (id) ON DELETE CASCADE,
  public boolean NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX shares_public ON shares (session_id) WHERE public;

CREATE TABLE feedback (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  helpful boolean,
  kind text NOT NULL,
  comment text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX feedback_session ON feedback (session_id, id);

CREATE TABLE settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);
