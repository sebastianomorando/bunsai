CREATE TABLE app_setup (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  completed boolean NOT NULL DEFAULT false
);

CREATE INDEX users_admin_exists_idx ON users (id) WHERE role = 'admin';

INSERT INTO app_setup (singleton, completed)
VALUES (true, EXISTS (SELECT 1 FROM users WHERE role = 'admin'));

-- Seed/CLI/admin creation also closes installation permanently. Deleting or
-- demoting the last admin must never reopen an unauthenticated installer.
CREATE FUNCTION complete_initial_setup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE app_setup SET completed = true WHERE singleton = true;
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_complete_initial_setup
AFTER INSERT OR UPDATE OF role ON users
FOR EACH ROW WHEN (NEW.role = 'admin')
EXECUTE FUNCTION complete_initial_setup();
