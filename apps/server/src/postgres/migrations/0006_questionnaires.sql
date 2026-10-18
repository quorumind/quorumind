-- The questionnaires an agency sends its client about a session: the questions, the answers the client gives through
-- a link that needs no account, and the revision of the verdict made from them.

CREATE TABLE questionnaires (
  id text PRIMARY KEY,
  -- The secret of the link
  token text NOT NULL UNIQUE,
  session_id text NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  -- scrypt$N$r$p$salt$key; null without a password
  password_hash text,
  -- Who it is addressed to, and the agency's words above the questions
  client text,
  message text,
  questions jsonb NOT NULL,
  answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'submitted')),
  submitted_at timestamptz,
  submitted_by text CHECK (submitted_by IN ('client', 'agency')),
  -- The revision of the verdict the questions come from, and the one made from the answers
  revision integer NOT NULL,
  applied_revision integer
);
CREATE INDEX questionnaires_session ON questionnaires (session_id, created_at);
