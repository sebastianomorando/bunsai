CREATE INDEX password_resets_expires_at_idx
  ON password_resets(expires_at);

CREATE INDEX users_activation_token_expires_at_idx
  ON users(activation_token_expires_at)
  WHERE activation_token_expires_at IS NOT NULL;
