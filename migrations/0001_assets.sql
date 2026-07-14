CREATE TABLE assets (
  id uuid NOT NULL,
  storage_key varchar(255) NOT NULL,
  filename varchar(255) NOT NULL,
  title varchar(255) NULL,
  mime_type varchar(255) NOT NULL,
  size bigint NOT NULL,
  width integer NULL,
  height integer NULL,
  image_format varchar(32) NULL,
  uploaded_by uuid NOT NULL,
  date_created timestamptz NOT NULL DEFAULT now(),
  date_updated timestamptz NULL,
  CONSTRAINT assets_pkey PRIMARY KEY (id),
  CONSTRAINT assets_storage_key_unique UNIQUE (storage_key),
  CONSTRAINT assets_uploaded_by_foreign FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX assets_uploaded_by_idx ON assets(uploaded_by);
CREATE INDEX assets_date_created_idx ON assets(date_created DESC);
