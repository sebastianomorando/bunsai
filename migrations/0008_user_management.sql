ALTER TABLE sessions ADD COLUMN management_id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX sessions_management_id_idx ON sessions(management_id);
CREATE INDEX sessions_user_created_idx ON sessions(user_id, created_at DESC);

CREATE TABLE user_invitations (
  id uuid PRIMARY KEY,
  email varchar(255) NOT NULL,
  role varchar(32) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  locale varchar(2) NOT NULL DEFAULT 'it' CHECK (locale IN ('it', 'en')),
  invited_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash varchar(64) UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_sent_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz
);
CREATE UNIQUE INDEX user_invitations_pending_email_idx ON user_invitations(LOWER(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX user_invitations_created_idx ON user_invitations(created_at DESC);
CREATE INDEX user_invitations_expiry_idx ON user_invitations(expires_at);
