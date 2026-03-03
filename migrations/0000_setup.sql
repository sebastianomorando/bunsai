CREATE TABLE users (
  id uuid NOT NULL,
  date_created timestamptz NOT NULL DEFAULT now(),
  date_updated timestamptz NULL,
  email varchar(255) NOT NULL,
  password varchar(255) NOT NULL,
  username varchar(255) NOT NULL,
  role varchar(32) NOT NULL DEFAULT 'user',
  is_active bool NOT NULL DEFAULT true,
  activation_token varchar(255) NULL,
  api_token varchar(64) NULL,
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_email_unique UNIQUE (email),
  CONSTRAINT users_username_unique UNIQUE (username),
  CONSTRAINT users_api_token_unique UNIQUE (api_token),
  CONSTRAINT users_role_check CHECK (role IN ('user', 'admin'))
);

CREATE TABLE migrations (
  id serial4 NOT NULL,
  name varchar(255) NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT migrations_pkey PRIMARY KEY (id),
  CONSTRAINT migrations_name_unique UNIQUE (name)
);

CREATE TABLE sessions (
  id uuid NOT NULL,
  user_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_agent varchar(255) NULL,
  ip_address varchar(255) NULL,
  CONSTRAINT sessions_pkey PRIMARY KEY (id),
  CONSTRAINT sessions_user_id_foreign FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE password_resets (
  id uuid NOT NULL,
  user_id uuid NOT NULL,
  token varchar(255) NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT password_resets_pkey PRIMARY KEY (id),
  CONSTRAINT password_resets_token_unique UNIQUE (token),
  CONSTRAINT password_resets_user_id_foreign FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX password_resets_user_id_idx ON password_resets(user_id);
