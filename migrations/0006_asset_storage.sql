ALTER TABLE assets
  ADD COLUMN storage_backend varchar(16) NOT NULL DEFAULT 'local',
  ADD CONSTRAINT assets_storage_backend_check CHECK (storage_backend IN ('local', 's3'));
