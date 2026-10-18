-- What a share link shows (the decision deliverable only, or the whole session), until when, and the password it
-- asks for. The links made before keep showing the whole session, with no expiry and no password.

ALTER TABLE shares ADD COLUMN mode text NOT NULL DEFAULT 'full' CHECK (mode IN ('client', 'full'));
-- Null: the link never expires
ALTER TABLE shares ADD COLUMN expires_at timestamptz;
-- scrypt$N$r$p$salt$key; null without a password
ALTER TABLE shares ADD COLUMN password_hash text;
