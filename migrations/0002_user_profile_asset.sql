ALTER TABLE users
  ADD COLUMN profile_asset_id uuid NULL,
  ADD CONSTRAINT users_profile_asset_foreign
    FOREIGN KEY (profile_asset_id) REFERENCES assets(id) ON DELETE SET NULL;

CREATE INDEX users_profile_asset_idx ON users(profile_asset_id);
