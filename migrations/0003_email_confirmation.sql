ALTER TABLE users
  ADD COLUMN activation_token_expires_at timestamptz NULL;

CREATE UNIQUE INDEX users_activation_token_idx ON users(activation_token)
  WHERE activation_token IS NOT NULL;

DELETE FROM sessions
WHERE user_id IN (SELECT id FROM users WHERE is_active = false);
