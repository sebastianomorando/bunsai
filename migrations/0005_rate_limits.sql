CREATE TABLE rate_limits (
  scope varchar(96) NOT NULL,
  key_hash char(64) NOT NULL,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT rate_limits_pkey PRIMARY KEY (scope, key_hash),
  CONSTRAINT rate_limits_request_count_check CHECK (request_count > 0)
);

CREATE INDEX rate_limits_expires_at_idx ON rate_limits(expires_at);
